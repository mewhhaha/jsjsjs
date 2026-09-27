import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  align,
  box,
  center,
  cylinder,
  extrude,
  ground,
  group,
  lathe,
  material,
  mirror,
  radial,
  repeat,
  roundedBox,
  sphere,
  THREE,
  transform,
  tube,
} from "../src/prelude.ts";

function bounds(object: THREE.Object3D): THREE.Box3 {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object, true);
}
function close(actual: THREE.Vector3, expected: number[], tolerance = 1e-6) {
  actual.toArray().forEach((value, i) =>
    assertAlmostEquals(value, expected[i], tolerance)
  );
}

Deno.test("prelude primitives are native meshes with dimensions, materials and degree rotations", () => {
  const paint = material({ color: "#eebb66", roughness: 0.3, name: "paint" });
  const block = box([2, 4, 6], {
    name: "block",
    material: paint,
    rotation: [0, 90, 0],
  });
  assert(block instanceof THREE.Mesh);
  assertEquals(block.material, paint);
  assertEquals(block.name, "block");
  assertAlmostEquals(block.rotation.y, Math.PI / 2);
  close(bounds(block).getSize(new THREE.Vector3()), [6, 4, 2]);
  const rounded = roundedBox([2, 3, 4], 0.25);
  close(bounds(rounded).getSize(new THREE.Vector3()), [2, 3, 4]);
  const points = rounded.geometry.getAttribute("position");
  let minCornerDistance = Infinity;
  for (let i = 0; i < points.count; i++) {
    minCornerDistance = Math.min(
      minCornerDistance,
      new THREE.Vector3(1, 1.5, 2).distanceTo(
        new THREE.Vector3().fromBufferAttribute(points, i),
      ),
    );
  }
  assert(
    minCornerDistance > 0.1,
    "rounded geometry must remove the sharp box corners",
  );
  close(bounds(sphere(2)).getSize(new THREE.Vector3()), [4, 4, 4]);
  close(bounds(cylinder(2, 5, { radiusTop: 0 })).getSize(new THREE.Vector3()), [
    4,
    5,
    4,
  ]);
  assertEquals(material("red").color.getHex(), 0xff0000);
  assertEquals(material(new THREE.Color("blue")).color.getHex(), 0x0000ff);
  const background = new THREE.Color("#123456");
  const scene = group([], { preview: { background, lighting: { key: 4 } } });
  assertEquals(
    new THREE.Color(scene.userData.preview.background).getHex(),
    background.getHex(),
  );
  background.set("red");
  assertEquals(
    new THREE.Color(scene.userData.preview.background).getHex(),
    0x123456,
  );
});

Deno.test("prelude profiles and paths make useful extrusions, revolutions and tubes", () => {
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(2, 0);
  shape.lineTo(2, 3);
  shape.lineTo(0, 3);
  shape.closePath();
  const solid = extrude(shape, { depth: 4 });
  close(bounds(solid).getSize(new THREE.Vector3()), [2, 3, 4]);
  close(bounds(solid).min, [0, 0, 0]);
  const revolved = lathe([[0, 0], [2, 0], [2, 3], [0, 3]]);
  close(bounds(revolved).getSize(new THREE.Vector3()), [4, 3, 4]);
  const pipe = tube([[0, 0, 0], [0, 5, 0]], { radius: 0.5 });
  close(bounds(pipe).getSize(new THREE.Vector3()), [1, 5, 1]);
  const nativePath = new THREE.LineCurve3(
    new THREE.Vector3(),
    new THREE.Vector3(0, 2, 0),
  );
  close(bounds(tube(nativePath, { radius: 1 })).getSize(new THREE.Vector3()), [
    2,
    2,
    2,
  ]);
});

