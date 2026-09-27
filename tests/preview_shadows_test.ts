import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import * as esbuild from "esbuild";
import type * as THREE from "three";
import { startServer } from "../src/server.ts";
import { launchViewer, waitForModel } from "../src/browser.ts";

Deno.test({
  name:
    "preview shadows follow translated models and reset after a live rebuild",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const directory = await Deno.makeTempDir({ prefix: "js3-shadows-" });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    let viewer: Awaited<ReturnType<typeof launchViewer>> | undefined;
    const source = (shadows?: boolean) => `
import { THREE, box, group, hairCards } from "js3";
export default () => {
  const paint = new THREE.MeshStandardMaterial({color:"#b4b4b4",roughness:1});
  const root = group([
    box([6,.06,6],{material:paint}),
    box([1.2,1.6,1.2],{position:[0,.83,0],material:paint}),
    hairCards([{points:[[1.7,.15,0],[1.7,1.4,0]],width:.7,normals:[[0,0,1],[0,0,1]]}],
      {textureSize:128,color:"#695746"}),
    box([.9,.9,.01],{name:"transparent-overlay",position:[-2,.8,.4],
      material:new THREE.MeshStandardMaterial({color:"#ffaa99",transparent:true,
        opacity:.25,alphaTest:.015,depthWrite:false})})
  ],{position:[13,2,-8],preview:{grid:false,direction:[-4,5,-6],padding:1.05,
    exposure:1,lighting:{hemisphere:.08,key:3,fill:0${
      shadows === undefined ? "" : `,shadows:${shadows}`
    }}}});
  root.children[1].name = "cast-only";
  root.children[1].userData.previewShadows = {receive:false};
  root.children[2].traverse((mesh) => {
    if (mesh.isMesh) {
      mesh.name = "receive-only";
      mesh.userData.previewShadows = {cast:false};
    }
  });
  Object.assign(window,{shadowTestRoot:root});
  return root;
};`;
    try {
      const file = `${directory}/model.ts`;
      await Deno.writeTextFile(file, source());
      server = await startServer(file, 0);
      viewer = await launchViewer(server.url, {
        renderer: "software",
        width: 320,
        height: 320,
      });
      await waitForModel(viewer.page);
      const capture = () =>
        viewer!.page.evaluate(() => {
          window.modelViewer.render();
          const canvas = document.querySelector("canvas")!;
          const gl = canvas.getContext("webgl2")!;
          const data = new Uint8Array(canvas.width * canvas.height * 4);
          gl.readPixels(
            0,
            0,
            canvas.width,
            canvas.height,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            data,
          );
          const root = (window as unknown as { shadowTestRoot: THREE.Object3D })
            .shadowTestRoot;
          const key = root.parent!.children.find((child) =>
            child.type === "DirectionalLight"
          ) as THREE.DirectionalLight;
          const meshes: { name: string; cast: boolean; receive: boolean }[] =
            [];
          root.traverse((child) => {
            if ((child as THREE.Mesh).isMesh) {
              meshes.push({
                name: child.name,
                cast: child.castShadow,
                receive: child.receiveShadow,
              });
            }
          });
          return {
            pixels: Array.from(data),
            keyPosition: key.position.toArray(),
            target: key.target.position.toArray(),
            cast: key.castShadow,
            mapSize: key.shadow.mapSize.toArray(),
            hasMap: key.shadow.map !== null,
            shadowNear: key.shadow.camera.near,
            shadowFar: key.shadow.camera.far,
            meshes,
          };
        });
      const before = await capture();
      assertEquals(before.cast, false);
      assertEquals(before.hasMap, false);
      const rebuild = async (shadows: boolean) => {
        await Deno.writeTextFile(file, source(shadows));
        await viewer!.page.waitForFunction((enabled) => {
          const root = (window as unknown as { shadowTestRoot: THREE.Object3D })
            .shadowTestRoot;
          return window.modelViewer.ready &&
            root.userData.preview?.lighting?.shadows === enabled;
        }, shadows);
        await waitForModel(viewer!.page);
      };
      await rebuild(true);
      const on = await capture();
      assertEquals(on.cast, true);
      assertEquals(on.hasMap, true);
      assertEquals(on.mapSize, [2048, 2048]);
      assertEquals(on.meshes.length, 4);
      assert(
        on.meshes.filter(({ name }) =>
          !["transparent-overlay", "cast-only", "receive-only"].includes(name)
        )
          .every(({ cast, receive }) => cast && receive),
      );
      assertEquals(
        on.meshes.find(({ name }) => name === "transparent-overlay"),
        { name: "transparent-overlay", cast: false, receive: false },
      );
      assertEquals(
        on.meshes.find(({ name }) => name === "cast-only"),
        { name: "cast-only", cast: true, receive: false },
      );
      assertEquals(
        on.meshes.find(({ name }) => name === "receive-only"),
        { name: "receive-only", cast: false, receive: true },
      );
      assertAlmostEquals(on.target[0], 13, 1e-6);
      assertAlmostEquals(on.target[2], -8, 1e-6);
      assert(on.shadowNear > 0 && on.shadowFar > on.shadowNear);
      let darker = 0, totalDifference = 0;
      for (let i = 0; i < before.pixels.length; i += 4) {
        const a = before.pixels[i] + before.pixels[i + 1] +
          before.pixels[i + 2];
        const b = on.pixels[i] + on.pixels[i + 1] + on.pixels[i + 2];
        if (a - b > 45) darker++;
        totalDifference += Math.abs(a - b);
      }
      assert(
        darker > 200,
        `Expected a visible cast shadow; got ${darker} darker pixels`,
      );
      assert(totalDifference > 20000);
      await rebuild(false);
      const after = await capture();
      assertEquals(after.cast, false);
      assertEquals(after.hasMap, false);
      assertEquals(after.keyPosition, [4, 7, 5]);
      assertEquals(after.target, [0, 0, 0]);
      let resetDifference = 0;
      for (let i = 0; i < before.pixels.length; i++) {
        resetDifference += Math.abs(before.pixels[i] - after.pixels[i]);
      }
      assert(
        resetDifference / before.pixels.length < .01,
        "Disabling shadows must restore the original lighting",
      );
    } finally {
      await viewer?.browser.close();
      await server?.close();
      esbuild.stop();
      await Deno.remove(directory, { recursive: true });
    }
  },
});
