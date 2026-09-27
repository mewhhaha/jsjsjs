import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import * as esbuild from "esbuild";
import { fileURLToPath } from "node:url";
import { startServer } from "../src/server.ts";
import { launchViewer, waitForModel } from "../src/browser.ts";

type Shading = "hair" | "standard" | "ordinary";
type Target =
  | "default"
  | "msaa"
  | "single"
  | "transparent"
  | "transparent-default"
  | "no-msaa-default";
interface Sample {
  rgb: number[];
  alpha: number;
  samples: number;
}
interface Fixture {
  values: number[];
  sample(
    shading: Shading,
    index: number,
    target: Target,
    cutoff?: number,
  ): Sample;
  callbacks(): {
    left: Sample;
    right: Sample;
    custom: Sample;
    distinct: boolean;
    customKey: string;
    idempotent: boolean;
  };
  exportDocument(shading: Shading): Promise<string>;
  close(): void;
}

function fixtureSource() {
  const path = (name: string) =>
    JSON.stringify(
      fileURLToPath(new URL(`../src/${name}.ts`, import.meta.url)),
    );
  return `
import * as THREE from "three";
import {GLTFExporter} from "three/addons/exporters/GLTFExporter.js";
import {createGroom} from ${path("groom-data")};
import {compileGroom,renderGroom} from ${path("groom")};
import {groomHairMaterial,preserveGroomCardCoverage} from ${
    path("hair-shading")
  };

export default () => {
  const source=createGroom({version:1,seed:7,layers:[{id:"test",children:1,radius:.012,tipRadius:.0001,
    color:"#ffffff",tipColor:"#ffffff",clump:0,depth:0,frizz:0,lengthVariation:0}],
    guides:[{id:"strand",layer:"test",points:[[0,-.5,0],[0,.5,0]],width:.3,normals:[[0,0,1],[0,0,1]]}]});
  const compiled=compileGroom(source,{volume:false,segments:16,atlas:{textureSize:128,tileWidth:32,tileHeight:64}});
  const unique=[...new Set(compiled.baked.atlas.data.filter((_,i)=>i%4===3))];
  // Use coverage values produced by the real area-filtered fiber bake. A
  // constant texel isolates coverage from geometry edges and texture gradients.
  const values=[0,6,64,128,192,255].map(wanted=>unique.reduce((best,value)=>
    Math.abs(value-wanted)<Math.abs(best-wanted)?value:best,unique[0]));
  const pixels=new Uint8Array([255,255,255,255]);
  const map=new THREE.DataTexture(pixels,1,1);map.needsUpdate=true;
  const materials={};
  const configure=material=>{
    material.map=map;material.emissive.setRGB(1,1,1);material.color.setRGB(0,0,0);
    material.vertexColors=false;material.normalMap=null;material.anisotropyMap=null;
    material.needsUpdate=true;return material;
  };
  for(const shading of ["hair","standard"]){
    const groom=renderGroom(compiled,{representation:"cards",shading});
    let material;groom.traverse(node=>{if(node.isMesh)material=node.material;});
    materials[shading]=configure(material);
  }
  // A generic/procedural hair material must retain its existing cutout rule.
  materials.ordinary=configure(groomHairMaterial({map,alphaTest:.03,vertexColors:false}));
  const renderer=new THREE.WebGLRenderer({alpha:true,antialias:true,preserveDrawingBuffer:true});
  const singleRenderer=new THREE.WebGLRenderer({alpha:true,antialias:false,preserveDrawingBuffer:true});
  for(const r of [renderer,singleRenderer]){
    r.setSize(64,64,false);r.outputColorSpace=THREE.LinearSRGBColorSpace;r.toneMapping=THREE.NoToneMapping;
  }
  const msaa=new THREE.WebGLRenderTarget(64,64,{samples:4});
  const single=new THREE.WebGLRenderTarget(64,64,{samples:0});
  const scene=new THREE.Scene(),camera=new THREE.OrthographicCamera(-1,1,1,-1,.01,10);
  camera.position.z=2;camera.lookAt(0,0,0);
  const geometry=new THREE.PlaneGeometry(2,2);geometry.computeTangents();
  const plane=new THREE.Mesh(geometry,materials.hair);scene.add(plane);
  const draw=(material,targetName)=>{
    const r=targetName==="no-msaa-default"?singleRenderer:renderer;
    const target=targetName==="single"?single:["msaa","transparent"].includes(targetName)?msaa:null;
    r.setRenderTarget(target);r.setClearColor(0,targetName.startsWith("transparent")?0:1);
    const samples=r.getContext().getParameter(r.getContext().SAMPLES);
    plane.material=material;r.render(scene,camera);
    const data=new Uint8Array(16*16*4);
    if(target)r.readRenderTargetPixels(target,24,24,16,16,data);
    else{const gl=r.getContext();gl.readPixels(24,24,16,16,gl.RGBA,gl.UNSIGNED_BYTE,data);}
    const rgba=[0,0,0,0];for(let i=0;i<data.length;i++)rgba[i%4]+=data[i]/256;
    return {rgb:rgba.slice(0,3),alpha:rgba[3],samples};
  };
  const setValue=value=>{pixels[3]=value;map.needsUpdate=true;};
  Object.assign(window,{groomCoverageFixture:{values,
    sample(shading,index,target,cutoff=.03){
      setValue(values[index]);materials[shading].alphaTest=cutoff;return draw(materials[shading],target);
    },
    callbacks(){
      setValue(values[3]);
      const make=()=>new THREE.MeshStandardMaterial({map,color:"black",emissive:"white",alphaTest:.03,alphaToCoverage:true});
      const left=make(),right=make(),custom=make();
      left.onBeforeCompile=function(shader){shader.fragmentShader=shader.fragmentShader.replace("#include <emissivemap_fragment>","#include <emissivemap_fragment>\\ntotalEmissiveRadiance *= vec3(1.0,0.0,0.0);");};
      right.onBeforeCompile=function(shader){shader.fragmentShader=shader.fragmentShader.replace("#include <emissivemap_fragment>","#include <emissivemap_fragment>\\ntotalEmissiveRadiance *= vec3(0.0,0.0,1.0);");};
      custom.onBeforeCompile=function(shader){shader.fragmentShader=shader.fragmentShader.replace("#include <emissivemap_fragment>","#include <emissivemap_fragment>\\ntotalEmissiveRadiance *= vec3(0.0,1.0,0.0);");};
      custom.customProgramCacheKey=function(){return "authored-custom-"+this.alphaTest;};
      for(const material of [left,right,custom])preserveGroomCardCoverage(material);
      const key=left.customProgramCacheKey(),hook=left.onBeforeCompile;
      preserveGroomCardCoverage(left);
      const result={left:draw(left,"default"),right:draw(right,"default"),custom:draw(custom,"default"),
        distinct:left.customProgramCacheKey()!==right.customProgramCacheKey(),customKey:custom.customProgramCacheKey(),
        idempotent:left.onBeforeCompile===hook&&left.customProgramCacheKey()===key};
      for(const material of [left,right,custom])material.dispose();return result;
    },
    async exportDocument(shading){
      setValue(values[3]);materials[shading].alphaTest=.03;
      const result=new THREE.Mesh(geometry,materials[shading]);
      const buffer=await new GLTFExporter().parseAsync(result,{binary:true});
      const bytes=new Uint8Array(buffer),length=new DataView(buffer).getUint32(12,true);
      return new TextDecoder().decode(bytes.subarray(20,20+length)).trim();
    },
    close(){msaa.dispose();single.dispose();renderer.dispose();singleRenderer.dispose();map.dispose();geometry.dispose();}
  }});
  const result=new THREE.Group();result.add(new THREE.Mesh(new THREE.BoxGeometry(.1,.1,.1),new THREE.MeshBasicMaterial()));
  result.userData.preview={grid:false,lighting:{shadows:false}};
  return result;
};`;
}

