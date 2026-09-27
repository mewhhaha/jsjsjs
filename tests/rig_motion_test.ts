import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  applyPose,
  bakeAnimation,
  boneChain,
  resetPose,
  rig,
  sampleAnimation,
  solveTwoBoneIK,
  springChain,
  THREE,
} from "../src/prelude.ts";

Deno.test("two-bone IK reaches targets, honors pole direction, and clamps unreachable targets", () => {
  const model = rig(boneChain("arm", [[0, 0, 0], [1, 0, 0], [2, 0, 0]]), {
    position: [3, 1, 0],
    rotation: [0, 30, 0],
    scale: 2,
  });
  const result = solveTwoBoneIK(model, {
    root: "arm_0",
    mid: "arm_1",
    tip: "arm_2",
    target: [1, 1, 0],
    pole: [0, 1, 1],
  });
  assert(result.reached);
  const target = new THREE.Vector3(1, 1, 0).applyMatrix4(model.matrixWorld);
  assert(new THREE.Vector3(...result.tip).distanceTo(target) < 1e-5);
  const elbow = model.bones.arm_1.getWorldPosition(new THREE.Vector3())
    .applyMatrix4(model.matrixWorld.clone().invert());
  assert(elbow.z > 0);
  assertAlmostEquals(model.bones.arm_1.position.length(), 1);
  assertAlmostEquals(model.bones.arm_2.position.length(), 1);
  const far = solveTwoBoneIK(model, {
    root: "arm_0",
    mid: "arm_1",
    tip: "arm_2",
    target: [9, 0, 0],
    pole: [0, 1, 0],
  });
  assertEquals(far.reached, false);
  const reach = model.bones.arm_0.getWorldPosition(new THREE.Vector3())
    .distanceTo(new THREE.Vector3(...far.tip));
  assertAlmostEquals(reach, 4, 1e-6);
  const saved = model.bones.arm_0.quaternion.clone();
  solveTwoBoneIK(model, {
    root: "arm_0",
    mid: "arm_1",
    tip: "arm_2",
    target: [0, 1, 0],
    pole: [0, 0, 1],
    weight: 0,
  });
  assert(saved.angleTo(model.bones.arm_0.quaternion) < 1e-6);
  model.scale.x = 3;
  assertThrows(
    () =>
      solveTwoBoneIK(model, {
        root: "arm_0",
        mid: "arm_1",
        tip: "arm_2",
        target: [1, 1, 0],
        pole: [0, 1, 0],
      }),
    Error,
    "uniform",
  );
});

Deno.test("spring chains keep lengths and anchors, reset reproducibly, and bake into clips", () => {
  const model = rig([
    { name: "head" },
    ...boneChain("hair", [[0, 1, 0], [.3, .9, 0], [.6, .7, 0], [.8, .4, 0]], {
      parent: "head",
    }),
  ]);
  const names = ["hair_0", "hair_1", "hair_2", "hair_3"];
  const spring = springChain(model, names, {
    stiffness: 20,
    gravity: [0, -4, 0],
    wind: [0, 0, 2],
  });
  const restTip = model.bones.hair_3.getWorldPosition(new THREE.Vector3());
  const run = () => {
    resetPose(model);
    spring.reset();
    for (let i = 0; i < 120; i++) {
      applyPose(model, { head: { rotation: [0, Math.sin(i / 20) * 20, 0] } });
      spring.update(1 / 60);
    }
    return model.bones.hair_3.getWorldPosition(new THREE.Vector3());
  };
  const first = run(), second = run();
  assert(first.distanceTo(second) < 1e-10);
  assert(first.distanceTo(restTip) > .05);
  assertAlmostEquals(
    model.bones.hair_0.getWorldPosition(new THREE.Vector3()).distanceTo(
      model.bones.head.getWorldPosition(new THREE.Vector3()),
    ),
    1,
  );
  assertAlmostEquals(model.bones.hair_2.position.length(), Math.hypot(.3, -.2));
  resetPose(model);
  spring.reset();
  const authored = model.bones.hair_3.getWorldPosition(new THREE.Vector3());
  const baked = bakeAnimation(model, "sway", {
    duration: 1,
    fps: 60,
    targets: names,
    update: (_, delta) => spring.update(delta),
  });
  assertEquals(baked.tracks.length, names.length * 3);
  assert(
    model.bones.hair_3.getWorldPosition(new THREE.Vector3()).distanceTo(
      authored,
    ) < 1e-10,
  );
  sampleAnimation(model, baked, 1);
  assert(
    model.bones.hair_3.getWorldPosition(new THREE.Vector3()).distanceTo(
      authored,
    ) > .05,
  );
});

Deno.test("spring point collisions deflect a strand around a sphere and capsule", () => {
  for (const type of ["sphere", "capsule"] as const) {
    const model = rig(boneChain("strand", [[0, 1, 0], [.55, 1, 0]]));
    const spring = springChain(model, ["strand_0", "strand_1"], {
      gravity: [0, -9.81, 0],
      stiffness: 0,
      damping: 8,
      radius: .025,
      colliders: type === "sphere"
        ? [{ type, center: [0, .4, 0], radius: .3 }]
        : [{ type, start: [0, .4, -.2], end: [0, .4, .2], radius: .3 }],
    });
    for (let i = 0; i < 240; i++) spring.update(1 / 120);
    const tip = model.bones.strand_1.getWorldPosition(new THREE.Vector3());
    assert(
      tip.distanceTo(new THREE.Vector3(0, .4, 0)) >= .32,
      `${type} penetration: ${tip.toArray()}`,
    );
    assertAlmostEquals(tip.distanceTo(new THREE.Vector3(0, 1, 0)), .55, 1e-6);
  }
});
