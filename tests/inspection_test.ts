import { assert, assertEquals } from "@std/assert";
import type { ModelView } from "../web/api.ts";
import { chromiumAvailable, withViewer } from "./support.ts";

Deno.test({
  name:
    "headless inspection reports authored geometry and renders all standard views",
  ignore: !chromiumAvailable,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withViewer(
      `import * as THREE from "three";
export default function buildModel() {
  const group = new THREE.Group();
  group.name = "assembly";
  const geometry = new THREE.BoxGeometry(2, 4, 6);
  const material = new THREE.MeshStandardMaterial({ color: "#123456" });
  material.name = "paint";
  const box = new THREE.Mesh(geometry, material);
  box.name = "box";
  box.position.x = 3;
  const copies = new THREE.InstancedMesh(geometry, material, 2);
  copies.name = "copies";
  copies.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-3, 0, 0));
  copies.setMatrixAt(1, new THREE.Matrix4().makeTranslation(-6, 0, 0));
  group.add(box, copies);
  return group;
}`,
      async ({ page }) => {
        const inspection = await page.evaluate(() =>
          window.modelViewer.inspect()
        );
        assertEquals(inspection.bounds, {
          min: [-7, -2, -3],
          max: [4, 2, 3],
          size: [11, 4, 6],
          center: [-1.5, 0, 0],
        });
        assertEquals(inspection.counts, {
          objects: 3,
          meshes: 2,
          instances: 3,
          geometries: 1,
          materials: 1,
          vertices: 72,
          triangles: 36,
        });
        assertEquals(inspection.objects.map((object) => object.name), [
          "assembly",
          "box",
          "copies",
        ]);
        assertEquals(inspection.materials, [{
          name: "paint",
          type: "MeshStandardMaterial",
          color: "#123456",
          opacity: 1,
          transparent: false,
        }]);
        assert(
          inspection.warnings.some((warning) => warning.includes("Instanced")),
        );
        const views: ModelView[] = [
          "iso",
          "front",
          "back",
          "left",
          "right",
          "top",
          "bottom",
        ];
        const images = new Set<string>();
        for (const view of views) {
          await page.evaluate((view) => window.modelViewer.setView(view), view);
          const png = await page.locator("canvas").screenshot();
          assert(png.length > 1000, `${view} rendered no useful image`);
          images.add(Array.from(png).join(","));
        }
        assert(images.size >= 4, "Changing views should change the image");
        assertEquals(await page.evaluate(() => window.modelViewer.error), null);
      },
      { width: 320, height: 240 },
    );
  },
});
