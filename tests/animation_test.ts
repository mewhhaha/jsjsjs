import { assertAlmostEquals, assertEquals, assertThrows } from "@std/assert";
import {
  animationClips,
  AnimationPlayer,
  bakeAnimation,
  clip,
  resetAnimation,
  rig,
  sampleAnimation,
  THREE,
} from "../src/prelude.ts";
import { frameTimes } from "../src/frame-times.ts";

Deno.test("absolute animation sampling is independent of seek order, including endpoints and switches", () => {
  const model = rig([{ name: "joint", rotation: [0, 0, 30] }]);
  clip(model, "bend", [{
    target: "joint",
    property: "rotation",
    keys: [[0, [0, 0, 0]], [2, [0, 0, 90]]],
  }]);
  clip(model, "move", [{
    target: "joint",
    property: "position",
    keys: [[0, [0, 0, 0]], [2, [2, 0, 0]]],
  }]);
  sampleAnimation(model, "bend", 2);
  assertAlmostEquals(model.bones.joint.rotation.z, 2 * Math.PI / 3, 1e-6);
  sampleAnimation(model, "bend", .5);
  const q = model.bones.joint.quaternion.clone();
  sampleAnimation(model, "bend", 99);
  sampleAnimation(model, "bend", .5);
  assertEquals(q.toArray(), model.bones.joint.quaternion.toArray());
  sampleAnimation(model, "bend", 2, { loop: true });
  assertAlmostEquals(model.bones.joint.rotation.z, Math.PI / 6, 1e-6);
  sampleAnimation(model, "move", 1);
  assertAlmostEquals(model.bones.joint.position.x, 1);
  assertAlmostEquals(model.bones.joint.rotation.z, Math.PI / 6, 1e-6);
  resetAnimation(model);
  assertEquals(model.bones.joint.position.x, 0);
});

Deno.test("nested clips target UUIDs so duplicate names in composed rigs still animate correctly", () => {
  const a = rig([{ name: "joint" }]), b = rig([{ name: "joint" }]);
  clip(a, "a", [{
    target: "joint",
    property: "position",
    keys: [[0, [0, 0, 0]], [1, [1, 0, 0]]],
  }]);
  clip(b, "b", [{
    target: "joint",
    property: "position",
    keys: [[0, [0, 0, 0]], [1, [0, 2, 0]]],
  }]);
  const model = new THREE.Group().add(a, b);
  sampleAnimation(model, "b", 1);
  assertEquals(a.bones.joint.position.toArray(), [0, 0, 0]);
  assertEquals(b.bones.joint.position.toArray(), [0, 2, 0]);
  assertEquals(animationClips(model).length, 2);
  assertThrows(
    () =>
      clip(model, "invalid", [{
        target: "joint",
        property: "position",
        keys: [[1, [0, 0, 0]]],
      }]),
    Error,
    "ambiguous",
  );
  resetAnimation(model);
});

Deno.test("morph tracks interpolate named targets and reset their original weights", () => {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(),
    new THREE.MeshStandardMaterial(),
  );
  mesh.name = "face";
  const morph = mesh.geometry.attributes.position.clone();
  morph.name = "smile";
  mesh.geometry.morphAttributes.position = [morph];
  mesh.updateMorphTargets();
  mesh.morphTargetInfluences![0] = .2;
  clip(mesh, "expression", [{
    target: mesh,
    property: "morph",
    morph: "smile",
    keys: [[0, 0], [1, 1]],
  }]);
  sampleAnimation(mesh, "expression", .75);
  assertAlmostEquals(mesh.morphTargetInfluences![0], .75);
  resetAnimation(mesh);
  assertAlmostEquals(mesh.morphTargetInfluences![0], .2);
  assertThrows(
    () =>
      clip(mesh, "bad", [{
        target: mesh,
        property: "morph",
        morph: "absent",
        keys: [[1, 1]],
      }]),
    Error,
    "Unknown morph",
  );
});

Deno.test("invalid clips fail before registering or changing transforms", () => {
  const model = rig([{ name: "joint" }]);
  assertThrows(
    () =>
      clip(model, "unknown", [{
        target: "absent",
        property: "rotation",
        keys: [[1, [0, 0, 0]]],
      }]),
    Error,
    "not found",
  );
  assertThrows(
    () =>
      clip(model, "unordered", [{
        target: "joint",
        property: "position",
        keys: [[1, [0, 0, 0]], [.5, [0, 0, 0]]],
      }]),
    Error,
    "increasing",
  );
  assertThrows(
    () =>
      clip(model, "short", [{
        target: "joint",
        property: "rotation",
        keys: [[2, [0, 0, 90]]],
      }], { duration: 1 }),
    Error,
    "include every key",
  );
  assertThrows(
    () =>
      clip(model, "zero", [{
        target: "joint",
        property: "quaternion",
        keys: [[1, [0, 0, 0, 0]]],
      }]),
    Error,
    "cannot be zero",
  );
  assertEquals(model.animations.length, 0);
  assertEquals(model.bones.joint.position.toArray(), [0, 0, 0]);
});

Deno.test("player advances explicit deltas, pauses, clamps, loops, and restores on disposal", () => {
  const model = rig([{ name: "joint" }]);
  clip(model, "move", [{
    target: "joint",
    property: "position",
    keys: [[0, [0, 0, 0]], [1, [1, 0, 0]]],
  }]);
  const player = new AnimationPlayer(model);
  player.play("move", { speed: 2, loop: false });
  player.update(.25);
  assertAlmostEquals(model.bones.joint.position.x, .5);
  player.pause();
  player.update(1);
  assertAlmostEquals(model.bones.joint.position.x, .5);
  player.play();
  player.update(1);
  assertEquals(player.state.playing, false);
  assertEquals(player.state.time, 1);
  player.play(undefined, { loop: true, speed: 1 });
  player.update(1.25);
  assertAlmostEquals(player.state.time, .25);
  player.dispose();
  assertEquals(model.bones.joint.position.x, 0);
});

Deno.test("procedural bake includes exact endpoint and restores the source even on failure", () => {
  const model = rig([{ name: "joint" }]);
  const baked = bakeAnimation(model, "arc", {
    duration: .35,
    fps: 10,
    targets: ["joint"],
    update: (t) => {
      model.bones.joint.position.y = Math.sin(t);
    },
  });
  assertAlmostEquals(baked.tracks[0].times.at(-1)!, .35, 1e-6);
  assertEquals(model.bones.joint.position.y, 0);
  sampleAnimation(model, "arc", .35);
  assertAlmostEquals(model.bones.joint.position.y, Math.sin(.35), 1e-6);
  resetAnimation(model);
  assertThrows(
    () =>
      bakeAnimation(model, "failed", {
        duration: 1,
        targets: ["joint"],
        update: () => {
          model.bones.joint.position.x = 5;
          throw new Error("failed update");
        },
      }),
    Error,
    "failed update",
  );
  assertEquals(model.bones.joint.position.toArray(), [0, 0, 0]);
  assertEquals(model.animations.length, 1);
});

Deno.test("frame timestamps match video cadence without duplicating the endpoint", () => {
  assertEquals(frameTimes(2, { fps: 2, start: .5, duration: 1.5 }), [
    .5,
    1,
    1.5,
  ]);
  assertEquals(frameTimes(3.2, { fps: 30 }).length, 96);
  assertThrows(() => frameTimes(1, { start: 1 }));
  assertThrows(() => frameTimes(1, { duration: 2 }));
  assertThrows(() => frameTimes(1000, { fps: 30 }));
});
