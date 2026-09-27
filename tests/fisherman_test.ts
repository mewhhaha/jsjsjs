import { assert, assertEquals } from "@std/assert";
import * as esbuild from "esbuild";
import { startServer } from "../src/server.ts";
import { launchViewer, waitForModel } from "../src/browser.ts";

Deno.test({
  name:
    "fisherman: weighted rig deforms, GLB embeds materials and animation, WASD moves camera",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const server = await startServer("examples/fisherman.ts", 0);
    const { browser, page } = await launchViewer(server.url, {
      renderer: "software",
      width: 640,
      height: 800,
    });
    try {
      await waitForModel(page);
      const rig = await page.evaluate(async () => {
        const { default: build } = await import("/model.js");
        const { Vector3 } = await import("/three.js");
        const model = await build();
        const face = model.getObjectByName("Fisherman_face");
        const before = face.getVertexPosition(40, new Vector3()).clone();
        model.getObjectByName("Head").rotation.y += 0.35;
        model.updateMatrixWorld(true);
        const after = face.getVertexPosition(40, new Vector3());
        let maxWeightError = 0;
        model.traverse(
          (
            object: {
              isSkinnedMesh?: boolean;
              geometry: {
                getAttribute(
                  name: string,
                ): {
                  count: number;
                  getX(i: number): number;
                  getY(i: number): number;
                  getZ(i: number): number;
                  getW(i: number): number;
                };
              };
            },
          ) => {
            if (!object.isSkinnedMesh) return;
            const weights = object.geometry.getAttribute("skinWeight");
            for (let i = 0; i < weights.count; i++) {
              maxWeightError = Math.max(
                maxWeightError,
                Math.abs(
                  weights.getX(i) + weights.getY(i) + weights.getZ(i) +
                    weights.getW(i) - 1,
                ),
              );
            }
          },
        );
        return {
          bones: face.skeleton.bones.length,
          deformed: before.distanceTo(after),
          maxWeightError,
        };
      });
      assertEquals(rig.bones, 55);
      assert(rig.deformed > 0.005);
      assert(rig.maxWeightError < 0.00001);
      const base64 = await page.evaluate(() => window.modelViewer.exportGLB());
      const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
      const view = new DataView(bytes.buffer);
      assertEquals(view.getUint32(0, true), 0x46546c67);
      const length = view.getUint32(12, true);
      const gltf = JSON.parse(
        new TextDecoder().decode(bytes.subarray(20, 20 + length)),
      );
      assertEquals(gltf.skins[0].joints.length, 55);
      assertEquals(gltf.animations[0].name, "Breathing_idle");
      assert(
        gltf.materials.some((m: { normalTexture?: unknown }) =>
          m.normalTexture
        ),
      );
      assert(
        gltf.images.every((i: { bufferView?: number }) =>
          i.bufferView !== undefined
        ),
      );
      const before = await page.locator("canvas").screenshot();
      await page.keyboard.down("w");
      // Wait through several movement frames, not a fixed wall-clock sleep.
      await page.evaluate(async () => {
        for (let i = 0; i < 8; i++) {
          await new Promise<void>((resolve) =>
            requestAnimationFrame(() => resolve())
          );
        }
      });
      await page.keyboard.up("w");
      await page.waitForFunction(() =>
        document.querySelector("canvas")!.width === 640
      );
      const after = await page.locator("canvas").screenshot();
      assert(
        before.length !== after.length ||
          before.some((value, i) => value !== after[i]),
      );
    } finally {
      await browser.close();
      await server.close();
      esbuild.stop();
    }
  },
});
