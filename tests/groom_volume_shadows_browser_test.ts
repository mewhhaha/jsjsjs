import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { fileURLToPath } from "node:url";
import { chromiumAvailable, withViewer } from "./support.ts";

interface State {
  mode?: "low" | "high" | "stack" | "duplicate" | "lod";
  enabled?: boolean;
  directional?: boolean;
  ambientOcclusion?: number;
  illumination?: "directional" | "hemisphere" | "environment";
  receiverZ?: number;
  metalness?: number;
  offset?: number;
  light?: [number, number, number];
  camera?: [number, number, number];
  blocker?: boolean;
  hidden?: boolean;
  skipUpdate?: boolean;
}
interface Capture {
  center: number;
  edge: number;
  clear: number;
  blocked: number;
  builds: number;
  ambientBuilds: number;
  ambientResolution: number;
  ambientDistance: number;
  lights: number;
  instances: number;
  volumes: number;
  textureBytes: number;
  groomCast: boolean;
  groomReceive: boolean;
  hasRuntimeDepth: boolean;
  hairShaderPreserved: boolean;
}
interface Fixture {
  render(state: State): Capture;
  cleanup(): {
    callback: boolean;
    key: boolean;
    depth: boolean;
    cast: boolean;
    receive: boolean;
  };
  exportDocument(): Promise<string>;
  roundTrip(): Promise<{
    markers: number;
    meshes: number;
    instances: number;
    ordinaryShadows: boolean;
    portableMaterials: boolean;
    mixedRejected: boolean;
  }>;
  callbackProbe(): { keysDistinct: boolean; left: number[]; right: number[] };
  close(): void;
}

