import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  applyPose,
  attachToBone,
  bindSkin,
  boneChain,
  clip,
  humanoidRig,
  resetPose,
  rig,
  sampleAnimation,
  THREE,
} from "../src/prelude.ts";

function vertexMesh(...vertices: number[]) {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(vertices, 3),
  );
  return new THREE.Mesh(geometry, new THREE.MeshStandardMaterial());
}

Deno.test("rig hierarchy handles unordered model-space transforms and rejects cycles", () => {
  const model = rig([
    { name: "tip", parent: "root", position: [1, 2, 0], rotation: [0, 0, 90] },
    { name: "root", position: [1, 1, 0], rotation: [0, 0, 90] },
  ], { space: "model" });
  assertAlmostEquals(model.bones.tip.position.x, 1);
  assertAlmostEquals(model.bones.tip.position.y, 0, 1e-7);
  assert(
    model.bones.tip.getWorldPosition(new THREE.Vector3()).distanceTo(
      new THREE.Vector3(1, 2, 0),
    ) < 1e-6,
  );
  assertThrows(
    () => rig([{ name: "a", parent: "b" }, { name: "b", parent: "a" }]),
    Error,
    "cycle",
  );
  assertThrows(
    () => rig([{ name: "a", parent: "missing" }]),
    Error,
    "Unknown parent",
  );
  assertThrows(() => rig([{ name: "a" }, { name: "a" }]), Error, "unique");
  assertThrows(() => rig([{ name: "a", scale: 0 }]), Error, "positive");
});

Deno.test("poses use degree offsets from rest, are idempotent, and validate before mutation", () => {
  const model = rig([{
    name: "root",
    position: [1, 2, 3],
    rotation: [0, 0, 30],
  }]);
  const pose = {
    root: {
      rotation: [0, 0, 60] as const,
      position: [0, 1, 0] as const,
      scale: 2,
    },
  };
  applyPose(model, pose);
  applyPose(model, pose);
  assertAlmostEquals(model.bones.root.rotation.z, Math.PI / 2);
  assertEquals(model.bones.root.position.toArray(), [1, 3, 3]);
  assertEquals(model.bones.root.scale.toArray(), [2, 2, 2]);
  assertThrows(
    () => applyPose(model, { root: { position: [9, 0, 0] }, missing: {} }),
    Error,
    "not found",
  );
  assertEquals(model.bones.root.position.toArray(), [1, 3, 3]);
  resetPose(model);
  assertAlmostEquals(model.bones.root.rotation.z, Math.PI / 6);
  assertEquals(model.bones.root.position.toArray(), [1, 2, 3]);
});

Deno.test("skin binding preserves transformed placement, shares materials, and deforms vertices", () => {
  const model = rig([{ name: "root" }, {
    name: "tip",
    parent: "root",
    position: [0, 1, 0],
  }], { position: [3, 0, 0], rotation: [0, 0, 90] });
  const source = vertexMesh(0, 0, 0, 0, 1, 0);
  source.position.y = 1;
  let sampledPosition: readonly number[] = [];
  const skin = bindSkin(source, model, {
    weights: ({ position }) => {
      sampledPosition = position;
      return { tip: 7 };
    },
  });
  assertEquals(sampledPosition, [0, 2, 0]);
  assert(skin.geometry !== source.geometry);
  assert(skin.material === source.material);
  assertEquals(source.geometry.getAttribute("skinWeight"), undefined);
  const before = skin.getVertexPosition(1, new THREE.Vector3()).applyMatrix4(
    skin.matrixWorld,
  );
  assert(before.distanceTo(new THREE.Vector3(1, 0, 0)) < 1e-6);
  applyPose(model, { tip: { rotation: [0, 0, 90] } });
  const after = skin.getVertexPosition(1, new THREE.Vector3()).applyMatrix4(
    skin.matrixWorld,
  );
  assert(after.distanceTo(new THREE.Vector3(2, -1, 0)) < 1e-6);
  assertThrows(
    () => bindSkin(vertexMesh(0, 1, 0), model, { weights: "tip" }),
    Error,
    "rest pose",
  );
});

