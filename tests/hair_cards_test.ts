import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import * as THREE from "three";
import {
  createHairCardAtlas,
  type HairCardGuide,
  hairCards,
} from "../src/hair/hair-cards.ts";

const guide = (): HairCardGuide => ({
  points: [[0, 0, 0], [0, 1, 0], [0, 2, 0]],
  width: [.2, .2, 0],
  normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
  variant: 3,
});

Deno.test("hair atlas is deterministic, separated into eight tiles and feathered at both ends", () => {
  const a = createHairCardAtlas({ seed: 29, textureSize: 256 });
  const b = createHairCardAtlas({ seed: 29, textureSize: 256 });
  const c = createHairCardAtlas({ seed: 30, textureSize: 256 });
  assertEquals(a.data, b.data);
  assertEquals(a.normalData, b.normalData);
  assertNotEquals(a.data, c.data);
  assertEquals(a.width, 256);
  assertEquals(a.height, 512);
  assertEquals(a.tiles.length, 8);
  const sample = (tile: typeof a.tiles[number], t: number) => {
    const left = Math.round(tile.u0 * a.width - .5);
    const right = Math.round(tile.u1 * a.width - .5);
    const row = Math.round(
      (tile.v0 + (tile.v1 - tile.v0) * t) * a.height - .5,
    );
    return Array.from(
      { length: right - left + 1 },
      (_, x) => a.data[(row * a.width + left + x) * 4 + 3],
    );
  };
  for (const tile of a.tiles) {
    assert(sample(tile, 0).every((alpha) => alpha === 0));
    assert(sample(tile, 1).every((alpha) => alpha === 0));
    const core = sample(tile, .35);
    assert(core.some((alpha) => alpha > 150), "Dense fibers need opaque cores");
    assert(
      core.some((alpha) => alpha === 0),
      "Cards must retain gaps between fibers",
    );
    const mean = (values: number[]) =>
      values.reduce((sum, value) => sum + value, 0) / values.length;
    assert(mean(core) > mean(sample(tile, .9)) * 2);
    assert(mean(core) > mean(sample(tile, .005)) * 2);
  }
  for (let y = 0; y < a.height; y++) {
    for (const x of [0, 63, 64, 127, 128, 191, 192, 255]) {
      assertEquals(a.data[(y * a.width + x) * 4 + 3], 0);
    }
  }
  assert(
    a.normalData.some((channel, i) =>
      i % 4 === 0 && Math.abs(channel - 128) > 12
    ),
    "Fiber normals should describe their cross-sections",
  );
});

Deno.test("hair cards preserve full width, correct outward winding and fiber-aligned anisotropy", () => {
  const source = guide();
  const original = structuredClone(source);
  const object = hairCards([source], {
    textureSize: 128,
    color: "#222222",
    tipColor: "#ffffff",
    colorVariation: 0,
    name: "test-wig",
  });
  assertEquals(source, original);
  assertEquals(object.name, "test-wig");
  assertEquals(object.children.length, 1);
  assertEquals(object.userData.threejsStrands, undefined);
  assertEquals(object.userData.threejsHairCards.guideCount, 1);
  const mesh = object.children[0] as THREE.Mesh<
    THREE.BufferGeometry,
    THREE.MeshPhysicalMaterial
  >;
  const geometry = mesh.geometry;
  const p = geometry.getAttribute("position");
  assertEquals(p.count, 6);
  assertEquals(geometry.index!.count, 9);
  assertAlmostEquals(Math.abs(p.getX(1) - p.getX(0)), .2, 1e-7);
  assertAlmostEquals(Math.abs(p.getX(5) - p.getX(4)), 0, 1e-7);
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let i = 0; i < geometry.index!.count; i += 3) {
    a.fromBufferAttribute(p, geometry.index!.getX(i));
    b.fromBufferAttribute(p, geometry.index!.getX(i + 1));
    c.fromBufferAttribute(p, geometry.index!.getX(i + 2));
    assert(b.sub(a).cross(c.sub(a)).z > 0);
  }
  const n = geometry.getAttribute("normal"),
    t = geometry.getAttribute("tangent");
  for (let i = 0; i < p.count; i++) {
    a.fromBufferAttribute(n, i);
    b.fromBufferAttribute(t, i);
    assertAlmostEquals(a.length(), 1, 1e-6);
    assertAlmostEquals(b.length(), 1, 1e-6);
    assertAlmostEquals(a.dot(b), 0, 1e-6);
    c.copy(a).cross(b).multiplyScalar(t.getW(i));
    assertAlmostEquals(c.dot(new THREE.Vector3(0, 1, 0)), 1, 1e-6);
  }
  const uv = geometry.getAttribute("uv");
  assert(uv.getY(0) < uv.getY(2) && uv.getY(2) < uv.getY(4));
  assert(uv.getX(0) > .75 && uv.getX(1) < 1);
  assert(uv.getY(4) < .5);
  const colors = geometry.getAttribute("color");
  assert(colors.getX(4) > colors.getX(0));
  assertEquals(mesh.material.alphaTest, .3);
  assertEquals(mesh.material.alphaToCoverage, true);
  assertEquals(mesh.material.transparent, false);
  assertEquals(mesh.material.depthWrite, true);
  assertEquals(mesh.material.side, THREE.DoubleSide);
  assertEquals(mesh.material.map!.colorSpace, THREE.SRGBColorSpace);
  assertEquals(mesh.material.normalMap!.colorSpace, THREE.NoColorSpace);
  assertEquals(mesh.material.anisotropyRotation, Math.PI / 2);
  assert(mesh.material.anisotropy > 0);
});