function fixtureSource() {
  const imports = [
    "groom-data",
    "groom-volume-data",
    "groom-volume-shadows",
    "hair-shading",
  ]
    .map((name) =>
      JSON.stringify(
        fileURLToPath(new URL(`../src/hair/${name}.ts`, import.meta.url)),
      )
    );
  return `
import * as THREE from "three";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {createGroom,generateGroomStrands} from ${imports[0]};
import {voxelizeGroom} from ${imports[1]};
import {registerGroomVolume,GroomVolumeShadows} from ${imports[2]};
import {groomHairMaterial} from ${imports[3]};

export default () => {
  const canvas=document.createElement("canvas");
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true,preserveDrawingBuffer:true});
  renderer.setSize(192,192,false);
  renderer.outputColorSpace=THREE.LinearSRGBColorSpace;
  renderer.shadowMap.enabled=true;
  renderer.shadowMap.type=THREE.VSMShadowMap;
  const scene=new THREE.Scene(); scene.background=new THREE.Color("black");
  const root=new THREE.Group(); scene.add(root);
  const camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,20);
  camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  const light=new THREE.DirectionalLight("white",1.4);
  light.position.set(0,0,3);light.castShadow=true;
  Object.assign(light.shadow.camera,{left:-1.3,right:1.3,top:1.3,bottom:-1.3,near:.01,far:10});
  light.shadow.camera.updateProjectionMatrix();light.shadow.mapSize.set(256,256);
  light.shadow.bias=-.00001;light.shadow.normalBias=.0001;
  light.shadow.radius=1;light.shadow.blurSamples=4;
  const ambient=new THREE.AmbientLight("white",.002);
  const hemisphere=new THREE.HemisphereLight("white","white",0);
  scene.add(light,light.target,ambient,hemisphere);
  const environmentScene=new THREE.Scene();environmentScene.background=new THREE.Color(.7,.7,.7);
  const pmrem=new THREE.PMREMGenerator(renderer),environment=pmrem.fromScene(environmentScene);pmrem.dispose();
  const receiverMaterial=new THREE.MeshStandardMaterial({color:"white",roughness:.8,side:THREE.DoubleSide});
  const originalCallback=function(shader){shader.uniforms.originalHook={value:1};};
  const originalKey=()=>"volume-receiver-original";
  receiverMaterial.onBeforeCompile=originalCallback;
  receiverMaterial.customProgramCacheKey=originalKey;
  const receiver=new THREE.Mesh(new THREE.PlaneGeometry(2,2),receiverMaterial);
  receiver.receiveShadow=true;root.add(receiver);
  const blocker=new THREE.Mesh(new THREE.BoxGeometry(.22,.65,.12),new THREE.MeshStandardMaterial());
  blocker.position.set(.57,0,.32);blocker.material.colorWrite=false;blocker.material.depthWrite=false;
  blocker.castShadow=true;root.add(blocker);blocker.visible=false;
  const data=new Uint8Array(4*4*4).fill(255);
  const map=new THREE.DataTexture(data,4,4);map.needsUpdate=true;
  const paint=groomHairMaterial({color:"#714d33",map,vertexColors:false,alphaTest:.2});
  paint.colorWrite=false;paint.depthWrite=false;
  const authoredDepth=new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking});
  const make=(children,radius)=>{
    const source=createGroom({version:1,seed:77,layers:[{id:"test",children,radius,tipRadius:radius*.8,
      clump:0,lengthVariation:0,frizz:0}],guides:[{id:"vertical",layer:"test",width:.7,
      points:[[0,-.42,.5],[0,.42,.5]],normals:[[0,0,1],[0,0,1]]}]});
    const volume=voxelizeGroom(generateGroomStrands(source,{segments:6}),{resolution:24});
    const group=new THREE.Group();group.position.x=-.25;
    const mesh=new THREE.Mesh(new THREE.PlaneGeometry(.7,.84),paint);
    mesh.position.z=.5;mesh.castShadow=true;mesh.receiveShadow=true;
    mesh.customDepthMaterial=authoredDepth;group.add(mesh);
    return registerGroomVolume(group,volume);
  };
  const low=make(8,.006),high=make(64,.009);
  const stack=high.clone();stack.position.z=.22;
  const duplicate=high.clone();
  const lod=new THREE.LOD();lod.addLevel(high.clone(),0);lod.addLevel(high.clone(),4);lod.addLevel(high.clone(),8);
  const holder=new THREE.Group();holder.add(low,high,stack,duplicate,lod);root.add(holder);
  const controller=new GroomVolumeShadows();
  let lastState={mode:"low",enabled:true,directional:true,ambientOcclusion:0,illumination:"directional",receiverZ:0,
    metalness:0,offset:0,light:[0,0,3],camera:[0,0,5],blocker:false,hidden:false};
  const pixels=new Uint8Array(192*192*4);
  const read=(point,rx=3,ry=3)=>{
    const p=new THREE.Vector3(...point).project(camera);
    const x=Math.round((p.x*.5+.5)*191), y=Math.round((p.y*.5+.5)*191);
    const result=[0,0,0];let count=0;
    for(let dy=-ry;dy<=ry;dy++) for(let dx=-rx;dx<=rx;dx++){
      const px=x+dx,py=y+dy;if(px<0||py<0||px>=192||py>=192)continue;
      const at=(py*192+px)*4;for(let c=0;c<3;c++)result[c]+=pixels[at+c];count++;
    }
    return result.map(v=>v/count);
  };
  const draw=()=>{
    renderer.render(scene,camera);
    const gl=renderer.getContext();gl.readPixels(0,0,192,192,gl.RGBA,gl.UNSIGNED_BYTE,pixels);
  };
  const mean=(p,rx=3,ry=3)=>read(p,rx,ry).reduce((a,b)=>a+b,0)/3;
  const render=(state)=>{
    lastState={...lastState,...state};const s=lastState;
    for(const g of [low,high,stack,duplicate,lod])g.visible=false;
    if(s.mode==="low")low.visible=true;
    else if(s.mode==="lod")lod.visible=true;
    else{high.visible=true;stack.visible=s.mode==="stack";duplicate.visible=s.mode==="duplicate";}
    holder.position.x=s.offset;holder.visible=!s.hidden;blocker.visible=s.blocker;
    light.position.set(...s.light);light.shadow.needsUpdate=true;
    light.visible=s.illumination==="directional";ambient.intensity=light.visible?.002:0;
    hemisphere.intensity=s.illumination==="hemisphere"?2:0;
    scene.environment=s.illumination==="environment"?environment.texture:null;
    receiver.position.z=s.receiverZ;receiverMaterial.metalness=s.metalness;
    camera.position.set(...s.camera);camera.lookAt(0,0,0);camera.updateMatrixWorld();
    if(!state.skipUpdate)controller.update(root,light.visible?[light]:[],camera,{enabled:s.enabled,resolution:32,
      directional:s.directional,ambientOcclusion:s.ambientOcclusion,ambientResolution:32,ambientDistance:.18});
    draw();
    const mesh=(s.mode==="low"?low:high).children[0];
    return {center:mean([-.25,0,s.receiverZ],22,18),edge:mean([.12,0,s.receiverZ]),
      clear:mean([-.82,0,s.receiverZ]),blocked:mean([.57,0,s.receiverZ]),
      ...controller.statistics,groomCast:mesh.castShadow,groomReceive:mesh.receiveShadow,
      hasRuntimeDepth:mesh.customDepthMaterial!==authoredDepth,
      hairShaderPreserved:paint.customProgramCacheKey().includes("groom-hair-v2")};
  };
  Object.assign(window,{volumeFixture:{render,
    cleanup(){controller.dispose();return {callback:receiverMaterial.onBeforeCompile===originalCallback,
      key:receiverMaterial.customProgramCacheKey===originalKey,depth:low.children[0].customDepthMaterial===authoredDepth,
      cast:low.children[0].castShadow,receive:low.children[0].receiveShadow};},
    async exportDocument(){
      const buffer=await new GLTFExporter().parseAsync(root,{binary:true});
      const bytes=new Uint8Array(buffer),length=new DataView(buffer).getUint32(12,true);
      return new TextDecoder().decode(bytes.subarray(20,20+length)).trim();
    },
    async roundTrip(){
      const buffer=await new GLTFExporter().parseAsync(root,{binary:true});
      const imported=await new GLTFLoader().parseAsync(buffer,"");
      const meshes=[];let markers=0;
      imported.scene.traverse(node=>{
        if(node.userData.threejsGroomVolume===true)markers++;
        if(node.isMesh){node.castShadow=node.receiveShadow=true;meshes.push(node);}
      });
      const restoredController=new GroomVolumeShadows();
      const state=restoredController.update(imported.scene,[light],camera,{resolution:32});
      const result={markers,meshes:meshes.length,instances:state.instances,
        ordinaryShadows:meshes.every(mesh=>mesh.castShadow&&mesh.receiveShadow&&!mesh.customDepthMaterial),
        portableMaterials:meshes.every(mesh=>(Array.isArray(mesh.material)?mesh.material:[mesh.material])
          .every(material=>!material.customProgramCacheKey().includes("groom-volume-shadows"))),
        mixedRejected:false};
      restoredController.dispose();
      const mixed=new THREE.Group();mixed.userData.threejsGroomVolume=true;
      mixed.add(low.clone(),high.clone());
      try{restoredController.update(mixed,[light],camera,{resolution:32});}
      catch(error){result.mixedRejected=error.message.includes("different source volumes");}
      finally{restoredController.dispose();}
      return result;
    },
    callbackProbe(){
      controller.dispose();holder.visible=false;receiver.visible=false;blocker.visible=false;
      const makeMaterial=()=>new THREE.MeshStandardMaterial({color:"white",roughness:1});
      const left=makeMaterial(),right=makeMaterial();
      left.onBeforeCompile=function(shader){shader.fragmentShader=shader.fragmentShader.replace("#include <color_fragment>","#include <color_fragment>\\ndiffuseColor.rgb *= vec3(1.0,0.1,0.1);");};
      right.onBeforeCompile=function(shader){shader.fragmentShader=shader.fragmentShader.replace("#include <color_fragment>","#include <color_fragment>\\ndiffuseColor.rgb *= vec3(0.1,0.1,1.0);");};
      const a=new THREE.Mesh(new THREE.PlaneGeometry(.6,.6),left),b=new THREE.Mesh(new THREE.PlaneGeometry(.6,.6),right);
      a.position.x=-.45;b.position.x=.45;a.receiveShadow=b.receiveShadow=true;root.add(a,b);
      // Keep a registered volume active, away from both probe rectangles.
      holder.visible=true;low.visible=true;high.visible=stack.visible=duplicate.visible=lod.visible=false;holder.position.x=3;
      camera.position.set(0,0,5);camera.lookAt(0,0,0);camera.updateMatrixWorld();light.position.set(0,0,3);
      light.visible=true;hemisphere.intensity=0;ambient.intensity=.002;scene.environment=null;
      controller.update(root,[light],camera,{resolution:32});draw();
      const result={keysDistinct:left.customProgramCacheKey()!==right.customProgramCacheKey(),left:read([-.45,0,0]),right:read([.45,0,0])};
      controller.dispose();root.remove(a,b);a.geometry.dispose();b.geometry.dispose();left.dispose();right.dispose();
      return result;
    },
    close(){controller.dispose();environment.dispose();renderer.dispose();}
  }});
  const result=new THREE.Group();result.add(new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.1),new THREE.MeshBasicMaterial()));
  result.userData.preview={grid:false,lighting:{hairShadows:false}};
  return result;
};`;
}