Deno.test("weights retain the strongest four normalized influences and fail on invalid vertices", () => {
  const model = rig([0, 1, 2, 3, 4].map((i) => ({ name: `b${i}` })));
  const skin = bindSkin(vertexMesh(0, 0, 0), model, {
    weights: { b0: 1, b1: 2, b2: 3, b3: 4, b4: 5 },
  });
  assertEquals(Array.from(skin.geometry.getAttribute("skinIndex").array), [
    4,
    3,
    2,
    1,
  ]);
  assertAlmostEquals(
    Array.from(skin.geometry.getAttribute("skinWeight").array).reduce(
      (a, b) => a + b,
      0,
    ),
    1,
    1e-7,
  );
  for (
    const weights of [{ missing: 1 }, { b0: -1 }, { b0: NaN }, {
      b0: 0,
    }] as Record<string, number>[]
  ) {
    assertThrows(() => bindSkin(vertexMesh(0, 0, 0), model, { weights }));
  }
  assertThrows(
    () => bindSkin(vertexMesh(0, 0, 0), model, { weights: [] }),
    Error,
    "count",
  );
  const foreign = vertexMesh(0, 0, 0);
  new THREE.Group().add(foreign);
  assertThrows(
    () => bindSkin(foreign, model, { weights: "b0" }),
    Error,
    "not found",
  );
});

Deno.test("envelopes use rig coordinates, detect gaps, and support explicit fallback", () => {
  const model = rig(boneChain("strand", [[0, 0, 0], [0, 1, 0], [0, 2, 0]]));
  const envelopes = [{ bone: "strand_0", end: "strand_1", radius: .5 }, {
    bone: "strand_1",
    end: "strand_2",
    radius: .5,
  }];
  const skin = bindSkin(vertexMesh(.1, 1, 0), model, { envelopes });
  assertAlmostEquals(skin.geometry.getAttribute("skinWeight").getX(0), .5);
  assertThrows(
    () => bindSkin(vertexMesh(3, 0, 0), model, { envelopes }),
    Error,
    "Unweighted vertex",
  );
  const fallback = bindSkin(vertexMesh(3, 0, 0), model, {
    envelopes,
    fallbackBone: "strand_2",
  });
  assertEquals(fallback.geometry.getAttribute("skinIndex").getX(0), 2);
});

Deno.test("bone attachments preserve world placement when requested and follow posed bones", () => {
  const model = rig([{ name: "hand", position: [0, 2, 0] }], {
    position: [1, 0, 0],
  });
  const prop = new THREE.Object3D();
  prop.position.set(1, 3, 0);
  attachToBone(model, "hand", prop, { space: "world" });
  assertEquals(prop.position.toArray(), [0, 1, 0]);
  applyPose(model, { hand: { rotation: [0, 0, 90] } });
  assert(
    prop.getWorldPosition(new THREE.Vector3()).distanceTo(
      new THREE.Vector3(0, 2, 0),
    ) < 1e-6,
  );
  assertThrows(() => attachToBone(model, "hand", model), Error, "cycle");
});

Deno.test("humanoid has scalable symmetric limbs and optional articulated fingers", () => {
  const model = humanoidRig({ height: 2, fingers: true });
  assertEquals(model.bones.Index2_L.parent, model.bones.Index1_L);
  assertAlmostEquals(
    model.bones.HeadTip.getWorldPosition(new THREE.Vector3()).y,
    2,
  );
  const l = model.bones.Hand_L.getWorldPosition(new THREE.Vector3()),
    r = model.bones.Hand_R.getWorldPosition(new THREE.Vector3());
  assertAlmostEquals(l.x, -r.x);
  assertEquals(l.y, r.y);
  assertThrows(() => humanoidRig({ height: Infinity }));
});

Deno.test("rig clones have independent skeletons and remapped animation targets", () => {
  const original = rig(boneChain("bone", [[0, 0, 0], [0, 1, 0]]));
  const skin = bindSkin(vertexMesh(0, 2, 0), original, { weights: "bone_1" });
  skin.name = "skin";
  clip(original, "bend", [{
    target: "bone_1",
    property: "rotation",
    keys: [[0, [0, 0, 0]], [1, [0, 0, 90]]],
  }]);
  const copied = original.clone();
  const copySkin = copied.getObjectByName("skin") as THREE.SkinnedMesh;
  assert(copySkin.skeleton !== original.skeleton);
  assertEquals(copySkin.skeleton, copied.skeleton);
  sampleAnimation(copied, "bend", 1);
  assertEquals(original.bones.bone_1.rotation.z, 0);
  assert(
    copySkin.getVertexPosition(0, new THREE.Vector3()).distanceTo(
      new THREE.Vector3(-1, 1, 0),
    ) < 1e-6,
  );
});

Deno.test("adding skin after reparenting the rig keeps earlier bindings in the same rest space", () => {
  const model = rig([{ name: "root" }]);
  const first = bindSkin(vertexMesh(0, 1, 0), model, { weights: "root" });
  const parent = new THREE.Group();
  parent.position.x = 4;
  parent.add(model);
  bindSkin(vertexMesh(0, 2, 0), model, { weights: "root" });
  assert(
    first.getVertexPosition(0, new THREE.Vector3()).applyMatrix4(
      first.matrixWorld,
    ).distanceTo(new THREE.Vector3(4, 1, 0)) < 1e-6,
  );
});
