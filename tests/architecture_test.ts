import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { column, gableRoof, material, THREE, wall } from "../src/prelude.ts";

function bounds(object: THREE.Object3D) {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object, true);
}
function vector(actual: THREE.Vector3, expected: number[]) {
  actual.toArray().forEach((n, i) => assertAlmostEquals(n, expected[i], 1e-6));
}
function hits(object: THREE.Object3D, x: number, y: number) {
  object.updateWorldMatrix(true, true);
  return new THREE.Raycaster(
    new THREE.Vector3(x, y, 5),
    new THREE.Vector3(0, 0, -1),
  ).intersectObject(object, true);
}

Deno.test("walls have genuine door/window openings, editable panels and exact bounds", () => {
  const paint = material("#bea680");
  const door = wall({
    width: 4,
    height: 3,
    depth: 0.4,
    opening: { width: 1.5, height: 2, center: 0.25 },
    material: paint,
  });
  assert(door instanceof THREE.Group);
  assertEquals(door.children.map((p) => p.name), [
    "left_panel",
    "right_panel",
    "lintel",
  ]);
  assert(door.children.every((p) => (p as THREE.Mesh).material === paint));
  vector(bounds(door).min, [-2, 0, -0.2]);
  vector(bounds(door).max, [2, 3, 0.2]);
  assertEquals(hits(door, 0.25, 1).length, 0);
  assert(hits(door, -1.5, 1).length > 0);
  assert(hits(door, 0.25, 2.5).length > 0);
  const window = wall({ opening: { width: 2, height: 1, bottom: 1 } });
  assert(window.getObjectByName("sill"));
  assertEquals(hits(window, 0, 1.5).length, 0);
  assert(hits(window, 0, 0.5).length > 0);
  assert(hits(window, 0, 2.5).length > 0);
  const fullHeight = wall({ opening: { width: 1, height: 3 } });
  assertEquals(fullHeight.children.length, 2);
  const moved = wall({ position: [3, 4, 5], rotation: [0, 90, 0], scale: 2 });
  vector(bounds(moved).min, [2.75, 4, 1]);
  vector(bounds(moved).max, [3.25, 10, 9]);
});

Deno.test("column total height includes editable base, shaft and capital", () => {
  const paint = material("#ddd0bc");
  const pillar = column({
    radius: 0.3,
    height: 4,
    baseRadius: 0.5,
    capitalRadius: 0.6,
    baseHeight: 0.2,
    capitalHeight: 0.4,
    material: paint,
  });
  assertEquals(pillar.children.map((p) => p.name), [
    "base",
    "shaft",
    "capital",
  ]);
  vector(bounds(pillar).min, [-0.6, 0, -0.6]);
  vector(bounds(pillar).max, [0.6, 4, 0.6]);
  for (const child of pillar.children) {
    assertEquals((child as THREE.Mesh).material, paint);
  }
  assertAlmostEquals(bounds(pillar.children[1]).min.y, 0.2, 1e-6);
  assertAlmostEquals(bounds(pillar.children[1]).max.y, 3.6, 1e-6);
  const bare = column({ baseHeight: 0, capitalHeight: 0 });
  assertEquals(bare.children.length, 1);
  vector(bounds(bare).min, [-0.25, 0, -0.25]);
  vector(bounds(bare).max, [0.25, 3, 0.25]);
});

Deno.test("gable roof is a closed outward-facing shell with clear space beneath", () => {
  const roof = gableRoof({ width: 4, depth: 3, rise: 1, thickness: 0.2 });
  assert(roof instanceof THREE.Mesh);
  vector(bounds(roof).min, [-2, 0, -1.5]);
  vector(bounds(roof).max, [2, 1.2, 1.5]);
  assertEquals(hits(roof, 0, 0.5).length, 0);
  assert(hits(roof, 0, 1.1).length > 0);
  const up = new THREE.Raycaster(
    new THREE.Vector3(0.5, -1, 0),
    new THREE.Vector3(0, 1, 0),
  ).intersectObject(roof);
  assert(up.length > 0, "roof underside must face outward");
  assertAlmostEquals(up[0].point.y, 0.75, 1e-6);
  const p = roof.geometry.getAttribute("position");
  const index = roof.geometry.index;
  const count = index?.count ?? p.count;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  let volume = 0;
  const edges = new Map<string, number>();
  for (let i = 0; i < count; i += 3) {
    const vertices = [a, b, c].map((v, j) =>
      v.fromBufferAttribute(p, index ? index.getX(i + j) : i + j)
    );
    volume += a.dot(new THREE.Vector3().crossVectors(b, c)) / 6;
    const key = (v: THREE.Vector3) =>
      v.toArray().map((n) => Math.round(n * 1e6)).join(",");
    for (let j = 0; j < 3; j++) {
      const edge = [key(vertices[j]), key(vertices[(j + 1) % 3])].sort().join(
        "|",
      );
      edges.set(edge, (edges.get(edge) ?? 0) + 1);
    }
  }
  assertAlmostEquals(volume, 4 * 3 * 0.2, 1e-6);
  assert(
    [...edges.values()].every((count) => count === 2),
    "all welded edges must close",
  );
});

Deno.test("architecture rejects impossible dimensions and misplaced openings", () => {
  for (
    const create of [
      () => wall({ width: 0 }),
      () => wall({ opening: { width: 4, height: 2 } }),
      () => wall({ opening: { width: 1, height: 1, center: 2 } }),
      () => wall({ opening: { width: 1, height: 2, bottom: 2 } }),
      () => wall({ opening: { width: 1, height: 2, bottom: -1 } }),
      () => wall({ opening: { width: 1, height: 2, center: NaN } }),
      () => column({ height: 0.2 }),
      () => column({ capitalHeight: -1 }),
      () => column({ radius: Infinity }),
      () => column({ radialSegments: 2 }),
      () => gableRoof({ rise: 0 }),
      () => gableRoof({ thickness: -1 }),
      () => gableRoof({ width: NaN }),
    ]
  ) assertThrows(create, RangeError);
});
