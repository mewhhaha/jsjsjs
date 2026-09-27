import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import * as THREE from "three";
import { arch, type ArchOptions } from "../src/arch.ts";

function bounds(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object, true);
}

function close(actual: THREE.Vector3, expected: number[]): void {
  actual.toArray().forEach((value, index) =>
    assertAlmostEquals(value, expected[index], 1e-6)
  );
}

function hit(object: THREE.Object3D, x: number, y: number): string[] {
  object.updateWorldMatrix(true, true);
  return new THREE.Raycaster(
    new THREE.Vector3(x, y, 10),
    new THREE.Vector3(0, 0, -1),
  ).intersectObject(object, true).map((intersection) =>
    intersection.object.name
  );
}

Deno.test("arch has an open passage, solid piers and semicircular crown", () => {
  const result = arch();
  assert(result instanceof THREE.Group);
  assertEquals(result.children.map((child) => child.name), [
    "left_pier",
    "right_pier",
    "crown",
  ]);
  close(bounds(result).min, [-1.25, 0, -0.2]);
  close(bounds(result).max, [1.25, 3.25, 0.2]);
  assertEquals(hit(result, 0, 1), []);
  assertEquals(hit(result, 0, 2.9), []);
  assertEquals(hit(result, 0.65, 2.65), []);
  assert(hit(result, -1.1, 1).includes("left_pier"));
  assert(hit(result, 1.1, 1).includes("right_pier"));
  assert(hit(result, 0, 3.1).includes("crown"));
  assertEquals(hit(result, 0, 3.3), []);
  const paint = (result.children[0] as THREE.Mesh).material;
  for (const child of result.children) {
    assertEquals((child as THREE.Mesh).material, paint);
  }
});

Deno.test("arch applies dimensions, shared material and root transforms once", () => {
  const paint = new THREE.MeshStandardMaterial({ color: "red" });
  const result = arch({
    openingWidth: 4,
    openingHeight: 5,
    depth: 2,
    thickness: 0.5,
    segments: 7,
    material: paint,
    name: "entry",
    position: [10, 20, 30],
    rotation: [0, 90, 0],
    scale: 2,
    preview: { grid: false },
  });
  assertEquals(result.name, "entry");
  assertEquals(result.userData.preview.grid, false);
  close(bounds(result).min, [8, 20, 25]);
  close(bounds(result).max, [12, 31, 35]);
  for (const child of result.children) {
    assertEquals((child as THREE.Mesh).material, paint);
    close(child.scale, [1, 1, 1]);
    assertEquals(child.rotation.toArray().slice(0, 3), [0, 0, 0]);
  }
  const materials = [paint, new THREE.MeshStandardMaterial()];
  for (const child of arch({ material: materials }).children) {
    assertEquals((child as THREE.Mesh).material, materials);
  }
});

Deno.test("arch can start its semicircle at floor level", () => {
  const result = arch({ openingWidth: 4, openingHeight: 2, thickness: 0.5 });
  assertEquals(result.children.map((child) => child.name), ["crown"]);
  close(bounds(result).min, [-2.5, 0, -0.2]);
  close(bounds(result).max, [2.5, 2.5, 0.2]);
  assertEquals(hit(result, 0, 1), []);
  assert(hit(result, 0, 2.25).includes("crown"));
});

Deno.test("arch rejects invalid dimensions, resolution and opening proportions", () => {
  for (
    const key of [
      "openingWidth",
      "openingHeight",
      "depth",
      "thickness",
    ] as const
  ) {
    for (const value of [0, -1, NaN, Infinity]) {
      assertThrows(() => arch({ [key]: value }), RangeError, key);
    }
  }
  for (const segments of [0, 3, 4.5, NaN, Infinity]) {
    assertThrows(() => arch({ segments }), RangeError, "segments");
  }
  const options: ArchOptions = { openingWidth: 4, openingHeight: 1.9 };
  assertThrows(() => arch(options), RangeError, "openingHeight");
});
