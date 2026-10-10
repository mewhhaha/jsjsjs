import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertNotEquals,
  assertThrows,
} from "@std/assert";
import * as THREE from "three";
import {
  groom,
  sampleRoots,
  type StrandRoot,
} from "../src/hair/strand-data.ts";

function triangles(): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      0,
      10,
      0,
      0,
      13,
      0,
      0,
      10,
      3,
      0,
    ], 3),
  );
  geometry.computeVertexNormals();
  geometry.setAttribute(
    "uv",
    new THREE.Float32BufferAttribute([0, 0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1], 2),
  );
  return geometry;
}

Deno.test("surface roots sample area uniformly and repeat exactly with a seed", () => {
  const geometry = triangles();
  const roots = sampleRoots(geometry, { count: 10_000, seed: 90 });
  const small = roots.filter((root) => root.faceIndex === 0);
  assert(Math.abs(small.length / roots.length - .1) < .015);
  assertEquals(
    sampleRoots(geometry, { count: 20, seed: 90 }),
    roots.slice(0, 20),
  );
  assertNotEquals(
    sampleRoots(geometry, { count: 20, seed: 91 }),
    roots.slice(0, 20),
  );
  const centroid = small.reduce(
    (sum, r) => sum.add(new THREE.Vector3(...r.position)),
    new THREE.Vector3(),
  ).divideScalar(small.length);
  assertAlmostEquals(centroid.x, 1 / 3, .025);
  assertAlmostEquals(centroid.y, 1 / 3, .025);
  for (const root of roots) {
    assertEquals(root.normal, [0, 0, 1]);
    assert(root.uv && root.uv[0] + root.uv[1] <= 1 + 1e-8);
  }
});

Deno.test("surface sampling bakes hierarchy transforms without changing parents or geometry", () => {
  const geometry = triangles();
  const original = geometry.getAttribute("position").array.slice();
  const mesh = new THREE.Mesh(geometry);
  const parent = new THREE.Group();
  parent.position.set(2, 3, 4);
  parent.rotation.x = -Math.PI / 2;
  mesh.scale.set(2, 3, 1);
  parent.add(mesh);
  const roots = sampleRoots(mesh, {
    count: 20,
    density: (r) => r.faceIndex === 0 ? 1 : 0,
  });
  assertEquals(mesh.parent, parent);
  assertEquals(geometry.getAttribute("position").array, original);
  for (const root of roots) {
    assertAlmostEquals(root.position[1], 3);
    assertAlmostEquals(root.normal[1], 1);
    assertAlmostEquals((root.position[0] - 2) / 2, root.uv![0]);
    assertAlmostEquals((4 - root.position[2]) / 3, root.uv![1]);
  }
});

Deno.test("nonuniform transforms change sampling probability by world-space triangle area", () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      1,
      0,
      10,
      0,
      0,
      11,
      0,
      0,
      10,
      0,
      1,
    ], 3),
  );
  const mesh = new THREE.Mesh(geometry);
  mesh.scale.set(1, 1, 9);
  const sampled = sampleRoots(mesh, { count: 6000, seed: 50 });
  const fraction = sampled.filter((r) => r.faceIndex === 0).length /
    sampled.length;
  assertAlmostEquals(fraction, .1, .02);
});

Deno.test("density masks use barycentric attributes, callbacks, regions, and bounded rejection", () => {
  const geometry = triangles();
  geometry.setAttribute(
    "density",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 1, 1], 1),
  );
  const roots = sampleRoots(geometry, {
    count: 100,
    densityAttribute: "density",
    region: () => "patch",
  });
  assert(
    roots.every((root) => root.faceIndex === 1 && root.region === "patch"),
  );
  assertThrows(
    () =>
      sampleRoots(geometry, { count: 2, density: () => 0, maxAttempts: 20 }),
    RangeError,
    "accepted 0/2",
  );
  assertThrows(() => sampleRoots(geometry, { density: () => NaN }), RangeError);
  assertThrows(
    () => sampleRoots(geometry, { densityAttribute: "absent" }),
    TypeError,
  );
});

Deno.test("root sampling explicitly rejects unsupported and malformed geometry", () => {
  const geometry = triangles();
  assertThrows(
    () =>
      sampleRoots(
        new THREE.InstancedMesh(geometry, new THREE.MeshBasicMaterial(), 2),
      ),
    TypeError,
    "static",
  );
  assertThrows(
    () => sampleRoots(new THREE.SkinnedMesh(geometry)),
    TypeError,
    "static",
  );
  geometry.setDrawRange(0, 3);
  assertThrows(() => sampleRoots(geometry), TypeError, "draw ranges");
  geometry.setDrawRange(0, Infinity);
  geometry.setIndex([0, 1, 90]);
  assertThrows(() => sampleRoots(geometry), RangeError, "triangle index");
  geometry.setIndex(null);
  geometry.morphAttributes.position = [
    geometry.getAttribute("position").clone(),
  ];
  assertThrows(() => sampleRoots(geometry), TypeError, "morph");
  assertThrows(() => sampleRoots(triangles(), { count: 20_001 }), RangeError);
});