Deno.test("radial frame fallback and curved guides keep finite orthonormal geometry", () => {
  const object = hairCards([{
    points: [[0, .78, 0], [0, 1, 0], [.1, 1.15, .04], [.2, 1.3, .15]],
    width: .08,
  }, {
    points: [[0, 0, 0], [0, 0, 1], [.1, 0, 2]],
    normals: [[0, 0, 0], [0, 0, 1], [0, 0, 1]],
    width: [.03, .07, .01],
  }], { textureSize: 128 });
  const geometry = (object.children[0] as THREE.Mesh).geometry;
  for (const attribute of Object.values(geometry.attributes)) {
    assert(Array.from(attribute.array).every(Number.isFinite));
  }
  const normals = geometry.getAttribute("normal");
  const tangents = geometry.getAttribute("tangent");
  for (let i = 0; i < normals.count; i++) {
    const normal = new THREE.Vector3().fromBufferAttribute(normals, i);
    const tangent = new THREE.Vector3().fromBufferAttribute(tangents, i);
    assertAlmostEquals(normal.length(), 1, 1e-6);
    assertAlmostEquals(tangent.length(), 1, 1e-6);
    assertAlmostEquals(normal.dot(tangent), 0, 1e-6);
  }
});

Deno.test("cambered cards retain their guide ridge and round their edge normals", () => {
  const object = hairCards([{
    points: [[0, 0, 0], [0, .5, 0], [0, 1, 0]],
    width: .2,
    normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
  }], { textureSize: 128, camber: .15 });
  const geometry = (object.children[0] as THREE.Mesh).geometry;
  const position = geometry.getAttribute("position");
  const normal = geometry.getAttribute("normal");
  const tangent = geometry.getAttribute("tangent");
  assertEquals(position.count, 15);
  assertEquals(geometry.index!.count, 48);
  for (let row = 0; row < 3; row++) {
    const start = row * 5;
    assertAlmostEquals(position.getZ(start), -.03, 1e-7);
    assertAlmostEquals(position.getZ(start + 4), -.03, 1e-7);
    assertAlmostEquals(position.getZ(start + 2), 0, 1e-7);
    assertAlmostEquals(position.getX(start + 2), 0, 1e-7);
    assertAlmostEquals(position.getY(start + 2), row * .5, 1e-7);
    assert(normal.getX(start) > .5 && normal.getX(start + 4) < -.5);
    assertAlmostEquals(normal.getZ(start + 2), 1, 1e-7);
    for (let column = 0; column < 5; column++) {
      const at = start + column;
      const n = new THREE.Vector3().fromBufferAttribute(normal, at);
      const t = new THREE.Vector3().fromBufferAttribute(tangent, at);
      const bitangent = n.clone().cross(t).multiplyScalar(tangent.getW(at));
      assertAlmostEquals(n.length(), 1, 1e-6);
      assertAlmostEquals(t.length(), 1, 1e-6);
      assertAlmostEquals(n.dot(t), 0, 1e-6);
      assertAlmostEquals(bitangent.y, 1, 1e-6);
    }
  }
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let i = 0; i < geometry.index!.count; i += 3) {
    a.fromBufferAttribute(position, geometry.index!.getX(i));
    b.fromBufferAttribute(position, geometry.index!.getX(i + 1));
    c.fromBufferAttribute(position, geometry.index!.getX(i + 2));
    assert(b.sub(a).cross(c.sub(a)).z > 0);
  }
});

