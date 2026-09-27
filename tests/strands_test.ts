import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import {
  hair,
  hairMaterial,
  type StrandData,
  strands,
  THREE,
} from "../src/prelude.ts";

const data = (): StrandData => ({
  version: 1,
  seed: 1,
  guides: [],
  strands: [{
    points: [[0, 0, 0], [0, 1, 0], [0, 2, 0]],
    radii: [.1, .05, 0],
    shade: 1,
  }],
});

function volume(geometry: THREE.BufferGeometry) {
  const positions = geometry.getAttribute("position"), index = geometry.index!;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  let volume = 0;
  for (let i = 0; i < index.count; i += 3) {
    a.fromBufferAttribute(positions, index.getX(i));
    b.fromBufferAttribute(positions, index.getX(i + 1));
    c.fromBufferAttribute(positions, index.getX(i + 2));
    volume += a.dot(b.cross(c)) / 6;
  }
  return volume;
}
Deno.test("strand tubes taper with outward winding, UVs and strand-aligned anisotropy", () => {
  const source = data();
  const coat = strands(source, {
    radialSegments: 4,
    position: [2, 3, 4],
    color: "#331100",
    tipColor: "#ffffff",
  });
  const mesh = coat.children[0] as THREE.Mesh;
  assertEquals(coat.children.length, 1);
  assertEquals(mesh.userData.threejsStrandPreview, true);
  assertEquals(coat.userData.threejsStrandId, coat.uuid);
  assertAlmostEquals(volume(mesh.geometry), 2 * .1 * .1 * 2 / 3, 1e-8);
  assertEquals(coat.position.toArray(), [2, 3, 4]);
  assertEquals(source.strands[0].points[0], [0, 0, 0]);
  const normals = mesh.geometry.getAttribute("normal"),
    tangents = mesh.geometry.getAttribute("tangent");
  for (let i = 0; i < normals.count; i++) {
    const n = new THREE.Vector3().fromBufferAttribute(normals, i),
      t = new THREE.Vector3().fromBufferAttribute(tangents, i);
    assertAlmostEquals(n.length(), 1, 1e-6);
    assertAlmostEquals(t.length(), 1, 1e-6);
    assertAlmostEquals(n.dot(t), 0, 1e-6);
  }
  const colors = mesh.geometry.getAttribute("color");
  assert(colors.getX(10) > colors.getX(0));
  source.strands[0].radii[0] = 99;
  assertEquals(coat.userData.threejsStrands.strands[0].radii[0], .1);
});
Deno.test("crossed ribbons preserve roots, width and finite normals without tube geometry", () => {
  const object = strands(data(), { mode: "ribbons", ribbonPlanes: 2 });
  const mesh = object.children[0] as THREE.Mesh;
  assertEquals(mesh.geometry.getAttribute("position").count, 12);
  const size = mesh.geometry.boundingBox!.getSize(new THREE.Vector3());
  assertAlmostEquals(size.x, .2, 1e-6);
  assertAlmostEquals(size.z, .2, 1e-6);
  assertEquals(size.y, 2);
  assert(
    Array.from(mesh.geometry.getAttribute("normal").array).every(
      Number.isFinite,
    ),
  );
  assertEquals((mesh.material as THREE.Material).side, THREE.DoubleSide);
});
Deno.test("hair batches surface roots reproducibly and keeps transforms independent", () => {
  const surface = new THREE.Mesh(new THREE.PlaneGeometry(1, 1));
  surface.rotation.x = -Math.PI / 2;
  surface.position.y = 2;
  const options = {
    roots: { count: 12, seed: 7 },
    groom: { length: .2, segments: 4 },
    render: { name: "coat" },
  };
  const a = hair(surface, options), b = hair(surface, options);
  assertEquals(a.userData.threejsStrands, b.userData.threejsStrands);
  assertEquals(a.name, "coat");
  assertEquals(a.children.length, 1);
  for (const strand of a.userData.threejsStrands.strands) {
    assertAlmostEquals(strand.points[0][1], 2, 1e-6);
  }
  const paint = hairMaterial({ roughness: .7 });
  assertEquals(paint.vertexColors, true);
  assertEquals(paint.roughness, .7);
  assert(paint.anisotropy > 0);
});
Deno.test("strand rendering rejects invalid geometry and dimensions before allocation", () => {
  assertThrows(() => strands(data(), { radialSegments: 2 }));
  assertThrows(() => strands(data(), { colorVariation: 2 }));
  const source = data();
  source.strands[0].radii.pop();
  assertThrows(() => strands(source));
  const duplicate = data();
  duplicate.strands[0].points[1] = [0, 0, 0];
  assertThrows(() => strands(duplicate));
});
