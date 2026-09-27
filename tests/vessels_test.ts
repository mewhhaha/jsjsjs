import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import * as THREE from "three";
import {
  basin,
  bottle,
  bowl,
  canopy,
  cone,
  cup,
  dome,
  funnel,
  hemisphere,
  knob,
  pedestal,
  planter,
  tank,
  tray,
  urn,
  vase,
} from "../src/vessels.ts";

function hits(
  object: THREE.Object3D,
  origin: [number, number, number],
  direction: [number, number, number],
) {
  object.updateWorldMatrix(true, true);
  return new THREE.Raycaster(
    new THREE.Vector3(...origin),
    new THREE.Vector3(...direction),
  ).intersectObject(object, true);
}
function bounds(object: THREE.Object3D) {
  object.updateWorldMatrix(true, true);
  return new THREE.Box3().setFromObject(object, true);
}
function volume(g: THREE.BufferGeometry) {
  const p = g.getAttribute("position"), index = g.index;
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  let sum = 0;
  for (let i = 0; i < (index?.count ?? p.count); i += 3) {
    a.fromBufferAttribute(p, index ? index.getX(i) : i);
    b.fromBufferAttribute(p, index ? index.getX(i + 1) : i + 1);
    c.fromBufferAttribute(p, index ? index.getX(i + 2) : i + 2);
    sum += a.dot(b.cross(c)) / 6;
  }
  return sum;
}

Deno.test("all vessel and shell helpers produce finite outward-facing geometry", () => {
  for (
    const make of [
      basin,
      bowl,
      tray,
      cup,
      planter,
      tank,
      vase,
      bottle,
      urn,
      pedestal,
      knob,
      dome,
      hemisphere,
      cone,
      funnel,
      canopy,
    ]
  ) {
    const object = make();
    let meshes = 0;
    object.traverse((part) => {
      if (!(part instanceof THREE.Mesh)) return;
      meshes++;
      for (const name of ["position", "normal"]) {
        assert(
          Array.from(
            part.geometry.getAttribute(name).array as ArrayLike<number>,
          ).every(Number.isFinite),
          `${make.name}: finite ${name}`,
        );
      }
      assert(volume(part.geometry) > 0, `${make.name}: outward volume`);
    });
    assert(meshes > 0);
    assertAlmostEquals(bounds(object).min.y, 0, 1e-6, make.name);
  }
});

Deno.test("round and rectangular basins have hollow interiors, real floors, and real drains", () => {
  for (const shape of ["round", "rectangular"] as const) {
    for (const taper of [-.08, 0, .1]) {
      const o = basin({
        shape,
        width: 1.2,
        depth: .8,
        radius: .6,
        height: .7,
        taper,
        wallThickness: .05,
        bottomThickness: .08,
      });
      const inside = hits(o, [.1, 2, 0], [0, -1, 0]);
      assert(inside.length > 0);
      assertAlmostEquals(
        inside[0].point.y,
        .08,
        1e-6,
        "open top and raised inside floor",
      );
      assertEquals(hits(o, [.1, .4, 0], [0, 1, 0]).length, 0);
      const underside = hits(o, [.1, -1, 0], [0, 1, 0]);
      assertAlmostEquals(underside[0].point.y, 0, 1e-6);
      assert(
        hits(o, [0, .4, 0], [1, 0, 0]).length > 0,
        "inner walls face inward",
      );
      assert(
        hits(o, [2, .4, 0], [-1, 0, 0]).length > 0,
        "outer walls face outward",
      );
      const drained = basin({ shape, taper, drainRadius: .08 });
      assertEquals(
        hits(drained, [0, 2, 0], [0, -1, 0]).length,
        0,
        "drain is open",
      );
      assertEquals(
        hits(drained, [0, -1, 0], [0, 1, 0]).length,
        0,
        "drain open from below",
      );
      assert(
        hits(drained, [0, .025, 0], [1, 0, 0]).length > 0,
        "drain has bore walls",
      );
      assert(volume(drained.geometry) > 0);
    }
  }
});

Deno.test("basin lip, rectangular corners, and transforms preserve specified bounds", () => {
  const paint = new THREE.MeshStandardMaterial();
  const b = basin({
    shape: "rectangular",
    width: 2,
    depth: 1,
    height: .5,
    cornerRadius: .2,
    taper: .1,
    rimWidth: .05,
    rimHeight: .03,
    position: [2, 3, 4],
    scale: 2,
    material: paint,
  });
  const box = bounds(b);
  assertAlmostEquals(box.min.x, -.1, 1e-6);
  assertAlmostEquals(box.max.x, 4.1, 1e-6);
  assertAlmostEquals(box.min.y, 3, 1e-6);
  assertAlmostEquals(box.max.y, 4.06, 1e-6);
  assertEquals(b.material, paint);
  const rounded = basin({ shape: "rectangular", cornerRadius: .2 });
  assertEquals(hits(rounded, [.49, 2, .49], [0, -1, 0]).length, 0);
});