Deno.test("cambered cards have stable shading through curves and collapsed tips", () => {
  const object = hairCards([{
    points: [[0, 0, 0], [0, .3, .02], [.08, .6, .12], [.1, .9, .18]],
    width: [0, .12, .08, 0],
    normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]],
  }], { textureSize: 128, camber: .18, widthSegments: 6 });
  const geometry = (object.children[0] as THREE.Mesh).geometry;
  assertEquals(geometry.getAttribute("position").count, 28);
  // One triangle per cross-section segment at each collapsed end.
  assertEquals(geometry.index!.count, 72);
  for (const attribute of Object.values(geometry.attributes)) {
    assert(Array.from(attribute.array).every(Number.isFinite));
  }
  const normals = geometry.getAttribute("normal");
  const tangents = geometry.getAttribute("tangent");
  for (let i = 0; i < normals.count; i++) {
    const normal = new THREE.Vector3().fromBufferAttribute(normals, i);
    const tangent = new THREE.Vector3().fromBufferAttribute(tangents, i);
    assertAlmostEquals(normal.length(), 1, 1e-6);
    assertAlmostEquals(tangent.length(), 1, 1e-6);
    assertAlmostEquals(normal.dot(tangent), 0, 1e-6);
    if (i >= 7) {
      const previous = new THREE.Vector3().fromBufferAttribute(normals, i - 7);
      assert(
        normal.dot(previous) > .9,
        "Normals should follow the smooth guide",
      );
    }
  }
});

Deno.test("large hair grooms retain valid indices beyond the 16-bit vertex limit", () => {
  const guides: HairCardGuide[] = Array.from({ length: 600 }, (_, j) => ({
    points: Array.from({ length: 64 }, (_, i) => [j * .02, i * .01, 1]),
    width: .03,
  }));
  const object = hairCards(guides, { textureSize: 128 });
  const geometry = (object.children[0] as THREE.Mesh).geometry;
  const count = geometry.getAttribute("position").count;
  assertEquals(count, 76800);
  assert(geometry.index!.array instanceof Uint32Array);
  const lastIndices = Array.from(geometry.index!.array.slice(-6));
  assertEquals(Math.max(...lastIndices), count - 1);
  assertEquals(geometry.index!.count, 600 * 63 * 6);
});

Deno.test("hair cards reject invalid guides and atlas settings before allocation", () => {
  assertThrows(() => hairCards([], { textureSize: 128 }), RangeError);
  assertThrows(() => hairCards([guide()], { textureSize: 100 }), RangeError);
  assertThrows(() => hairCards([guide()], { density: 0 }), RangeError);
  assertThrows(() => hairCards([guide()], { rootFade: .3 }), RangeError);
  assertThrows(() => hairCards([guide()], { colorVariation: 2 }), RangeError);
  assertThrows(() => hairCards([guide()], { camber: -.1 }), RangeError);
  assertThrows(() => hairCards([guide()], { camber: .6 }), RangeError);
  assertThrows(() => hairCards([guide()], { camber: NaN }), RangeError);
  assertThrows(() => hairCards([guide()], { widthSegments: 0 }), RangeError);
  assertThrows(() => hairCards([guide()], { widthSegments: 9 }), RangeError);
  assertThrows(() => hairCards([guide()], { widthSegments: 2.5 }), RangeError);
  assertThrows(
    () => hairCards([guide()], { camber: .1, widthSegments: 1 }),
    RangeError,
  );
  assertThrows(() => hairCards([guide()], { seed: NaN }), RangeError);
  assertThrows(() => hairCards([{ ...guide(), width: [1] }]), RangeError);
  assertThrows(() => hairCards([{ ...guide(), width: 0 }]), RangeError);
  assertThrows(() => hairCards([{ ...guide(), width: -1 }]), RangeError);
  assertThrows(
    () => hairCards([{ ...guide(), normals: [[1, 0, 0]] }]),
    RangeError,
  );
  assertThrows(() => hairCards([{ ...guide(), variant: 8 }]), RangeError);
  const duplicate = guide();
  duplicate.points[1] = [...duplicate.points[0]];
  assertThrows(() => hairCards([duplicate]), RangeError);
  const invalid = guide();
  invalid.points[1][0] = Infinity;
  assertThrows(() => hairCards([invalid]), RangeError);
});
