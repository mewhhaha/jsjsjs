import { assert, assertEquals } from "@std/assert";
import * as esbuild from "esbuild";
import { startServer } from "../src/server.ts";
import { launchViewer, waitForModel } from "../src/browser.ts";

interface SampleOptions {
  light?: [number, number, number];
  intensity?: number;
  color?: string;
  tangent?: "u" | "v";
  absorption?: number;
  roughness?: number;
  depth?: number;
  tangentTexture?: boolean;
  shadow?: boolean;
}
interface ShaderTest {
  sample(options: SampleOptions): number[];
  dispose(): void;
}

Deno.test({
  name:
    "hair R/TT/TRT preview responds to light, tangent and pigment; exports physical fallback",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const directory = await Deno.makeTempDir({
      prefix: "js3-hair-shading-",
    });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    let viewer: Awaited<ReturnType<typeof launchViewer>> | undefined;
    try {
      const module =
        new URL("../src/hair-shading.ts", import.meta.url).pathname;
      const file = `${directory}/model.ts`;
      await Deno.writeTextFile(
        file,
        `
import {THREE, group} from "js3";
import {groomHairMaterial} from ${JSON.stringify(module)};
const tex = (rgba) => {
  const value = new THREE.DataTexture(new Uint8Array(rgba), 1, 1);
  value.needsUpdate = true;
  return value;
};
const map = tex([255,255,255,255]);
map.colorSpace = THREE.SRGBColorSpace;
const normalMap = tex([128,128,255,255]);
const tangentMap = tex([128,255,255,255]);
const depthMap = tex([128,0,0,255]);
const geometry = new THREE.PlaneGeometry(1,1);
geometry.computeTangents();
const material = groomHairMaterial({map,normalMap,tangentMap,depthMap,color:"#9b613a",vertexColors:false});
const plane = new THREE.Mesh(geometry, material);
const root = group([plane],{preview:{grid:false,direction:[0,0,1],background:"#000000"}});
const renderer = new THREE.WebGLRenderer({antialias:false,preserveDrawingBuffer:true});
renderer.setSize(48,48);
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace;
const scene = new THREE.Scene();
const camera = new THREE.OrthographicCamera(-.6,.6,.6,-.6,.1,10);
camera.position.set(0,0,3);
camera.lookAt(0,0,0);
const samplePlane = new THREE.Mesh(geometry);
samplePlane.receiveShadow=true;
scene.add(samplePlane);
const light = new THREE.DirectionalLight(0xffffff, 1);
light.shadow.mapSize.set(128,128);
light.shadow.camera.left=-.6;
light.shadow.camera.right=.6;
light.shadow.camera.top=.6;
light.shadow.camera.bottom=-.6;
light.shadow.camera.near=.05;
light.shadow.camera.far=3;
scene.add(light);
const blockerGeometry=new THREE.BoxGeometry(.5,.5,.08);
const blockerMaterial=new THREE.MeshBasicMaterial({colorWrite:false,depthWrite:false});
const blocker=new THREE.Mesh(blockerGeometry,blockerMaterial);
blocker.position.z=.35;
blocker.castShadow=true;
scene.add(blocker);
renderer.shadowMap.enabled=true;
renderer.shadowMap.type=THREE.PCFShadowMap;
window.hairShaderTest = {
  sample(options={}) {
    const material = groomHairMaterial({map,normalMap,depthMap,
      tangentMap:options.tangentTexture?tangentMap:undefined,
      color:options.color??"#9b613a",vertexColors:false,
      tangentAxis:options.tangent??"v", absorptionScale:options.absorption??1,
      roughness:options.roughness??.42,depthOcclusion:options.depth??0});
    samplePlane.material=material;
    light.position.fromArray(options.light??[0,0,1]);
    light.intensity=options.intensity??1;
    light.castShadow=options.shadow??false;
    renderer.shadowMap.needsUpdate=true;
    renderer.render(scene,camera);
    const gl=renderer.getContext();
    const data=new Uint8Array(4*4*4);
    gl.readPixels(22,22,4,4,gl.RGBA,gl.UNSIGNED_BYTE,data);
    const rgb=[0,0,0];
    for(let i=0;i<data.length;i+=4)for(let c=0;c<3;c++)rgb[c]+=data[i+c]/16;
    material.dispose();
    return rgb;
  },
  dispose(){renderer.dispose();blockerGeometry.dispose();blockerMaterial.dispose();}
};
export default ()=>root;
`,
      );
      server = await startServer(file, 0);
      viewer = await launchViewer(server.url, {
        renderer: "software",
        width: 192,
        height: 192,
      });
      const errors: string[] = [];
      viewer.page.on("console", (message) => {
        if (message.type() === "error") errors.push(message.text());
      });
      await waitForModel(viewer.page);
      const sample = (options: SampleOptions) =>
        viewer!.page.evaluate(
          (options) =>
            (window as unknown as { hairShaderTest: ShaderTest }).hairShaderTest
              .sample(options),
          options,
        );
      const total = (rgb: number[]) => rgb.reduce((a, b) => a + b, 0);
      const dark = await sample({ intensity: 0 });
      assertEquals(dark, [0, 0, 0]);
      const front = await sample({});
      const back = await sample({ light: [0, 0, -1], intensity: .25 });
      assert(total(front) > 15, `Expected reflected light, got ${front}`);
      assert(
        total(back) > 35,
        `Expected fiber transmission from backlight, got ${back}`,
      );
      assert(
        back[0] > back[2] * 1.25,
        `Pigment must color transmitted light, got ${back}`,
      );
      const white = await sample({
        light: [0, 0, -1],
        intensity: .25,
        absorption: 0,
      });
      assert(
        Math.max(...white) - Math.min(...white) <= 1,
        `Zero pigment must be neutral, got ${white}`,
      );
      assert(
        total(white) > total(back),
        "Absorption must remove energy from transmission",
      );
      const across = await sample({
        light: [0, .7, 1],
        tangent: "u",
        roughness: .3,
      });
      const along = await sample({
        light: [0, .7, 1],
        tangent: "v",
        roughness: .3,
      });
      assert(
        total(across) > total(along) * 2,
        `Highlight must follow fiber direction: ${across} vs ${along}`,
      );
      const occluded = await sample({ depth: 1 });
      assert(
        total(occluded) < total(front) * .65,
        "Opt-in baked visibility must attenuate lit interior texels",
      );
      const mapped = await sample({
        light: [0, .7, 1],
        tangent: "u",
        tangentTexture: true,
        roughness: .3,
      });
      assert(
        Math.abs(total(mapped) - total(along)) <= 3,
        `Texture direction must override the fallback UV axis: ${mapped} vs ${along}`,
      );
      const shadowed = await sample({ shadow: true });
      assert(
        total(shadowed) < total(front) * .1,
        `Ordinary light shadows must suppress all fiber lobes: ${shadowed} vs ${front}`,
      );
      assertEquals(errors, []);
      const encoded = await viewer.page.evaluate(() =>
        window.modelViewer.exportGLB()
      );
      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      const length = new DataView(bytes.buffer).getUint32(12, true);
      const document = JSON.parse(
        new TextDecoder().decode(bytes.subarray(20, 20 + length)).trim(),
      );
      const exported = document.materials[0];
      assertEquals(exported.alphaMode, "MASK");
      assert(exported.pbrMetallicRoughness.baseColorTexture);
      assert(exported.normalTexture);
      assert(exported.extensions.KHR_materials_anisotropy.anisotropyTexture);
      assertEquals(document.images.length, 3);
      assert(
        exported.extras.threejsGroomShading.export.includes(
          "no custom hair BSDF",
        ),
      );
      await viewer.page.evaluate(() =>
        (window as unknown as { hairShaderTest: ShaderTest }).hairShaderTest
          .dispose()
      );
    } finally {
      await viewer?.browser.close();
      await server?.close();
      esbuild.stop();
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test({
  name: "preview fill light cannot transmit through an opaque groom support",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const directory = await Deno.makeTempDir({ prefix: "js3-hair-fill-" });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    let viewer: Awaited<ReturnType<typeof launchViewer>> | undefined;
    try {
      const module =
        new URL("../src/hair-shading.ts", import.meta.url).pathname;
      const file = `${directory}/model.ts`;
      const source = (shadows: boolean, masked = false) => `
import {THREE,group} from "js3";
import {groomHairMaterial,matchGroomShadowCoverage} from ${
        JSON.stringify(module)
      };
export default ()=>{
  const geometry=new THREE.PlaneGeometry(1,1);
  geometry.computeTangents();
  geometry.rotateZ(Math.atan2(5,3));
  const hair=new THREE.Mesh(geometry,groomHairMaterial({color:"#9b613a",vertexColors:false,tangentAxis:"u"}));
  const mask=new THREE.DataTexture(new Uint8Array([255,255,255,90]),1,1);
  mask.needsUpdate=true;
  const support=new THREE.Mesh(new THREE.SphereGeometry(.28,24,16),${
        masked
          ? 'groomHairMaterial({map:mask,alphaTest:.3,alphaToCoverage:true,color:"#808080"})'
          : 'new THREE.MeshStandardMaterial({color:"#808080"})'
      });
  support.position.set(-.4,.24,-.32);
  matchGroomShadowCoverage(support);
  const root=group([hair,${
        masked ? "support.clone()" : "support"
      }],{preview:{grid:false,direction:[0,0,1],target:[0,0,0],radius:.8,
    exposure:1,background:"#000000",lighting:{hemisphere:0,key:0,fill:.4,shadows:${shadows}}}});
  Object.assign(window,{hairFillRoot:root});
  root.userData.maskedSupport=${masked};
  return root;
};`;
      await Deno.writeTextFile(file, source(false));
      server = await startServer(file, 0);
      viewer = await launchViewer(server.url, {
        renderer: "software",
        width: 192,
        height: 192,
      });
      await waitForModel(viewer.page);
      const capture = () =>
        viewer!.page.evaluate(() => {
          window.modelViewer.render();
          const gl = document.querySelector("canvas")!.getContext("webgl2")!;
          const data = new Uint8Array(4 * 4 * 4);
          gl.readPixels(94, 94, 4, 4, gl.RGBA, gl.UNSIGNED_BYTE, data);
          return Array.from(data).filter((_, i) => i % 4 !== 3).reduce(
            (a, b) => a + b,
            0,
          );
        });
      const unshadowed = await capture();
      assert(
        unshadowed > 100,
        `Expected visible transmitted fill light, got ${unshadowed}`,
      );
      await Deno.writeTextFile(file, source(true));
      await viewer.page.waitForFunction(() =>
        (window as unknown as {
          hairFillRoot: {
            userData: { preview: { lighting: { shadows: boolean } } };
          };
        }).hairFillRoot.userData.preview.lighting.shadows
      );
      await waitForModel(viewer.page);
      const shadowed = await capture();
      assert(
        shadowed < unshadowed * .15,
        `Opaque support must block backfill transmission: ${shadowed} vs ${unshadowed}`,
      );
      await Deno.writeTextFile(file, source(true, true));
      await viewer.page.waitForFunction(() =>
        (window as unknown as {
          hairFillRoot: { userData: { maskedSupport: boolean } };
        }).hairFillRoot.userData.maskedSupport
      );
      await waitForModel(viewer.page);
      const masked = await capture();
      assert(
        masked < unshadowed * .15,
        `Groom alpha-to-coverage shadows must keep the authored .3 cutoff: ${masked} vs ${unshadowed}`,
      );
    } finally {
      await viewer?.browser.close();
      await server?.close();
      esbuild.stop();
      await Deno.remove(directory, { recursive: true });
    }
  },
});