Deno.test({
  name:
    "source-baked groom cards preserve fractional MSAA coverage with cutout fallbacks and portable materials",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const directory = await Deno.makeTempDir({
      prefix: "js3-groom-alpha-",
    });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    let viewer: Awaited<ReturnType<typeof launchViewer>> | undefined;
    const errors: string[] = [];
    try {
      const file = `${directory}/model.ts`;
      await Deno.writeTextFile(file, fixtureSource());
      server = await startServer(file, 0);
      viewer = await launchViewer(server.url, {
        renderer: "software",
        width: 192,
        height: 192,
      });
      viewer.page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await waitForModel(viewer.page);
      const values = await viewer.page.evaluate(() =>
        (window as unknown as { groomCoverageFixture: Fixture })
          .groomCoverageFixture.values
      );
      assertEquals(values[0], 0);
      assert(values[1] > 0 && values[1] < 255 * .03);
      assertEquals(values[5], 255);
      for (const [index, wanted] of [[2, 64], [3, 128], [4, 192]]) {
        assertAlmostEquals(values[index], wanted, 8);
      }
      const sample = (
        shading: Shading,
        index: number,
        target: Target,
        cutoff = .03,
      ) =>
        viewer!.page.evaluate(
          ({ shading, index, target, cutoff }) =>
            (window as unknown as { groomCoverageFixture: Fixture })
              .groomCoverageFixture.sample(shading, index, target, cutoff),
          { shading, index, target, cutoff },
        );
      for (const shading of ["hair", "standard"] as const) {
        for (const target of ["default", "msaa"] as const) {
          const opaque = await sample(shading, 5, target);
          assert(opaque.samples >= 2, "The coverage test requires real MSAA");
          assertAlmostEquals(opaque.rgb[0], 255, 1);
          for (const index of [0, 1]) {
            assertEquals((await sample(shading, index, target)).rgb, [0, 0, 0]);
          }
          for (const index of [2, 3, 4]) {
            const measured = await sample(shading, index, target);
            assertAlmostEquals(
              measured.rgb[0] / opaque.rgb[0],
              values[index] / 255,
              .5 / opaque.samples + .04,
              `${shading}/${target} promoted area coverage ${
                values[index]
              }: ${measured.rgb}`,
            );
          }
          assertEquals((await sample(shading, 2, target, .3)).rgb, [0, 0, 0]);
        }
        for (const target of ["single", "no-msaa-default"] as const) {
          const clear = await sample(shading, 0, target);
          assertEquals(clear.samples, 0);
          assertEquals(clear.rgb, [0, 0, 0]);
          assertEquals((await sample(shading, 1, target)).rgb, [0, 0, 0]);
          assertAlmostEquals((await sample(shading, 3, target)).rgb[0], 255, 1);
        }
        for (const target of ["transparent", "transparent-default"] as const) {
          const clear = await sample(shading, 0, target);
          assertEquals(clear.alpha, 0);
          const cutoff = await sample(shading, 1, target);
          assertEquals(cutoff.alpha, 0);
          const covered = await sample(shading, 3, target);
          assertAlmostEquals(covered.rgb[0], 255, 1);
          assertAlmostEquals(
            covered.alpha,
            255,
            1,
            "Transparent MSAA fallback must not square alpha or produce invalid premultiplication",
          );
        }
        const restored = await sample(shading, 3, "default");
        assertAlmostEquals(restored.rgb[0] / 255, values[3] / 255, .16);
        const document = JSON.parse(
          await viewer.page.evaluate(
            (shading) =>
              (window as unknown as { groomCoverageFixture: Fixture })
                .groomCoverageFixture.exportDocument(shading),
            shading,
          ),
        );
        assertEquals(document.materials[0].alphaMode, "MASK");
        assertAlmostEquals(document.materials[0].alphaCutoff, .03, 1e-9);
        assert(document.materials[0].pbrMetallicRoughness.baseColorTexture);
        assert(!JSON.stringify(document).includes("groomCardCoverageMsaa"));
      }
      const ordinary = await sample("ordinary", 3, "default");
      assertAlmostEquals(
        ordinary.rgb[0],
        255,
        1,
        "Ordinary/procedural materials must retain their existing alpha-test behavior",
      );
      const callbacks = await viewer.page.evaluate(() =>
        (window as unknown as { groomCoverageFixture: Fixture })
          .groomCoverageFixture.callbacks()
      );
      assert(callbacks.distinct);
      assert(callbacks.idempotent);
      assert(callbacks.customKey.startsWith("authored-custom-0.03|"));
      assert(callbacks.left.rgb[0] > 50 && callbacks.left.rgb[2] === 0);
      assert(callbacks.right.rgb[2] > 50 && callbacks.right.rgb[0] === 0);
      assert(callbacks.custom.rgb[1] > 50 && callbacks.custom.rgb[0] === 0);
      assertEquals(errors, [], "Coverage shaders must compile without errors");
    } finally {
      if (viewer) {
        await viewer.page.evaluate(() =>
          (window as unknown as { groomCoverageFixture?: Fixture })
            .groomCoverageFixture?.close()
        ).catch(() => {});
      }
      await viewer?.browser.close();
      await server?.close();
      esbuild.stop();
      await Deno.remove(directory, { recursive: true });
    }
  },
});