Deno.test({
  name:
    "groom volume preview attenuates full source paths, retains opaque blockers and survives camera/LOD/export changes",
  ignore: !chromiumAvailable,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withViewer(fixtureSource(), async ({ page, errors }) => {
      try {
        const capture = (state: State) =>
          page.evaluate(
            (settings) =>
              (window as unknown as { volumeFixture: Fixture }).volumeFixture
                .render(settings),
            state,
          );
        const ordinary = await capture({ mode: "low", enabled: false });
        const sparse = await capture({ enabled: true });
        const dense = await capture({ mode: "high" });
        const stacked = await capture({ mode: "stack" });
        assert(
          sparse.center > ordinary.center + 12,
          `VSM must stop writing opaque groom sheets: ordinary=${ordinary.center}, volume=${sparse.center}`,
        );
        assert(
          sparse.center < sparse.clear - 2,
          `Sparse groom must still attenuate light: ${JSON.stringify(sparse)}`,
        );
        assert(
          dense.center < sparse.center - 8,
          `Higher fiber density must darken the receiver: ${
            JSON.stringify({ sparse, dense })
          }`,
        );
        assert(
          stacked.center < dense.center - 5,
          `A second hair path must increase extinction: ${
            JSON.stringify({ dense, stacked })
          }`,
        );
        assert(
          dense.edge > dense.center + 10,
          "Sparse boundary must transmit more light than the dense core",
        );
        assertEquals(sparse.groomCast, false);
        assertEquals(sparse.groomReceive, true);
        assertEquals(sparse.hasRuntimeDepth, true);
        assertEquals(sparse.hairShaderPreserved, true);
        const duplicate = await capture({ mode: "duplicate" });
        assertEquals(duplicate.instances, 1);
        assertAlmostEquals(duplicate.center, dense.center, 1);
        const lod = await capture({ mode: "lod" });
        assertEquals(lod.instances, 1);
        assertEquals(lod.volumes, 1);
        assertAlmostEquals(lod.center, dense.center, 1);
        const repeat = await capture({});
        assertEquals(repeat.builds, lod.builds);
        const farLod = await capture({ camera: [0, 0, 12] });
        assertEquals(farLod.builds, lod.builds);
        assertAlmostEquals(farLod.center, dense.center, 1);
        const camera = await capture({ camera: [.6, .2, 5] });
        assertEquals(camera.builds, lod.builds);
        assertAlmostEquals(camera.center, dense.center, 8);
        // An imposter renderer can change camera without a controller update.
        const alternate = await capture({
          camera: [-.4, .1, 5],
          skipUpdate: true,
        });
        assertAlmostEquals(alternate.center, dense.center, 8);
        const moved = await capture({ camera: [0, 0, 5], offset: 1.1 });
        assert(
          moved.center > dense.center + 20,
          "Nested transform must move the extinction footprint",
        );
        assert(moved.builds > camera.builds);
        const reversed = await capture({
          mode: "high",
          offset: 0,
          light: [0, 0, -3],
        });
        const side = await capture({ light: [3, 0, 3] });
        assert(side.builds > reversed.builds);
        assert(
          side.clear < side.center - 15,
          `Changing light direction must move the shadow across the receiver: ${
            JSON.stringify(side)
          }`,
        );
        const unblocked = await capture({ light: [0, 0, 3], blocker: false });
        const blocked = await capture({ blocker: true });
        assert(
          blocked.blocked < unblocked.blocked - 25,
          "Opaque head/objects must retain ordinary shadows",
        );
        const hidden = await capture({ hidden: true, blocker: false });
        assertEquals(hidden.instances, 0);
        assertEquals(hidden.textureBytes, 0);
        assert(hidden.center > dense.center + 20);
        const ambientClear = await capture({
          hidden: false,
          mode: "high",
          illumination: "hemisphere",
          receiverZ: .44,
          directional: false,
          ambientOcclusion: 0,
        });
        const ambientSparse = await capture({
          mode: "low",
          ambientOcclusion: 1,
        });
        const ambientDense = await capture({ mode: "high" });
        assert(
          ambientSparse.center < ambientClear.center - 3,
          `Hemisphere-only light must see sparse groom occlusion: ${
            JSON.stringify({ ambientClear, ambientSparse })
          }`,
        );
        assert(
          ambientDense.center < ambientSparse.center - 12,
          `Dense source fibers must occlude more ambient light: ${
            JSON.stringify({ ambientSparse, ambientDense })
          }`,
        );
        assertAlmostEquals(ambientDense.clear, ambientClear.clear, 1);
        assert(
          ambientDense.edge > ambientDense.center + 15,
          "Ambient occlusion must preserve a sparse boundary",
        );
        assertEquals(ambientDense.lights, 0);
        assertEquals(ambientDense.instances, 1);
        assertEquals(ambientDense.ambientResolution, 32);
        assertEquals(ambientDense.ambientDistance, .18);
        assertEquals(ambientDense.textureBytes, 2 * 32 ** 3 * 4);
        assertEquals(ambientDense.groomCast, true);
        assertEquals(ambientDense.groomReceive, true);
        assertEquals(ambientDense.hasRuntimeDepth, false);
        const halfAmbient = await capture({ ambientOcclusion: .5 });
        assertAlmostEquals(
          halfAmbient.center,
          (ambientClear.center + ambientDense.center) / 2,
          2,
        );
        assertEquals(halfAmbient.ambientBuilds, ambientDense.ambientBuilds);
        const normalAway = await capture({
          ambientOcclusion: 1,
          camera: [0, 0, -5],
        });
        assert(
          normalAway.center > ambientDense.center + 20,
          "Ambient visibility must follow the receiver normal, not darken every surface by a scalar",
        );
        assertAlmostEquals(normalAway.center, ambientClear.center, 2);
        assertEquals(normalAway.ambientBuilds, ambientDense.ambientBuilds);
        const ambientLod = await capture({
          mode: "lod",
          camera: [0, 0, 12],
        });
        assertEquals(ambientLod.ambientBuilds, ambientDense.ambientBuilds);
        assertEquals(ambientLod.instances, 1);
        assertAlmostEquals(ambientLod.center, ambientDense.center, 1);
        const ambientDuplicate = await capture({ mode: "duplicate" });
        assertEquals(
          ambientDuplicate.ambientBuilds,
          ambientDense.ambientBuilds,
        );
        assertEquals(ambientDuplicate.instances, 1);
        assertAlmostEquals(ambientDuplicate.center, ambientDense.center, 1);
        const ambientCamera = await capture({
          mode: "high",
          camera: [.6, .2, 5],
        });
        assertEquals(ambientCamera.ambientBuilds, ambientDense.ambientBuilds);
        assertAlmostEquals(ambientCamera.center, ambientDense.center, 8);
        const ambientAlternate = await capture({
          camera: [-.4, .1, 5],
          skipUpdate: true,
        });
        assertAlmostEquals(ambientAlternate.center, ambientDense.center, 8);
        const ambientDistant = await capture({
          camera: [0, 0, 5],
          receiverZ: 0,
        });
        assertEquals(ambientDistant.ambientBuilds, ambientDense.ambientBuilds);
        assertAlmostEquals(
          ambientDistant.center,
          ambientClear.center,
          1,
          "Local ambient influence must end before distant exposed skin",
        );
        const ambientMoved = await capture({ receiverZ: .44, offset: 1.1 });
        assert(ambientMoved.ambientBuilds > ambientDense.ambientBuilds);
        assertAlmostEquals(ambientMoved.center, ambientClear.center, 1);
        const directOnly = await capture({
          mode: "low",
          offset: 0,
          illumination: "directional",
          directional: true,
          ambientOcclusion: 0,
        });
        const combined = await capture({ ambientOcclusion: 1 });
        assertEquals(combined.builds, directOnly.builds);
        assertAlmostEquals(
          combined.center,
          directOnly.center,
          1,
          "Ambient occlusion must leave direct illumination unchanged",
        );
        assertEquals(combined.groomCast, false);
        const ambientLightChanged = await capture({ light: [3, 0, 3] });
        assert(ambientLightChanged.builds > combined.builds);
        assertEquals(ambientLightChanged.ambientBuilds, combined.ambientBuilds);
        const ambientOnly = await capture({
          directional: false,
          light: [0, 0, 3],
        });
        assertEquals(ambientOnly.groomCast, true);
        assertEquals(ambientOnly.hasRuntimeDepth, false);
        assertEquals(ambientOnly.ambientBuilds, combined.ambientBuilds);
        const environmentClear = await capture({
          mode: "high",
          illumination: "environment",
          metalness: 1,
          ambientOcclusion: 0,
        });
        const environmentOccluded = await capture({ ambientOcclusion: 1 });
        assert(
          environmentOccluded.center < environmentClear.center - 10,
          `Ambient volume must occlude rough environment reflections: ${
            JSON.stringify({ environmentClear, environmentOccluded })
          }`,
        );
        assertAlmostEquals(
          environmentOccluded.clear,
          environmentClear.clear,
          1,
        );
        const document = JSON.parse(
          await page.evaluate(() =>
            (window as unknown as { volumeFixture: Fixture }).volumeFixture
              .exportDocument()
          ),
        );
        const serialized = JSON.stringify(document);
        for (
          const term of [
            "worldToTexture",
            "groomVolumeMap",
            "groomVolumeAmbient",
            "positiveData",
            "negativeData",
            "voxelSize",
            "moments",
            "storedMass",
          ]
        ) {
          assert(
            !serialized.includes(term),
            `Runtime volume leaked into portable glTF: ${term}`,
          );
        }
        assertEquals(
          document.images.length,
          1,
          "Only the authored alpha atlas should be exported",
        );
        const roundTrip = await page.evaluate(() =>
          (window as unknown as { volumeFixture: Fixture }).volumeFixture
            .roundTrip()
        );
        assert(
          roundTrip.markers > 0,
          "glTF should retain the small groom marker",
        );
        assert(roundTrip.meshes > 0, "The actual GLB must reload its geometry");
        assertEquals(
          roundTrip.instances,
          0,
          "Portable GLB has no runtime volume",
        );
        assertEquals(roundTrip.ordinaryShadows, true);
        assertEquals(roundTrip.portableMaterials, true);
        assertEquals(roundTrip.mixedRejected, true);
        const restored = await page.evaluate(() =>
          (window as unknown as { volumeFixture: Fixture }).volumeFixture
            .cleanup()
        );
        assertEquals(restored, {
          callback: true,
          key: true,
          depth: true,
          cast: true,
          receive: true,
        });
        const probe = await page.evaluate(() =>
          (window as unknown as { volumeFixture: Fixture }).volumeFixture
            .callbackProbe()
        );
        assert(probe.keysDistinct);
        assert(
          probe.left[0] > probe.left[2] * 3,
          `First prior shader callback was lost: ${probe.left}`,
        );
        assert(
          probe.right[2] > probe.right[0] * 3,
          `Second prior shader callback reused another program: ${probe.right}`,
        );
        assertEquals(
          errors,
          [],
          "Volume shaders must compile without WebGL errors",
        );
      } finally {
        await page.evaluate(() =>
          (window as unknown as { volumeFixture?: Fixture }).volumeFixture
            ?.close()
        ).catch(() => {});
      }
    }, { width: 192, height: 192 });
  },
});
