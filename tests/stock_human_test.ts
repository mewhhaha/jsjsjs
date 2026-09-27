import { assert, assertEquals } from "@std/assert";
import * as esbuild from "esbuild";
import type * as THREE from "three";
import { startServer } from "../src/server.ts";
import { launchViewer, waitForModel } from "../src/browser.ts";

for (const variant of ["stock", "lowpoly"]) {
  Deno.test({
    name:
      `${variant} human: head deforms, PBR materials and rig survive GLB export`,
    sanitizeOps: false,
    sanitizeResources: false,
    async fn() {
      const server = await startServer(`examples/${variant}-human.ts`, 0);
      const { browser, page } = await launchViewer(server.url, {
        renderer: "software",
        width: 640,
        height: 800,
      });
      try {
        await waitForModel(page);
        const result = await page.evaluate(async () => {
          const { default: build } = await import("/model.js");
          const { Vector3 } = await import("/three.js");
          const model = await build();
          const body = model.getObjectByName("StockMale") as THREE.SkinnedMesh;
          const before = Array.from(
            { length: body.geometry.getAttribute("position").count },
            (_, i) => body.getVertexPosition(i, new Vector3()).clone(),
          );
          model.getObjectByName("head").rotation.y += 0.35;
          model.updateMatrixWorld(true);
          let maxMovement = 0;
          let stationary = 0;
          for (let i = 0; i < before.length; i++) {
            const movement = before[i].distanceTo(
              body.getVertexPosition(i, new Vector3()),
            );
            maxMovement = Math.max(maxMovement, movement);
            if (movement < 1e-6) stationary++;
          }
          return { bones: body.skeleton.bones.length, maxMovement, stationary };
        });
        assertEquals(result.bones, 53);
        assert(result.maxMovement > 0.01, "head rotation must deform the mesh");
        assert(
          result.stationary > 100,
          "head rotation must leave the rest of the body in place",
        );
        const base64 = await page.evaluate(() =>
          window.modelViewer.exportGLB()
        );
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const length = new DataView(bytes.buffer).getUint32(12, true);
        const gltf = JSON.parse(
          new TextDecoder().decode(bytes.subarray(20, 20 + length)),
        );
        assertEquals(gltf.skins[0].joints.length, 53);
        const skin = gltf.materials.find((m: { name: string }) =>
          m.name === (variant === "stock" ? "StockMale.body" : "Lowpoly_body")
        );
        assert(skin.alphaMode === undefined || skin.alphaMode === "OPAQUE");
        assert(
          gltf.materials.some((m: { alphaMode?: string }) =>
            m.alphaMode === "MASK"
          ),
        );
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
        if (variant === "lowpoly") {
          let triangles = 0;
          for (const mesh of gltf.meshes) {
            for (const primitive of mesh.primitives) {
              triangles += gltf.accessors[primitive.indices].count / 3;
            }
          }
          assert(
            triangles < 9000,
            "exported character must stay under the triangle budget",
          );
          assert(skin.normalTexture, "skin must retain the baked normal map");
          assert(
            skin.pbrMetallicRoughness.metallicRoughnessTexture,
            "skin must retain the roughness map",
          );
        }
      } finally {
        await browser.close();
        await server.close();
        esbuild.stop();
      }
    },
  });
}
