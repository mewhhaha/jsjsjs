import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import * as THREE from "three";
import {
  beamBetween,
  bracket,
  doorframe,
  elbow,
  flange,
  frame,
  gusset,
  gutter,
  handrail,
  hose,
  molding,
  pictureFrame,
  pipe,
  recessedPanel,
  sweepProfile,
  windowFrame,
} from "../src/profiles.ts";

function bounds(object: THREE.Object3D): THREE.Box3 {
  object.updateMatrixWorld(true);
  return new THREE.Box3().setFromObject(object, true);
}
function size(object: THREE.Object3D, expected: number[]) {
  bounds(object).getSize(new THREE.Vector3()).toArray().forEach((n, i) =>
    assertAlmostEquals(n, expected[i], 1e-5)
  );
}
function hits(
  object: THREE.Object3D,
  origin: number[],
  direction: number[],
): number {
  object.updateMatrixWorld(true);
  return new THREE.Raycaster(
    new THREE.Vector3(...origin),
    new THREE.Vector3(...direction),
  ).intersectObject(object, true).length;
}
Deno.test("pipes, flange bores and bolt holes are open with annular walls", () => {
  const tube = pipe({ radius: 0.5, wallThickness: 0.1, length: 2 });
  size(tube, [1, 2, 1]);
  assertEquals(hits(tube, [0, 3, 0], [0, -1, 0]), 0);
  assert(hits(tube, [0.45, 3, 0], [0, -1, 0]) > 0);
  assert(
    hits(tube, [0, 1, 0], [1, 0, 0]) > 0,
    "interior wall faces must face the bore",
  );
  const plate = flange({
    radius: 1,
    innerRadius: 0.3,
    boltCircleRadius: 0.65,
    boltRadius: 0.1,
    thickness: 0.2,
  });
  size(plate, [2, 0.2, 2]);
  assertEquals(hits(plate, [0, 1, 0], [0, -1, 0]), 0);
  assertEquals(hits(plate, [0.65, 1, 0], [0, -1, 0]), 0);
  assert(hits(plate, [0.45, 1, 0], [0, -1, 0]) > 0);
  const flexible = hose([[0, 0, 0], [0, 2, 0]], {
    radius: 0.5,
    wallThickness: 0.1,
  });
  assertEquals(hits(flexible, [0, 3, 0], [0, -1, 0]), 0);
  assert(hits(flexible, [0.45, 3, 0], [0, -1, 0]) > 0);
});
Deno.test("profile sweep and solid handrails have caps with finite normals", () => {
  const block = sweepProfile([[-0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [
    -0.5,
    0.5,
  ]], [[0, 0, 0], [0, 2, 0]]);
  size(block, [1, 2, 1]);
  assert(hits(block, [0, 3, 0], [0, -1, 0]) > 0);
  const rail = handrail([[0, 0, 0], [1, 1, 0], [2, 1, 1]]);
  const bend = elbow();
  const trim = molding([[0, 0], [0.2, 0], [0.2, 0.1], [0, 0.2]], [[0, 0, 0], [
    2,
    0,
    0,
  ]]);
  for (const object of [block, rail, bend, trim]) {
    assert(
      Array.from(object.geometry.getAttribute("normal").array).every(
        Number.isFinite,
      ),
    );
    assert(
      Array.from(object.geometry.getAttribute("position").array).every(
        Number.isFinite,
      ),
    );
  }
});
Deno.test("frames have real openings and recessed panels have the requested front", () => {
  const surround = frame({
    openingWidth: 2,
    openingHeight: 3,
    thickness: 0.2,
    depth: 0.4,
  });
  size(surround, [2.4, 3.4, 0.4]);
  assertEquals(hits(surround, [0, 1.5, 2], [0, 0, -1]), 0);
  assert(hits(surround, [1.1, 1.5, 2], [0, 0, -1]) > 0);
  const door = doorframe({ openingWidth: 2, openingHeight: 3, thickness: 0.2 });
  size(door, [2.4, 3.2, 0.1]);
  assertEquals(hits(door, [0, 0.01, 2], [0, 0, -1]), 0);
  const window = windowFrame({ mullions: 1, transoms: 1 });
  assertEquals(window.children.length, 6);
  assert(hits(window, [0, 0.8, 2], [0, 0, -1]) > 0);
  const picture = pictureFrame({ backing: true });
  assert(hits(picture, [0, 0.8, 2], [0, 0, -1]) > 0);
  const panel = recessedPanel({ depth: 0.5, recess: 0.2, panelThickness: 0.1 });
  assertAlmostEquals(bounds(panel.getObjectByName("panel")!).max.z, 0.05, 1e-6);
});
Deno.test("beam endpoints orient rectangular and round sections including negative Y", () => {
  const downward = beamBetween([1, 3, 2], [1, -1, 2], {
    width: 0.2,
    depth: 0.4,
  });
  size(downward, [0.2, 4, 0.4]);
  assertAlmostEquals(bounds(downward).min.y, -1, 1e-6);
  const horizontal = beamBetween([-1, 2, 3], [2, 2, 3], { radius: 0.1 });
  size(horizontal, [3, 0.2, 0.2]);
  const diagonal = beamBetween([1, 2, 3], [4, 6, 3]);
  const position = diagonal.geometry.getAttribute("position"),
    direction = new THREE.Vector3(3, 4, 0).normalize();
  const projections = Array.from(
    { length: position.count },
    (_, i) =>
      new THREE.Vector3().fromBufferAttribute(position, i).sub(
        new THREE.Vector3(1, 2, 3),
      ).dot(direction),
  );
  assertAlmostEquals(Math.min(...projections), 0, 1e-5);
  assertAlmostEquals(Math.max(...projections), 5, 1e-5);
});
Deno.test("gutter, bracket and gusset retain their empty cross-section regions", () => {
  const trough = gutter({
    width: 1,
    height: 0.5,
    length: 2,
    wallThickness: 0.1,
  });
  size(trough, [1, 0.5, 2]);
  assertEquals(hits(trough, [0, 0.3, 3], [0, 0, -1]), 0);
  assert(hits(trough, [0, 0.05, 3], [0, 0, -1]) > 0);
  const support = bracket({ width: 1, height: 1, depth: 0.2, thickness: 0.1 });
  size(support, [1, 1, 0.2]);
  assertEquals(hits(support, [0.5, 0.5, 2], [0, 0, -1]), 0);
  const triangle = gusset({ width: 1, height: 1, depth: 0.2 });
  assert(hits(triangle, [0.2, 0.2, 2], [0, 0, -1]) > 0);
  assertEquals(hits(triangle, [0.8, 0.8, 2], [0, 0, -1]), 0);
});
Deno.test("profile helpers preserve provided materials and degree transforms", () => {
  const paint = new THREE.MeshStandardMaterial();
  const constructors = [
    () => pipe({ material: paint }),
    () => elbow({ material: paint }),
    () => hose([[0, 0, 0], [0, 1, 0]], { material: paint }),
    () => handrail([[0, 0, 0], [0, 1, 0]], { material: paint }),
    () => gutter({ material: paint }),
    () => frame({ material: paint }),
    () => doorframe({ material: paint }),
    () => windowFrame({ material: paint, mullions: 2 }),
    () => pictureFrame({ material: paint, backing: true }),
    () => recessedPanel({ material: paint }),
    () => beamBetween([0, 0, 0], [0, 1, 0], { material: paint }),
    () => bracket({ material: paint }),
    () => flange({ material: paint }),
    () => gusset({ material: paint }),
  ];
  for (const make of constructors) {
    make().traverse((o) => {
      if (o instanceof THREE.Mesh) assertEquals(o.material, paint);
    });
  }
  assertAlmostEquals(pipe({ rotation: [0, 90, 0] }).rotation.y, Math.PI / 2);
});
Deno.test("profile helpers reject impossible sections and degenerate paths", () => {
  const invalid = [
    () => pipe({ wallThickness: 1 }),
    () => pipe({ radialSegments: 2 }),
    () => elbow({ bendRadius: 0.01 }),
    () => elbow({ angle: 360 }),
    () => hose([[0, 0, 0], [0, 0, 0]]),
    () => handrail([[0, 0, 0], [NaN, 1, 0]]),
    () => sweepProfile([[0, 0], [1, 0], [2, 0]], [[0, 0, 0], [1, 0, 0]]),
    () => gutter({ wallThickness: 1 }),
    () => frame({ depth: 0 }),
    () => windowFrame({ mullions: 100 }),
    () => windowFrame({ mullions: 0.5 }),
    () => pictureFrame({ backingThickness: 10 }),
    () => recessedPanel({ recess: 1 }),
    () => beamBetween([0, 0, 0], [0, 0, 0]),
    () => bracket({ thickness: 1 }),
    () => flange({ boltRadius: 1 }),
    () => flange({ innerRadius: 2 }),
    () => gusset({ width: -1 }),
  ];
  for (const make of invalid) assertThrows(make, RangeError);
});
