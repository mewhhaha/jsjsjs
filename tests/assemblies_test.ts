import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  fence,
  grille,
  louvers,
  railing,
  shelving,
} from "../src/assemblies.ts";
import { material, THREE } from "../src/prelude.ts";

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
    new THREE.Vector3(x, y, 10),
    new THREE.Vector3(0, 0, -1),
  ).intersectObject(object, true);
}
function named(object: THREE.Object3D, prefix: string) {
  return object.children.filter((child) => child.name.startsWith(prefix));
}
Deno.test("railing spaces endpoint posts and has one or two editable rails", () => {
  const result = railing({
    width: 3,
    height: 1,
    depth: 0.2,
    postWidth: 0.1,
    postSpacing: 1,
  });
  const posts = named(result, "post_");
  assertEquals(posts.length, 4);
  assertEquals(named(result, "rail_").length, 2);
  assertAlmostEquals(posts[0].position.x, -1.45);
  assertAlmostEquals(posts[3].position.x, 1.45);
  for (let i = 1; i < posts.length; i++) {
    assertAlmostEquals(posts[i].position.x - posts[i - 1].position.x, 2.9 / 3);
  }
  vector(bounds(result).min, [-1.5, 0, -0.1]);
  vector(bounds(result).max, [1.5, 1, 0.1]);
  assertEquals(hits(result, 0, 0.2).length, 0);
  const single = railing({ postCount: 2, railCount: 1 });
  assertEquals(single.children.length, 3);
  assertAlmostEquals(
    bounds(single.getObjectByName("rail_top")!).max.y,
    1,
    1e-6,
  );
});
Deno.test("fence creates real slat gaps, rear rails, flat and pointed pickets", () => {
  const result = fence({
    width: 2,
    height: 1,
    depth: 0.2,
    slatCount: 4,
    slatWidth: 0.2,
    slatDepth: 0.05,
    railHeight: 0.1,
  });
  const slats = named(result, "slat_");
  assertEquals(slats.length, 4);
  const gap = (2 - 4 * 0.2) / 5;
  assertAlmostEquals(slats[0].position.x, -1 + gap + 0.1);
  assertAlmostEquals(slats[3].position.x, 1 - gap - 0.1);
  vector(bounds(result).min, [-1, 0, -0.1]);
  vector(bounds(result).max, [1, 1, 0.1]);
  assertEquals(hits(result, 0, 0.5).length, 0);
  assert(hits(result, slats[0].position.x, 0.5).length > 0);
  assert(hits(result, 0, 0.25).length > 0);
  const pointed = fence({
    width: 2,
    height: 1,
    slatCount: 3,
    topProfile: "pointed",
    slatWidth: 0.2,
    tipHeight: 0.15,
  });
  assertEquals(hits(pointed, 0.09, 0.99).length, 0);
  assert(hits(pointed, 0, 0.99).length > 0);
  assertAlmostEquals(bounds(pointed).max.y, 1, 1e-6);
  const spaced = fence({ width: 2, slatWidth: 0.2, slatSpacing: 0.3 });
  assertEquals(named(spaced, "slat_").length, 4);
});
Deno.test("grille bars do not duplicate frame edges and leave genuine openings", () => {
  const paint = material("red"), bars = material("blue");
  const result = grille({
    width: 2,
    height: 2,
    depth: 0.2,
    frameWidth: 0.1,
    barWidth: 0.1,
    verticalCount: 2,
    horizontalCount: 2,
    material: paint,
    barMaterial: bars,
  });
  assertEquals(result.children.length, 8);
  vector(bounds(result).min, [-1, 0, -0.1]);
  vector(bounds(result).max, [1, 2, 0.1]);
  assertEquals(hits(result, 0, 1).length, 0);
  assert(hits(result, named(result, "vertical_")[0].position.x, 1).length > 0);
  assert(hits(result, 0, 0.05).length > 0);
  assert(
    named(result, "frame_").every((p) => (p as THREE.Mesh).material === paint),
  );
  assert(
    named(result, "horizontal_").every((p) =>
      (p as THREE.Mesh).material === bars
    ),
  );
  const empty = grille({ verticalCount: 0, horizontalCount: 0 });
  assertEquals(empty.children.length, 4);
  assertEquals(hits(empty, 0, 1).length, 0);
  const spaced = grille({ verticalSpacing: 0.3, horizontalSpacing: 10 });
  assertEquals(named(spaced, "vertical_").length, 5);
  assertEquals(named(spaced, "horizontal_").length, 0);
});
Deno.test("louvers maintain total bounds and fit rotated slats with clear gaps", () => {
  const result = louvers({
    width: 2,
    height: 2,
    depth: 0.4,
    count: 4,
    slatDepth: 0.3,
    slatThickness: 0.04,
    angle: -30,
  });
  const slats = named(result, "slat_");
  assertEquals(slats.length, 4);
  vector(bounds(result).min, [-1, 0, -0.2]);
  vector(bounds(result).max, [1, 2, 0.2]);
  assertAlmostEquals(slats[0].rotation.x, -Math.PI / 6);
  for (let i = 1; i < slats.length; i++) {
    assert(bounds(slats[i]).min.y > bounds(slats[i - 1]).max.y);
  }
  assertEquals(hits(result, 0, 1).length, 0);
  assert(hits(result, 0, slats[0].position.y).length > 0);
  const horizontal = louvers({ angle: 0 });
  assertAlmostEquals(bounds(horizontal).max.z, 0.15, 1e-6);
});
Deno.test("shelving includes count shelves, exact bounds, posts or sidewalls", () => {
  const paint = material("red"), shelves = material("blue");
  for (const support of ["posts", "sides"] as const) {
    const result = shelving({
      width: 3,
      height: 2,
      depth: 1,
      count: 4,
      thickness: 0.1,
      supportWidth: 0.2,
      support,
      material: paint,
      shelfMaterial: shelves,
    });
    const shelfParts = named(result, "shelf_");
    assertEquals(shelfParts.length, 4);
    assertEquals(result.children.length, support === "posts" ? 8 : 6);
    vector(bounds(result).min, [-1.5, 0, -0.5]);
    vector(bounds(result).max, [1.5, 2, 0.5]);
    assertAlmostEquals(shelfParts[0].position.y, 0.05);
    assertAlmostEquals(shelfParts[3].position.y, 1.95);
    assert(shelfParts.every((p) => (p as THREE.Mesh).material === shelves));
    assertEquals(hits(result, 0, 0.3).length, 0);
  }
  const single = shelving({ count: 1 });
  assertAlmostEquals(bounds(single.getObjectByName("shelf_0")!).min.y, 0, 1e-6);
});
Deno.test("assemblies preserve group transforms and material defaults without sharing objects", () => {
  for (const create of [railing, fence, grille, louvers, shelving]) {
    const original = create();
    const moved = create({
      name: "test",
      position: [1, 2, 3],
      rotation: [0, 90, 0],
      scale: 2,
      preview: { grid: false },
    });
    assertEquals(moved.name, "test");
    assertEquals(moved.userData.preview, {
      grid: false,
      background: undefined,
    });
    assertAlmostEquals(moved.rotation.y, Math.PI / 2);
    vector(moved.position, [1, 2, 3]);
    assertAlmostEquals(bounds(moved).min.y, 2, 1e-6);
    const materials = original.children.map((p) => (p as THREE.Mesh).material);
    assert(materials.every((m) => m === materials[0]));
    assert(materials[0] instanceof THREE.MeshStandardMaterial);
    assert(original.children[0] !== moved.children[0]);
  }
});
Deno.test("assemblies reject invalid dimensions, counts, spacing and fit", () => {
  for (
    const create of [
      () => railing({ width: 0 }),
      () => railing({ postCount: 1 }),
      () => railing({ postCount: 2, postSpacing: 1 }),
      () => railing({ postCount: 100 }),
      () => railing({ postSpacing: Infinity }),
      () => railing({ height: 0.1 }),
      () => fence({ slatCount: 0 }),
      () => fence({ slatCount: 1.5 }),
      () => fence({ slatWidth: 1 }),
      () => fence({ slatSpacing: 0 }),
      () => fence({ slatDepth: 0.2 }),
      () => fence({ tipHeight: 2 }),
      () => grille({ frameWidth: 1 }),
      () => grille({ barWidth: 1 }),
      () => grille({ verticalCount: -1 }),
      () => grille({ horizontalCount: Number.MAX_SAFE_INTEGER + 1 }),
      () => grille({ horizontalCount: 1, horizontalSpacing: 1 }),
      () => grille({ verticalSpacing: NaN }),
      () => louvers({ count: 0 }),
      () => louvers({ angle: 91 }),
      () => louvers({ angle: NaN }),
      () => louvers({ slatDepth: 3 }),
      () => louvers({ count: 20 }),
      () => louvers({ slatThickness: 0 }),
      () => shelving({ count: 0 }),
      () => shelving({ count: 1.2 }),
      () => shelving({ thickness: 1 }),
      () => shelving({ supportWidth: 2 }),
      () => shelving({ depth: Infinity }),
    ]
  ) assertThrows(create, RangeError);
});