Deno.test("cups and tanks retain editable components and transform groups once", () => {
  const paint = new THREE.MeshStandardMaterial();
  const c = cup({ position: [4, 5, 6], scale: 2, material: paint });
  assertEquals(c.children.map((p) => p.name), ["body", "handle"]);
  assertEquals(c.children[0].position.toArray(), [0, 0, 0]);
  assertEquals(c.children[0].scale.toArray(), [1, 1, 1]);
  assert(c.children.every((p) => (p as THREE.Mesh).material === paint));
  assertAlmostEquals(bounds(c).min.y, 5, 1e-6);
  assertEquals(cup({ handle: false }).children.length, 1);
  for (const shape of ["round", "rectangular"] as const) {
    const closed = tank({ shape, height: 1, lidThickness: .07 });
    assertEquals(closed.children.map((p) => p.name), ["body", "lid"]);
    assertAlmostEquals(
      hits(closed, [.1, 3, 0], [0, -1, 0])[0].point.y,
      1.07,
      1e-6,
    );
    assertAlmostEquals(
      hits(tank({ shape, closed: false }), [.1, 3, 0], [0, -1, 0])[0].point.y,
      .05,
      1e-6,
    );
  }
});

Deno.test("curved vessels and open-neck profiles have an interior floor rather than a filled body", () => {
  for (const make of [bowl, vase, bottle, urn]) {
    const object = make({ bottomThickness: .04 });
    const floor = hits(object, [.01, 3, 0], [0, -1, 0]);
    assert(floor.length > 0, make.name);
    assertAlmostEquals(floor[0].point.y, .04, 1e-6, make.name);
    assertEquals(
      hits(object, [.01, .1, 0], [0, 1, 0]).length,
      0,
      `${make.name}: open neck`,
    );
  }
  assertEquals(hits(planter(), [0, 2, 0], [0, -1, 0]).length, 0);
  assertEquals(hits(funnel(), [0, 2, 0], [0, -1, 0]).length, 0);
  assert(hits(funnel(), [0, .1, 0], [1, 0, 0]).length > 0);
});

Deno.test("dome, hemisphere, cone shells and canopy have accessible undersides", () => {
  for (const make of [dome, hemisphere, cone]) {
    const solid = make();
    assertAlmostEquals(
      hits(solid, [.03, -1, 0], [0, 1, 0])[0].point.y,
      0,
      1e-6,
    );
    const shell = make({ thickness: .04 });
    const inside = hits(shell, [.03, -1, 0], [0, 1, 0]);
    assert(inside.length > 0);
    assert(inside[0].point.y > .1, `${make.name}: underside is hollow`);
    assert(volume(shell.geometry) > 0);
  }
  const roof = canopy({ width: 4, depth: 3, rise: 1, thickness: .1 });
  assertAlmostEquals(hits(roof, [0, -1, 0], [0, 1, 0])[0].point.y, 1, 1e-6);
  assertAlmostEquals(bounds(roof).max.y, 1.1, 1e-6);
  assertAlmostEquals(bounds(roof).min.z, -1.5, 1e-6);
  assertEquals(hits(roof, [0, .5, 5], [0, 0, -1]).length, 0);
});

Deno.test("vessels reject impossible wall, drain, shell, and component dimensions", () => {
  for (
    const action of [
      () => basin({ wallThickness: .6 }),
      () => basin({ bottomThickness: .5 }),
      () => basin({ taper: .49 }),
      () => basin({ drainRadius: .48 }),
      () => basin({ rimWidth: .1 }),
      () => basin({ cornerRadius: 1, shape: "rectangular" }),
      () => basin({ height: NaN }),
      () => bowl({ wallThickness: .3 }),
      () => cup({ handleThickness: .3 }),
      () => bottle({ neckHeight: 1 }),
      () => vase({ neckRadius: .01 }),
      () => urn({ footRadius: 1 }),
      () => pedestal({ baseHeight: .8 }),
      () => knob({ stemHeight: 1 }),
      () => dome({ thickness: 1 }),
      () => hemisphere({ radius: -1 }),
      () => cone({ thickness: 1 }),
      () => funnel({ neckRadius: .01 }),
      () => canopy({ thickness: 1 }),
      () => basin({ segments: 3 }),
    ]
  ) assertThrows(action, RangeError);
});
