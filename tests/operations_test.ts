import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertRejects,
} from "@std/assert";
import {
  bevel,
  box,
  group,
  intersect,
  offsetProfile,
  subtract,
  THREE,
  union,
} from "../src/prelude.ts";

function volume(mesh: THREE.Mesh): number {
  const p = mesh.geometry.getAttribute("position"), index = mesh.geometry.index;
  let total = 0;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    a.fromBufferAttribute(p, index?.getX(i) ?? i);
    b.fromBufferAttribute(p, index?.getX(i + 1) ?? i + 1);
    c.fromBufferAttribute(p, index?.getX(i + 2) ?? i + 2);
    total += a.dot(b.cross(c)) / 6;
  }
  return total;
}

Deno.test("solid operations preserve correct volumes, inputs and transforms", async () => {
  const a = box([2, 2, 2]), b = box([2, 2, 2], { position: [1, 0, 0] });
  assertAlmostEquals(volume(await union([a, b])), 12, 1e-6);
  assertAlmostEquals(volume(await intersect([a, b])), 4, 1e-6);
  assertAlmostEquals(volume(await subtract(a, b)), 4, 1e-6);
  assertEquals(a.geometry.getAttribute("position").count, 24);
  assertEquals(a.position.toArray(), [0, 0, 0]);
  const smooth = await union([a], { smooth: true });
  const normals = smooth.geometry.getAttribute("normal");
  const positions = smooth.geometry.getAttribute("position");
  const corners = new Map<string, number[]>();
  for (let i = 0; i < positions.count; i++) {
    const key = [positions.getX(i), positions.getY(i), positions.getZ(i)].join(
      ",",
    );
    const normal = [normals.getX(i), normals.getY(i), normals.getZ(i)];
    if (corners.has(key)) assertEquals(normal, corners.get(key));
    corners.set(key, normal);
    assertAlmostEquals(Math.hypot(...normal), 1, 1e-6);
  }
  const parent = group([box([2, 2, 2], { scale: [-1, 1, 1] })], {
    position: [4, 0, 0],
  });
  const solid = await union([parent]);
  assertAlmostEquals(volume(solid), 8, 1e-6);
  assertEquals(new THREE.Box3().setFromObject(solid).min.toArray(), [
    3,
    -1,
    -1,
  ]);
  assertEquals(
    (await intersect([a, box([1, 1, 1], { position: [20, 0, 0] })])).geometry
      .getAttribute("position").count,
    0,
  );
});

Deno.test("subtraction cuts a real through-hole and rejects open geometry", async () => {
  const cut = await subtract(box([2, 2, 2]), box([.5, 3, .5]));
  cut.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(
    new THREE.Vector3(0, 3, 0),
    new THREE.Vector3(0, -1, 0),
  );
  assertEquals(ray.intersectObject(cut).length, 0);
  assertAlmostEquals(volume(cut), 7.5, 1e-6);
  await assertRejects(() => union([new THREE.Mesh(new THREE.PlaneGeometry())]));
  await assertRejects(() => union([]), RangeError);
  await assertRejects(() => union([new THREE.Group()]), Error, "nonempty");
  const collapsed = box([1, 1, 1]);
  collapsed.scale.setScalar(0);
  await assertRejects(
    () => union([collapsed]),
    Error,
    "invertible",
  );
  const repeated = await union([
    await union([box([1, 1, 1])]),
    box([1, 1, 1], { position: [.5, 0, 0] }),
  ]);
  assertAlmostEquals(volume(repeated), 1.5, 1e-6);
});

Deno.test("offsets expand outlines, shrink holes and preserve disconnected islands", async () => {
  const shape = new THREE.Shape(
    [[-2, -2], [2, -2], [2, 2], [-2, 2]].map(([x, y]) =>
      new THREE.Vector2(x, y)
    ),
  );
  shape.holes.push(
    new THREE.Path(
      [[-1, -1], [-1, 1], [1, 1], [1, -1]].map(([x, y]) =>
        new THREE.Vector2(x, y)
      ),
    ),
  );
  const [expanded] = await offsetProfile(shape, .25, { join: "miter" });
  assertEquals(expanded.holes.length, 1);
  assertAlmostEquals(
    Math.abs(THREE.ShapeUtils.area(expanded.getPoints())),
    20.25,
    1e-5,
  );
  assertAlmostEquals(
    Math.abs(THREE.ShapeUtils.area(expanded.holes[0].getPoints())),
    2.25,
    1e-5,
  );
  assertEquals(
    (await offsetProfile([[0, 0], [1, 0], [1, 1], [0, 1]], -1)).length,
    0,
  );
  const islands = await offsetProfile([
    [0, 0],
    [2, 0],
    [2, .9],
    [3, .9],
    [3, 0],
    [5, 0],
    [5, 2],
    [3, 2],
    [3, 1.1],
    [2, 1.1],
    [2, 2],
    [0, 2],
  ], -.2);
  assertEquals(islands.length, 2);
  const beveled = bevel(expanded, { amount: .05, depth: .4 });
  assert(volume(beveled) > 0);
  assert(
    Array.from(beveled.geometry.getAttribute("normal").array).every(
      Number.isFinite,
    ),
  );
  await assertRejects(() => offsetProfile([[0, 0], [1, 0]], 1), RangeError);
});
