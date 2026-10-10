import { assert, assertEquals, assertRejects } from "@std/assert";
import { chromiumAvailable, withViewer } from "./support.ts";

const source =
  `import { rig, boneChain, bindSkin, box, clip, THREE, sampleAnimation } from "js3";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
export default function build() {
  const model = rig(boneChain("joint", [[0,0,0],[0,1,0]]));
  const mesh = bindSkin(box([.4,1,.4], {name:"skin", position:[0,1.5,0]}), model, {weights:"joint_1"});
  const face = box([.25,.25,.25], {name:"face",position:[.6,.5,0]});
  const target = face.geometry.attributes.position.clone();
  target.name = "Smile";
  for (let i=0; i<target.count; i++) target.setY(i, target.getY(i)*2);
  face.geometry.morphAttributes.position=[target]; face.updateMorphTargets();
  model.add(face);
  clip(model, "Bend", [
    {target:"joint_1",property:"rotation",keys:[[0,[0,0,0]],[1,[0,0,90]]]},
    {target:face,property:"morph",morph:"Smile",keys:[[0,0],[1,1]]}
  ]);
  model.userData.preview={grid:false, radius:1.5, target:[0,1,0], direction:[0,0,1]};
  return model;
}
export async function readGLB(encoded) {
  const bytes = Uint8Array.from(atob(encoded), c=>c.charCodeAt(0));
  const data = await new GLTFLoader().parseAsync(bytes.buffer, "");
  data.scene.animations = data.animations;
  const skin = data.scene.getObjectByName("skin");
  data.scene.updateMatrixWorld(true);
  const before = skin.getVertexPosition(0, new THREE.Vector3()).applyMatrix4(skin.matrixWorld).toArray();
  sampleAnimation(data.scene, "Bend", 1);
  const after = skin.getVertexPosition(0, new THREE.Vector3()).applyMatrix4(skin.matrixWorld).toArray();
  return { clips:data.animations.map(c=>c.name), bones:skin.skeleton.bones.length, before, after,
    morph:data.scene.getObjectByName("face").morphTargetInfluences[0] };
}
`;

Deno.test({
  name:
    "viewer scrubs, plays, resets after reload, and exports animated skins and morphs headlessly",
  ignore: !chromiumAvailable,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    await withViewer(source, async ({ page, file }) => {
      assert(await page.locator("#animation").isVisible());
      assertEquals(
        (await page.evaluate(() => window.modelViewer.inspect())).animations,
        [{ name: "Bend", duration: 1, tracks: 2 }],
      );
      const sample = (time: number) =>
        page.evaluate(
          (time) => window.modelViewer.sampleAnimation("Bend", time),
          time,
        );
      const png = () =>
        page.locator("canvas").screenshot({
          style: "#animation { visibility:hidden !important }",
        });
      await sample(0);
      const start = await png();
      const startBounds = await page.evaluate(() =>
        window.modelViewer.inspect().bounds
      );
      await sample(1);
      const end = await png();
      const endBounds = await page.evaluate(() =>
        window.modelViewer.inspect().bounds
      );
      assert(
        startBounds.min[0] > endBounds.min[0] + .5,
        "Deformation must affect inspection bounds",
      );
      assert(
        start.some((byte, i) => byte !== end[i]),
        "Animation must visibly deform the model",
      );
      await sample(.3);
      await sample(1);
      assertEquals(await png(), end);
      await page.getByRole("slider", { name: "Animation time" }).fill("0.25");
      assertEquals(
        (await page.evaluate(() => window.modelViewer.animationState())).time,
        .25,
      );
      await page.getByRole("button", { name: "Play", exact: true }).click();
      await page.waitForFunction(() =>
        window.modelViewer.animationState().time > .3
      );
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      assertEquals(
        (await page.evaluate(() => window.modelViewer.animationState()))
          .playing,
        false,
      );
      await sample(.5);
      const glb = await page.evaluate(() => window.modelViewer.exportGLB());
      assertEquals(
        (await page.evaluate(() => window.modelViewer.animationState())).time,
        .5,
        "Export must restore the preview frame",
      );
      const imported = await page.evaluate(async (encoded) => {
        const module = await import("/model.js");
        return await module.readGLB(encoded);
      }, glb);
      assertEquals(imported.clips, ["Bend"]);
      assertEquals(imported.bones, 2);
      assertEquals(imported.morph, 1);
      assert(
        Math.abs(imported.before[0] - imported.after[0]) > .5,
        "Round-tripped skin must deform",
      );
      const imposter = await page.evaluate(() =>
        window.modelViewer.captureImposter({ grid: 3, tileSize: 32 })
      );
      assertEquals(imposter.manifest.tiles.length, 9);
      assertEquals(
        (await page.evaluate(() => window.modelViewer.animationState())).time,
        .5,
      );
      await assertRejects(
        () =>
          page.evaluate(() => window.modelViewer.sampleAnimation("absent", 0)),
        Error,
        "Unknown animation",
      );
      await page.evaluate(() => window.modelViewer.resetAnimation());
      assertEquals(
        await page.evaluate(() => window.modelViewer.inspect().bounds),
        startBounds,
      );
      const revision = await page.evaluate(() => window.modelViewer.revision);
      await page.evaluate(() => window.modelViewer.playAnimation("Bend"));
      await Deno.writeTextFile(file, source.replaceAll('"Bend"', '"New_clip"'));
      await page.waitForFunction(
        (revision) =>
          window.modelViewer.ready && window.modelViewer.revision > revision,
        revision,
      );
      const reloaded = await page.evaluate(() =>
        window.modelViewer.animationState()
      );
      assertEquals(reloaded.playing, false);
      assertEquals(reloaded.clip, null);
      assertEquals(reloaded.clips[0].name, "New_clip");
      assertEquals(await page.evaluate(() => window.modelViewer.error), null);
    }, { width: 480, height: 480 });
  },
});
