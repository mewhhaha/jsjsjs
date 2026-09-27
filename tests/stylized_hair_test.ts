import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import * as THREE from "three";
import { hairLock } from "../src/stylized-hair.ts";
import { buildCartoonWig } from "../examples/haircuts/cartoon.ts";

function measure(geometry: THREE.BufferGeometry) {
  const position = geometry.getAttribute("position"), index = geometry.index!;
  const edges = new Map<string, number>();
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  let volume = 0, smallestArea = Infinity;
  for (let i = 0; i < index.count; i += 3) {
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    a.fromBufferAttribute(position, ids[0]);
    b.fromBufferAttribute(position, ids[1]);
    c.fromBufferAttribute(position, ids[2]);
    volume += a.dot(b.clone().cross(c)) / 6;
    smallestArea = Math.min(
      smallestArea,
      b.clone().sub(a).cross(c.clone().sub(a)).length() / 2,
    );
    for (let j = 0; j < 3; j++) {
      const first = ids[j], second = ids[(j + 1) % 3];
      const key = first < second ? `${first}:${second}` : `${second}:${first}`;
      edges.set(key, (edges.get(key) ?? 0) + 1);
    }
  }
  return { volume, smallestArea, edges };
}

Deno.test("sculpted hair locks are closed nondegenerate outward meshes with a broad thin profile", () => {
  const lock = hairLock([[0, 0, 0], [0, 1, 0]], {
    width: .4,
    thickness: .07,
    normal: [0, 0, 1],
    widthProfile: [1, 1, 0],
  });
  const stats = measure(lock.geometry);
  assert(stats.volume > 0);
  assert(stats.smallestArea > 1e-10);
  assert([...stats.edges.values()].every((count) => count === 2));
  const size = lock.geometry.boundingBox!.getSize(new THREE.Vector3());
  assertAlmostEquals(size.x, .4, 1e-6);
  assertAlmostEquals(size.z, .07 * 1.25, 1e-6);
  assertAlmostEquals(size.y, 1, 1e-6);
  assert(lock.material instanceof THREE.MeshStandardMaterial);
  assert(!(lock.material as THREE.Material).transparent);
  for (const name of ["position", "normal", "uv", "color"]) {
    assert(
      Array.from(lock.geometry.getAttribute(name).array).every(Number.isFinite),
    );
  }
  const normals = lock.geometry.getAttribute("normal");
  for (let i = 0; i < normals.count; i++) {
    assertAlmostEquals(
      new THREE.Vector3().fromBufferAttribute(normals, i).length(),
      1,
      1e-5,
    );
  }
});

Deno.test("curved pointed locks transport their frames and preserve input data", () => {
  const path = [[0, 0, 0], [0, .4, .1], [.25, .7, .25], [.5, .75, .4]] as const;
  const lock = hairLock(path, {
    width: .15,
    thickness: .025,
    widthProfile: [0, 1, .6, 0],
    twist: 35,
    normals: [[0, 1, 0], [0, 0, 1], [0, 0, 1], [0, 0, 1]],
  });
  const again = hairLock(path, {
    width: .15,
    thickness: .025,
    widthProfile: [0, 1, .6, 0],
    twist: 35,
    normals: [[0, 1, 0], [0, 0, 1], [0, 0, 1], [0, 0, 1]],
  });
  assertEquals(
    lock.geometry.getAttribute("position").array,
    again.geometry.getAttribute("position").array,
  );
  assertEquals(path[0], [0, 0, 0]);
  const stats = measure(lock.geometry);
  assert(stats.volume > 0 && stats.smallestArea > 1e-12);
  assert([...stats.edges.values()].every((count) => count === 2));
  const position = lock.geometry.getAttribute("position");
  assertEquals([position.getX(0), position.getY(0), position.getZ(0)], [
    0,
    0,
    0,
  ]);
  const end = position.count - 1;
  assertAlmostEquals(position.getX(end), .5, 1e-6);
  assertAlmostEquals(position.getY(end), .75, 1e-6);
  assertAlmostEquals(position.getZ(end), .4, 1e-6);
});

Deno.test("stylized geometry rejects invalid or unbounded input before allocation", () => {
  const path = [[0, 0, 0], [0, 1, 0]] as const;
  for (
    const options of [
      { width: 0 },
      { thickness: -1 },
      { segments: 100000 },
      { crossSegments: 3 },
      { widthProfile: [1, 0, 1] },
      { widthProfile: [0, 0] },
      { ridge: 1 },
      { normals: [[0, 0, 1]] as const },
      { normal: [0, 0, 0] as const },
      { twist: NaN },
    ]
  ) assertThrows(() => hairLock(path, options), RangeError);
  assertThrows(() => hairLock([[0, 0, 0], [0, 0, 0]]), RangeError);
  assertThrows(() => hairLock([[0, 0, 0], [NaN, 0, 0]]), RangeError);
});

Deno.test("cartoon presets share the anatomical head frame and use portable finite meshes", () => {
  for (const style of ["quiff", "bob"] as const) {
    const wig = buildCartoonWig(style);
    const box = new THREE.Box3().setFromObject(wig),
      size = box.getSize(new THREE.Vector3());
    assert(size.x > .7 && size.x < 1.4);
    assert(box.min.y > .2 && box.max.y < 1.9);
    let lockCount = 0, triangles = 0;
    wig.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      assert(object.material instanceof THREE.MeshStandardMaterial);
      assert(
        Array.from(object.geometry.getAttribute("position").array).every(
          Number.isFinite,
        ),
      );
      triangles += object.geometry.index!.count / 3;
      if (object.userData.threejsHairLock) {
        lockCount++;
        assert(measure(object.geometry).volume > 0);
      }
    });
    assert(lockCount >= 20 && lockCount <= 45);
    assert(triangles < 60000);
  }
});
