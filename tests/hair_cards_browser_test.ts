import { assert, assertEquals } from "@std/assert";
import { chromiumAvailable, withViewer } from "./support.ts";

Deno.test({
  name: "hair cards preserve masked fiber textures and shading in portable GLB",
  ignore: !chromiumAvailable,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withViewer(
      `import {hairCards} from "js3";
export default () => hairCards([
 {points:[[0,1,0],[.1,.7,.05],[.12,.35,0],[.2,0,0]],width:.25,normals:[[0,0,1],[0,0,1],[0,0,1],[0,0,1]]},
 {points:[[.2,1,.02],[.25,.7,.02],[.4,.3,0]],width:[.15,.22,.01],normals:[[0,0,1],[0,0,1],[0,0,1]]}
],{seed:31,textureSize:128,color:"#573c29",camber:.14,widthSegments:4});`,
      async ({ page }) => {
        const report = await page.evaluate(() => window.modelViewer.inspect());
        assertEquals(report.counts.meshes, 1);
        assertEquals(report.warnings, []);
        const png = await page.locator("canvas").screenshot();
        assert(png.length > 1000);
        const encoded = await page.evaluate(() =>
          window.modelViewer.exportGLB()
        );
        const bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
        const header = new DataView(bytes.buffer);
        const doc = JSON.parse(
          new TextDecoder().decode(
            bytes.subarray(20, 20 + header.getUint32(12, true)),
          ).trim(),
        );
        assertEquals(doc.materials.length, 1);
        const material = doc.materials[0];
        assertEquals(material.alphaMode, "MASK");
        assert(material.alphaCutoff > 0 && material.alphaCutoff < 1);
        assertEquals(material.doubleSided, true);
        assert(material.pbrMetallicRoughness.baseColorTexture);
        assert(material.extensions.KHR_materials_anisotropy);
        assert(doc.images.length >= 1);
        for (const image of doc.images) {
          assert(typeof image.bufferView === "number");
        }
        const attributes = doc.meshes[0].primitives[0].attributes;
        assertEquals(doc.accessors[attributes.POSITION].count, 35);
        for (
          const key of [
            "POSITION",
            "NORMAL",
            "TANGENT",
            "TEXCOORD_0",
            "COLOR_0",
          ]
        ) assert(key in attributes);
      },
      { width: 256, height: 256 },
    );
  },
});
