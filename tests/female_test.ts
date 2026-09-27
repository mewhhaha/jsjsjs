import { assert, assertEquals } from "@std/assert";
import * as esbuild from "esbuild";
import type * as THREE from "three";
import { startServer } from "../src/server.ts";
import { launchViewer, waitForModel } from "../src/browser.ts";
import physics from "../examples/female-flowing-hair/physics.json" with {
  type: "json",
};

Deno.test({
  name:
    "female: low-poly body, detachable flowing hair, independent hanging chains and fixed scalp",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const server = await startServer("examples/female.ts", 0);
    const { browser, page } = await launchViewer(server.url, {
      renderer: "software",
      width: 640,
      height: 800,
    });
    try {
      await waitForModel(page);
      const result = await page.evaluate(async (chains: string[][]) => {
        const { default: build } = await import("/model.js");
        const { Vector3 } = await import("/three.js");
        const model = await build();
        const hair = model.getObjectByName("FlowingHair") as THREE.SkinnedMesh;
        const head = model.getObjectByName("head") as THREE.Bone;
        const anchor = model.getObjectByName("HairAnchor") as THREE.Bone;
        if (!hair?.isSkinnedMesh || !head || !anchor) {
          throw new Error(
            "Missing separate flowing hair, head, or hair anchor",
          );
        }
        const joints = hair.geometry.getAttribute("skinIndex");
        const weights = hair.geometry.getAttribute("skinWeight");
        const components = ["getX", "getY", "getZ", "getW"] as const;
        const influence = (vertex: number, joint: number) => {
          let total = 0;
          for (const component of components) {
            if (joints[component](vertex) === joint) {
              total += weights[component](vertex);
            }
          }
          return total;
        };
        const anchorIndex = hair.skeleton.bones.indexOf(anchor);
        let scalp = -1;
        for (let i = 0; i < joints.count; i++) {
          if (influence(i, anchorIndex) > .999) {
            scalp = i;
            break;
          }
        }
        if (scalp < 0) throw new Error("Missing rigid scalp vertex");
        const tips = chains.map((bones) => {
          const tipIndex = hair.skeleton.bones.findIndex((bone) =>
            bone.name === bones.at(-1)
          );
          if (tipIndex < 0) throw new Error(`Missing ${bones.at(-1)}`);
          let vertex = -1, bestWeight = 0;
          for (let i = 0; i < joints.count; i++) {
            const weight = influence(i, tipIndex);
            if (weight > bestWeight) {
              vertex = i;
              bestWeight = weight;
            }
          }
          if (vertex < 0 || bestWeight < .5) {
            throw new Error(`Missing weighted tip for ${bones.at(-1)}`);
          }
          return vertex;
        });
        const world = (i: number) =>
          hair.localToWorld(hair.getVertexPosition(i, new Vector3()));
        model.updateMatrixWorld(true);
        const beforeScalp = world(scalp);
        const beforeTips = tips.map(world);
        const movements: number[] = [];
        const scalpDrifts: number[] = [];
        const isolated: boolean[] = [];
        for (let chain = 0; chain < chains.length; chain++) {
          const bone = model.getObjectByName(chains[chain][1]) as THREE.Bone;
          if (!bone?.isBone) throw new Error(`Missing ${chains[chain][1]}`);
          bone.rotation.x += .4;
          model.updateMatrixWorld(true);
          const tipDrifts = tips.map((tip, index) =>
            beforeTips[index].distanceTo(world(tip))
          );
          movements.push(tipDrifts[chain]);
          isolated.push(
            tipDrifts.some((drift, index) => index !== chain && drift < 1e-5),
          );
          scalpDrifts.push(beforeScalp.distanceTo(world(scalp)));
          bone.rotation.x -= .4;
          model.updateMatrixWorld(true);
        }
        const relativeBefore = head.worldToLocal(world(scalp));
        head.rotation.y += .4;
        model.updateMatrixWorld(true);
        const headAttachmentError = relativeBefore.distanceTo(
          head.worldToLocal(world(scalp)),
        );
        const body = await build({ hair: false });
        let bodyTriangles = 0;
        body.traverse((obj: THREE.Object3D) => {
          const mesh = obj as THREE.Mesh;
          if (mesh.isMesh) {
            bodyTriangles += (mesh.geometry.index?.count ??
              mesh.geometry.getAttribute("position").count) / 3;
          }
        });
        return {
          scalpDrifts,
          movements,
          isolated,
          headAttachmentError,
          bodyTriangles,
          hairBones: hair.skeleton.bones.length,
          detached: !body.getObjectByName("FlowingHair"),
          anchorParentIsHead: anchor.parent === head,
        };
      }, physics.chains.map((chain) => chain.bones));
      assert(result.bodyTriangles <= 3100);
      assertEquals(result.hairBones, 31);
      assert(result.detached);
      assert(result.anchorParentIsHead);
      assert(result.scalpDrifts.every((drift: number) => drift < 1e-5));
      assert(result.movements.every((movement: number) => movement > .01));
      assert(result.isolated.every(Boolean));
      assert(result.headAttachmentError < 1e-5);
      const data = await page.evaluate(() => window.modelViewer.exportGLB());
      const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
      const length = new DataView(bytes.buffer).getUint32(12, true);
      const gltf = JSON.parse(
        new TextDecoder().decode(bytes.subarray(20, 20 + length)),
      );
      assert(
        gltf.skins.some((s: { joints: number[] }) => s.joints.length === 53),
      );
      assert(
        gltf.skins.some((s: { joints: number[] }) => s.joints.length === 31),
      );
    } finally {
      await browser.close();
      await server.close();
      esbuild.stop();
    }
  },
});
