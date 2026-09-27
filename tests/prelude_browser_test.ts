import { assert, assertEquals } from "@std/assert";
import * as esbuild from "esbuild";
import { startServer } from "../src/server.ts";
import { launchViewer, waitForModel } from "../src/browser.ts";

Deno.test({
  name: "external prelude model shares Three.js and exports authored geometry",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const directory = await Deno.makeTempDir({ prefix: "js3 prelude " });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    let viewer: Awaited<ReturnType<typeof launchViewer>> | undefined;
    try {
      const source = `import * as RawThree from "three";
import { box, group, material, repeat, THREE, subtract, offsetProfile, bevel } from "js3";
import { roundedBox } from "js3/prelude";
import { box as legacyBox } from "threejs";
import { roundedBox as legacyRoundedBox } from "threejs/prelude";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
export default async function buildModel() {
  if (legacyBox !== box || legacyRoundedBox !== roundedBox) throw new Error("Legacy prelude imports must resolve to the same implementation");
  const paint = material("#aabbcc");
  const body = await subtract(box([2, 1, 3]), box([.5, 3, .5]), { name: "body", material: paint });
  const [outline] = await offsetProfile([[0,0],[1,0],[1,1],[0,1]], .1);
  if (!bevel(outline).geometry.getAttribute("normal")) throw new Error("Missing bevel normals");
  if (!(body instanceof RawThree.Mesh) || THREE.Mesh !== RawThree.Mesh) {
    throw new Error("Multiple Three.js instances");
  }
  const rounded = roundedBox([1, 1, 1], 0.1, { name: "rounded", position: [0, 3, 0] });
  if (!(rounded.geometry instanceof RoundedBoxGeometry)) throw new Error("Wrong addon geometry");
  return group([body, rounded, repeat(3, [2, 0, 0], (i) => box([1, 1, 1], {name: "copy_" + i}))], {name:"model"});
}`;
      const file = `${directory}/a model.ts`;
      await Deno.writeTextFile(file, source);
      server = await startServer(file, 0);
      viewer = await launchViewer(server.url, { renderer: "software" });
      await waitForModel(viewer.page);
      const report = await viewer.page.evaluate(() =>
        window.modelViewer.inspect()
      );
      assertEquals(report.counts.meshes, 5);
      assertEquals(report.bounds.min, [-1, -0.5, -1.5]);
      assertEquals(report.bounds.max[0], 4.5);
      const obj = await viewer.page.evaluate(() =>
        window.modelViewer.exportOBJ()
      );
      assert(obj.includes("o body"));
      assert(obj.includes("o copy_2"));
      const glb = await viewer.page.evaluate(() =>
        window.modelViewer.exportGLB()
      );
      assertEquals(atob(glb).slice(0, 4), "glTF");
    } finally {
      await viewer?.browser.close();
      await server?.close();
      esbuild.stop();
      await Deno.remove(directory, { recursive: true });
    }
  },
});