Deno.test("prelude positions world bounds correctly inside rotated and scaled parents", () => {
  const child = box([1, 2, 3], { position: [2, 3, 4], rotation: [10, 20, 30] });
  const parent = group([child], {
    position: [10, 20, -30],
    rotation: [25, -35, 45],
    scale: [2, 3, 0.5],
  });
  group([parent], { position: [6, 7, 8], rotation: [12, 34, 56], scale: 1.5 });
  const originalCenter = bounds(child).getCenter(new THREE.Vector3());
  assertEquals(center(child, "xz"), child);
  close(bounds(child).getCenter(new THREE.Vector3()), [0, originalCenter.y, 0]);
  assertEquals(ground(child, 7), child);
  assertAlmostEquals(bounds(child).min.y, 7);
  const target = box([4, 5, 6], { position: [17, -3, 11] });
  const beforeY = bounds(child).min.y;
  assertEquals(align(child, target, { x: "max", z: "min" }), child);
  assertAlmostEquals(bounds(child).max.x, bounds(target).max.x);
  assertAlmostEquals(bounds(child).min.z, bounds(target).min.z);
  assertAlmostEquals(bounds(child).min.y, beforeY);
  align(child, bounds(target));
  close(bounds(child).getCenter(new THREE.Vector3()), [17, -3, 11]);
  assertEquals(transform(child, { scale: 2 }), child);
  close(child.scale, [2, 2, 2]);
});

Deno.test("prelude repeat factories preserve templates and provide distinct objects", () => {
  const template = box([1, 2, 3], { position: [1, 2, 3], name: "original" });
  const row = repeat(
    3,
    [4, 0, 0],
    (index) => transform(template.clone(), { name: `copy-${index}` }),
  );
  assert(row instanceof THREE.Group);
  assertEquals(row.children.length, 3);
  close(row.children[0].position, [1, 2, 3]);
  close(row.children[2].position, [9, 2, 3]);
  close(template.position, [1, 2, 3]);
  assertEquals(template.parent, null);
  const angles: number[] = [];
  const ring = radial(4, 2, (_i, angle) => {
    angles.push(angle);
    return box();
  }, { orient: true });
  close(ring.children[0].position, [2, 0, 0]);
  close(ring.children[1].position, [0, 0, 2]);
  close(ring.children[3].position, [0, 0, -2]);
  assertAlmostEquals(angles[1], Math.PI / 2);
  close(
    new THREE.Vector3(1, 0, 0).applyQuaternion(ring.children[1].quaternion),
    [0, 0, 1],
  );
  const arc = radial(3, 2, () => box(), { startAngle: 90, sweep: 180 });
  close(arc.children[0].position, [0, 0, 2]);
  close(arc.children[2].position, [0, 0, -2]);
  const reflected = mirror(template.clone(), "x");
  close(bounds(reflected).getCenter(new THREE.Vector3()), [-1, 2, 3]);
  close(template.position, [1, 2, 3]);
  assertThrows(() => repeat(2, [1, 0, 0], () => template));
});

Deno.test("prelude rejects invalid dimensions, segments, profiles and paths", () => {
  const invalid = [
    () => box([0, 1, 1]),
    () => box([1, Infinity, 1]),
    () => roundedBox([1, 1, 1], 0.6),
    () => roundedBox([1, 1, 1], -1),
    () => sphere(NaN),
    () => sphere(1, { widthSegments: 2 }),
    () => cylinder(1, 0),
    () => cylinder(1, 1, { radiusTop: -1 }),
    () => cylinder(1, 1, { radialSegments: 3.5 }),
    () => lathe([[0, 0], [0, 1]]),
    () => lathe([[1, 1], [1, 1]]),
    () => lathe([[-1, 0], [2, 1]]),
    () => tube([[0, 0, 0]]),
    () => tube([[0, 0, 0], [0, 0, 0]]),
    () => tube([[0, 0, 0], [0, 1, 0]], { closed: true }),
    () => tube([[0, 0, 0], [0, 1, 0], [0, 0, 0]], { closed: true }),
    () => tube(new THREE.LineCurve3(new THREE.Vector3(), new THREE.Vector3())),
    () => extrude([]),
    () => extrude(new THREE.Shape()),
    () => repeat(0, [1, 0, 0], () => box()),
    () => radial(3, 1, () => box(), { sweep: 361 }),
    () => transform(box(), { scale: 0 }),
    () => center(group()),
  ];
  for (const attempt of invalid) assertThrows(attempt, RangeError);
});
