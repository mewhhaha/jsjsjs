import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import * as THREE from "three";
import { ramp, stairs, type StairsOptions } from "../src/architecture.ts";

function bounds(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object, true);
}
function close(actual: THREE.Vector3, expected: number[]): void {
  actual.toArray().forEach((value, i) =>
    assertAlmostEquals(value, expected[i], 1e-6)
  );
}

Deno.test("stairs ascend toward +Z with touching columns or thin floating treads", () => {
  for (const style of ["solid", "treads"] as const) {
    const result = stairs({ width: 4, steps: 4, rise: 0.5, run: 0.75, style });
    close(bounds(result).min, [-2, style === "solid" ? 0 : 0.375, 0]);
    close(bounds(result).max, [2, 2, 3]);
    assertEquals(result.children.length, 4);
    for (let i = 0; i < result.children.length; i++) {
      const child = result.children[i] as THREE.Mesh;
      assert(child instanceof THREE.Mesh);
      assertEquals(child.name, `step_${i + 1}`);
      assert(child.material === (result.children[0] as THREE.Mesh).material);
      const extent = bounds(child);
      assertAlmostEquals(extent.max.y, (i + 1) * 0.5);
      assertAlmostEquals(
        extent.min.y,
        style === "solid" ? 0 : (i + 1) * 0.5 - 0.125,
      );
      assertAlmostEquals(extent.min.z, i * 0.75);
      assertAlmostEquals(extent.max.z, (i + 1) * 0.75);
    }
  }
  const thick = stairs({
    steps: 1,
    rise: 0.5,
    style: "treads",
    treadThickness: 0.5,
  });
  assertAlmostEquals(bounds(thick).min.y, 0);
  close(bounds(stairs()).max, [1, 1.2, 1.8]);
});

Deno.test("stairs apply transforms and preview to the root once", () => {
  const paint = new THREE.MeshStandardMaterial();
  const preview = { target: [0, 1, 0] as const, grid: false };
  const result = stairs({
    width: 2,
    steps: 2,
    rise: 1,
    run: 2,
    material: paint,
    name: "entrance",
    position: [10, 5, 20],
    rotation: [0, 90, 0],
    scale: 2,
    preview,
  });
  assertEquals(result.name, "entrance");
  assertEquals(result.userData.preview, { ...preview, background: undefined });
  assert(result.userData.preview !== preview);
  close(bounds(result).min, [10, 5, 18]);
  close(bounds(result).max, [18, 9, 22]);
  for (const child of result.children) {
    assert((child as THREE.Mesh).material === paint);
    close(child.scale, [1, 1, 1]);
    assertEquals(child.rotation.y, 0);
    assertEquals(child.userData.preview, undefined);
  }
});

Deno.test("ramp has closed outward-facing topology and an ascending slope", () => {
  const result = ramp({ width: 4, height: 2, length: 6 });
  close(bounds(result).min, [-2, 0, 0]);
  close(bounds(result).max, [2, 2, 6]);
  const geometry = result.geometry;
  const positions = geometry.getAttribute("position");
  const uv = geometry.getAttribute("uv");
  assertEquals(uv.count, positions.count);
  assert(Array.from(uv.array).every(Number.isFinite));
  const index = geometry.index!;
  let volume = 0;
  const edges = new Map<string, number>();
  for (let i = 0; i < index.count; i += 3) {
    const triangle = [0, 1, 2].map((offset) =>
      new THREE.Vector3().fromBufferAttribute(positions, index.getX(i + offset))
    );
    volume += triangle[0].dot(
      new THREE.Vector3().crossVectors(triangle[1], triangle[2]),
    ) / 6;
    for (let edge = 0; edge < 3; edge++) {
      const from = triangle[edge].toArray().join(",");
      const to = triangle[(edge + 1) % 3].toArray().join(",");
      const key = `${from}|${to}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  assertAlmostEquals(volume, 4 * 2 * 6 / 2);
  for (const [edge, count] of edges) {
    assertEquals(count, 1);
    assertEquals(edges.get(edge.split("|").reverse().join("|")), 1);
  }
  for (const z of [1, 3, 5]) {
    const hits = new THREE.Raycaster(
      new THREE.Vector3(0, 4, z),
      new THREE.Vector3(0, -1, 0),
    ).intersectObject(result);
    assert(hits.length > 0);
    assertAlmostEquals(hits[0].point.y, z / 3);
    assert(hits[0].face!.normal.y > 0);
    assert(hits[0].face!.normal.z < 0);
  }
});

Deno.test("ramp honors materials, transforms and defaults", () => {
  close(bounds(ramp()).max, [1, 1, 3]);
  const paint = [new THREE.MeshStandardMaterial()];
  const result = ramp({
    name: "slope",
    material: paint,
    position: [1, 2, 3],
    rotation: [0, 90, 0],
    scale: 2,
  });
  assert(result.material === paint);
  assertEquals(result.name, "slope");
  close(bounds(result).min, [1, 2, 1]);
  close(bounds(result).max, [7, 4, 5]);
  assertEquals(result.geometry.groups[0].materialIndex, 0);
});

Deno.test("stairs and ramp reject invalid dimensions and step configuration", () => {
  for (const value of [0, -1, NaN, Infinity]) {
    for (const key of ["width", "rise", "run", "treadThickness"]) {
      assertThrows(() => stairs({ [key]: value }), RangeError);
    }
    for (const key of ["width", "height", "length"]) {
      assertThrows(() => ramp({ [key]: value }), RangeError);
    }
  }
  for (const steps of [0, -1, 1.5, Infinity, NaN]) {
    assertThrows(() => stairs({ steps }), RangeError);
  }
  assertThrows(
    () => stairs({ style: "other" as StairsOptions["style"] }),
    RangeError,
  );
  assertThrows(() => stairs({ rise: 0.2, treadThickness: 0.3 }), RangeError);
});
