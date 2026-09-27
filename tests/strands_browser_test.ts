import { assert, assertEquals } from "@std/assert";
import * as esbuild from "esbuild";
import { startServer } from "../src/server.ts";
import { launchViewer, waitForModel } from "../src/browser.ts";

Deno.test({
  name:
    "strand grooms render headlessly and export curves, taper and anisotropic mesh data",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const directory = await Deno.makeTempDir({ prefix: "js3 strands " });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    let viewer: Awaited<ReturnType<typeof launchViewer>> | undefined;
    try {
      const file = `${directory}/model.ts`;
      await Deno.writeTextFile(
        file,
        `import {hair,group,THREE} from "js3";
export default () => {
 const scalp=new THREE.Mesh(new THREE.PlaneGeometry(1,1));
 scalp.rotation.x=-Math.PI/2;
 const coat=hair(scalp,{roots:{count:64,seed:13},groom:{length:.3,radius:.01,tipRadius:0,segments:8,guides:[{points:[[0,0,0],[.1,.3,0]]}]},render:{name:"test-coat",tipColor:"#cc9955"}});
 return group([scalp,coat]);
};`,
      );
      server = await startServer(file, 0);
      viewer = await launchViewer(server.url, {
        renderer: "software",
        width: 256,
        height: 256,
      });
      await waitForModel(viewer.page);
      const report = await viewer.page.evaluate(() =>
        window.modelViewer.inspect()
      );
      assertEquals(report.counts.meshes, 2);
      const png = await viewer.page.locator("canvas").screenshot();
      assert(png.length > 2000);
      const encoded = await viewer.page.evaluate(() =>
        window.modelViewer.exportGLB()
      );
      const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      const header = new DataView(bytes.buffer);
      const doc = JSON.parse(
        new TextDecoder().decode(
          bytes.subarray(20, 20 + header.getUint32(12, true)),
        ).trim(),
      );
      const coat = doc.nodes.find((node: { name?: string }) =>
        node.name === "test-coat"
      );
      assert(coat.extras.threejsStrandId);
      assertEquals(coat.extras.threejsStrands.strands.length, 64);
      assertEquals(coat.extras.threejsStrands.strands[0].radii.at(-1), 0);
      assertEquals(coat.extras.threejsStrands.guides.length, 1);
      assertEquals(coat.extras.threejsStrands.representation, "tubes");
      const meshNode = doc.nodes.find((
        node: { extras?: { threejsStrandPreview?: boolean } },
      ) => node.extras?.threejsStrandPreview);
      const primitive = doc.meshes[meshNode.mesh].primitives[0];
      for (const attribute of ["NORMAL", "TANGENT", "TEXCOORD_0", "COLOR_0"]) {
        assert(attribute in primitive.attributes);
      }
      assert(doc.extensionsUsed.includes("KHR_materials_anisotropy"));
    } finally {
      await viewer?.browser.close();
      await server?.close();
      esbuild.stop();
      await Deno.remove(directory, { recursive: true });
    }
  },
});