const roots: StrandRoot[] = [
  { position: [0, 0, 0], normal: [0, 1, 0] },
  { position: [.1, 0, 0], normal: [0, 1, 0] },
];
Deno.test("groom is reproducible, root anchored, tapered, and independently randomized", () => {
  const options = {
    seed: 78,
    length: 1,
    radius: .03,
    tipRadius: .001,
    taper: 2,
    segments: 24,
    bend: [0, 0, .2] as const,
    curl: { radius: .1, turns: 2 },
    frizz: { amplitude: .02, frequency: 5 },
    flyaways: { fraction: 1, amplitude: .1 },
  };
  const data = groom(roots, options);
  assertEquals(data, groom(roots, options));
  assertNotEquals(data, groom(roots, { ...options, seed: 79 }));
  data.strands.forEach((strand, i) => {
    assertEquals(strand.points[0], roots[i].position);
    assertEquals(strand.points.length, 25);
    assertAlmostEquals(strand.radii[0], .03);
    assertAlmostEquals(strand.radii.at(-1)!, .001);
    assert(strand.radii.every((r, j) => j === 0 || r <= strand.radii[j - 1]));
    assert(strand.points.flat().every(Number.isFinite));
    assert(strand.shade >= .8 && strand.shade <= 1.2);
  });
  const straight = groom(roots, { length: 1, lengthVariation: 0 });
  assertEquals(straight.strands[0].points.at(-1), [0, 1, 0]);
});

Deno.test("guide interpolation respects regions, normalizes length, and clumps tips", () => {
  const guides = [
    { points: [[0, 0, 0], [0, 0, 2]] as const, region: "a" },
    { points: [[.1, 0, 0], [2.1, 0, 0]] as const, region: "b" },
  ];
  const input = [{ ...roots[0], region: "a" }, { ...roots[1], region: "b" }];
  const result = groom(input, { guides, length: 1, lengthVariation: 0 });
  assertAlmostEquals(result.strands[0].points.at(-1)![2], 1, 1e-5);
  assertAlmostEquals(result.strands[1].points.at(-1)![0], 1.1, 1e-5);
  const clumped = groom(roots, {
    guides: [{ points: [[0, 0, 0], [0, 1, 0]] }],
    clump: 1,
    length: 1,
    lengthVariation: 0,
  });
  assertEquals(
    clumped.strands[0].points.at(-1),
    clumped.strands[1].points.at(-1),
  );
  assertEquals(clumped.strands[1].points[0], roots[1].position);
  assertEquals(result.guides[0], [...guides[0].points]);
});

Deno.test("collision moves interior points outside ellipsoids while roots remain fixed", () => {
  const result = groom(roots.slice(0, 1), {
    length: 1,
    lengthVariation: 0,
    colliders: [{ center: [0, .5, 0], radii: [.2, .3, .2] }],
  });
  assertEquals(result.strands[0].points[0], roots[0].position);
  for (const point of result.strands[0].points.slice(1)) {
    assert(
      (point[0] / .2) ** 2 + ((point[1] - .5) / .3) ** 2 +
          (point[2] / .2) ** 2 >= 1 - 1e-6,
    );
  }
});

Deno.test("curl follows a guide tangent rather than the surface normal", () => {
  const result = groom(roots.slice(0, 1), {
    length: 1,
    lengthVariation: 0,
    segments: 16,
    guides: [{ points: [[0, 0, 0], [2, 0, 0]] }],
    curl: { radius: .1, turns: 3 },
  });
  result.strands[0].points.forEach((point, i) => {
    assertAlmostEquals(point[0], i / 16, 1e-5);
    assertAlmostEquals(
      Math.hypot(point[1], point[2]),
      .1 * Math.sin(i / 16 * Math.PI / 2),
      1e-5,
    );
  });
});

Deno.test("groom validates bounds and rejects degenerate input before producing data", () => {
  assertThrows(() => groom(roots, { segments: 129 }), RangeError);
  assertThrows(() => groom(roots, { lengthVariation: 1 }), RangeError);
  assertThrows(() => groom(roots, { tipRadius: 1 }), RangeError);
  assertThrows(
    () => groom(roots, { guides: [{ points: [[0, 0, 0], [0, 0, 0]] }] }),
    RangeError,
  );
  assertThrows(
    () => groom([{ position: [0, 0, 0], normal: [0, 0, 0] }]),
    RangeError,
  );
  assertThrows(() => groom(roots, { direction: [0, -1, 0] }), RangeError);
  assertThrows(
    () =>
      groom(roots, { colliders: [{ center: [0, 0, 0], radii: [1, 0, 1] }] }),
    RangeError,
  );
  assertThrows(
    () =>
      groom(Array.from({ length: 20_000 }, () => roots[0]), { segments: 128 }),
    RangeError,
    "point budget",
  );
});
