import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import * as THREE from "three";
import type { GeneratedGroom } from "../src/hair/groom-data.ts";
import {
  type AmbientGroomVisibility,
  buildAmbientGroomVisibility,
  buildDirectionalGroomShadow,
  type DirectionalGroomShadow,
  type GroomVolume,
  voxelizeGroom,
} from "../src/hair/groom-volume-data.ts";

const identity = new THREE.Matrix4().elements;
type Fiber = { points: THREE.Vector3Tuple[]; radii: number[] };

function generated(fibers: Fiber[]): GeneratedGroom {
  return {
    version: 1,
    seed: 71,
    source: {
      version: 1,
      seed: 71,
      layers: [{ id: "coat", children: 1, radius: .01 }],
      guides: [{
        id: "guide",
        layer: "coat",
        points: [[0, 0, 0], [1, 0, 0]],
        width: .1,
      }],
    },
    strands: fibers.map((fiber, i) => ({
      ...fiber,
      id: `fiber-${i}`,
      guideId: "guide",
      layer: "coat",
      shade: 1,
      guideT: fiber.points.map((_, i) => i / (fiber.points.length - 1)),
    })),
  };
}

function slab(layers = [-.2, .2], radius = .004, copies = 1): GeneratedGroom {
  const fibers: Fiber[] = [];
  for (let c = 0; c < copies; c++) {
    for (const z of layers) {
      for (let y = 0; y < 48; y++) {
        fibers.push({
          points: [[-.5, (y + .5) / 48 - .5, z], [.5, (y + .5) / 48 - .5, z]],
          radii: [radius, radius],
        });
      }
    }
  }
  return generated(fibers);
}

/** Same normalized linear sampler/decoding as an RG16 Data3DTexture. */
function tau(map: DirectionalGroomShadow, world: THREE.Vector3Tuple) {
  const p = new THREE.Vector3(...world).applyMatrix4(
    new THREE.Matrix4().fromArray(map.worldToTexture),
  );
  if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1 || p.z < 0) return 0;
  const n = map.resolution;
  const coordinates = [p.x, p.y, Math.min(1, p.z)].map((v) => v * n - .5);
  const floor = coordinates.map(Math.floor),
    fraction = coordinates.map((v, k) => v - floor[k]);
  let depth = 0;
  for (let z = 0; z < 2; z++) {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const indices = [x, y, z].map((v, k) =>
          Math.max(0, Math.min(n - 1, floor[k] + v))
        );
        const at = (indices[0] + n * (indices[1] + n * indices[2])) * 4;
        const sample = (map.data[at] + map.data[at + 1] * 256) *
          map.maxOpticalDepth / 65535;
        depth += sample * (x ? fraction[0] : 1 - fraction[0]) *
          (y ? fraction[1] : 1 - fraction[1]) *
          (z ? fraction[2] : 1 - fraction[2]);
      }
    }
  }
  return depth;
}

function shadow(
  volume: GroomVolume,
  direction: THREE.Vector3Tuple = [0, 0, 1],
  matrixWorld: readonly number[] = identity,
) {
  return buildDirectionalGroomShadow([{ volume, matrixWorld }], direction, {
    resolution: 48,
  });
}

/** Match linear, clamp-to-edge RGBA8 sampling used by the ambient renderer. */
function ambientDirections(
  map: AmbientGroomVisibility,
  world: THREE.Vector3Tuple,
) {
  const p = new THREE.Vector3(...world).applyMatrix4(
    new THREE.Matrix4().fromArray(map.worldToTexture),
  ).toArray();
  if (p.some((coordinate) => coordinate < 0 || coordinate > 1)) {
    return { positive: [1, 1, 1], negative: [1, 1, 1] };
  }
  const n = map.resolution;
  const cell = p.map((v) => v * n - .5);
  const floor = cell.map(Math.floor),
    fraction = cell.map((v, k) => v - floor[k]);
  const positive = [0, 0, 0], negative = [0, 0, 0];
  for (let z = 0; z < 2; z++) {
    for (let y = 0; y < 2; y++) {
      for (let x = 0; x < 2; x++) {
        const indices = [x, y, z].map((v, k) =>
          Math.max(0, Math.min(n - 1, floor[k] + v))
        );
        const at = (indices[0] + n * (indices[1] + n * indices[2])) * 4;
        const weight = (x ? fraction[0] : 1 - fraction[0]) *
          (y ? fraction[1] : 1 - fraction[1]) *
          (z ? fraction[2] : 1 - fraction[2]) / 255;
        for (let k = 0; k < 3; k++) {
          positive[k] += map.positiveData[at + k] * weight;
          negative[k] += map.negativeData[at + k] * weight;
        }
      }
    }
  }
  return { positive, negative };
}

function ambient(
  volume: GroomVolume,
  distance = .4,
  matrixWorld: readonly number[] = identity,
) {
  return buildAmbientGroomVisibility([{ volume, matrixWorld }], {
    resolution: 48,
    distance,
  });
}

Deno.test("fiber voxelization conserves integrated tapered radius, length and orientation moments", () => {
  const input = generated([
    { points: [[0, 0, 0], [1, 0, 0]], radii: [.02, .01] },
    { points: [[0, 0, 0], [0, 2, 0]], radii: [.03, .03] },
    { points: [[-.2, .2, -.1], [.3, .7, .4]], radii: [.005, .001] },
  ]);
  const before = structuredClone(input);
  const volume = voxelizeGroom(input, { resolution: 32 });
  const expected = .03 + .12 + .006 * Math.sqrt(.75);
  assertAlmostEquals(volume.statistics.sourceMass, expected, 1e-12);
  assertAlmostEquals(volume.statistics.storedMass, expected, 1e-8);
  assertEquals(input, before);
  assert(volume.indices.length > 0 && volume.indices.length < 32 ** 3 / 8);
  for (let i = 0; i < volume.indices.length; i++) {
    const at = i * 6;
    assertAlmostEquals(
      volume.moments[at] + volume.moments[at + 1] + volume.moments[at + 2],
      volume.mass[i],
      1e-8,
    );
    if (i) assert(volume.indices[i] > volume.indices[i - 1]);
  }
  const reordered = structuredClone(input);
  reordered.strands.reverse();
  const repeat = voxelizeGroom(reordered, { resolution: 32 });
  assertEquals(volume.indices, repeat.indices);
  assertEquals(volume.mass, repeat.mass);
  assertEquals(volume.moments, repeat.moments);
});

Deno.test("Beer transmittance responds to slab thickness, density and fiber radius", () => {
  const make = (layers: number[], radius = .004, copies = 1) =>
    shadow(voxelizeGroom(slab(layers, radius, copies), { resolution: 48 }));
  const single = make([-.2]);
  const thick = make([-.2, .2]);
  const dense = make([-.2], .004, 2);
  const wide = make([-.2], .008);
  const point: THREE.Vector3Tuple = [0, 0, -2];
  const a = tau(single, point),
    b = tau(thick, point),
    c = tau(dense, point),
    d = tau(wide, point);
  assert(a > .15 && a < 1);
  assertAlmostEquals(b, a * 2, .002);
  assertAlmostEquals(c, a * 2, .002);
  assertAlmostEquals(d, a * 2, .03);
  assertAlmostEquals(Math.exp(-c), Math.exp(-a) ** 2, .001);
  assert(Math.exp(-b) < Math.exp(-a));
  assertEquals(
    tau(thick, [0, 0, 2]),
    0,
    "Receivers before the volume remain unoccluded",
  );
  assertAlmostEquals(
    thick.statistics.projectedMass,
    thick.statistics.storedProjectedMass,
    1e-7,
  );
  assertAlmostEquals(thick.statistics.projectedMass, .008 * 48 * 2, 1e-7);
});

Deno.test("light reversal integrates from the opposite side and the last slice keeps the complete column", () => {
  const volume = voxelizeGroom(slab([-.2, .2, .2, .2]), { resolution: 48 });
  const front = shadow(volume, [0, 0, 1]), back = shadow(volume, [0, 0, -1]);
  assert(tau(front, [0, 0, 0]) > tau(back, [0, 0, 0]) * 2.5);
  assertAlmostEquals(tau(front, [0, 0, -2]), tau(back, [0, 0, 2]), .001);
  assertEquals(front.direction, [0, 0, 1]);
  const n = front.resolution, x = Math.floor(n / 2), y = Math.floor(n / 2);
  let previous = 0;
  for (let z = 0; z < n; z++) {
    const at = (x + n * (y + n * z)) * 4;
    const value = front.data[at] + front.data[at + 1] * 256;
    assert(value >= previous);
    previous = value;
  }
  const last = (x + n * (y + n * (n - 1))) * 4;
  const penultimate = last - n * n * 4;
  assertEquals(
    front.data.subarray(last, last + 4),
    front.data.subarray(penultimate, penultimate + 4),
  );
});

Deno.test("aligned fibers extinguish transverse rays and retain the documented second-moment approximation", () => {
  const volume = voxelizeGroom(
    generated([{ points: [[-.5, 0, 0], [.5, 0, 0]], radii: [.01, .01] }]),
    { resolution: 16 },
  );
  const axial = shadow(volume, [1, 0, 0]);
  const side = shadow(volume, [0, 1, 0]);
  assertEquals(axial.statistics.projectedMass, 0);
  assert(side.statistics.projectedMass > .0199);
  const mixed: GroomVolume = {
    ...volume,
    indices: new Uint32Array([8 + 16 * (8 + 16 * 8)]),
    mass: new Float32Array([2]),
    moments: new Float32Array([1, 1, 0, 0, 0, 0]),
  };
  const map = shadow(mixed, [1, 0, 0]);
  assertAlmostEquals(map.statistics.projectedMass, Math.SQRT2, 1e-12);
  // E[|t×L|] would instead give 1 for these two equally weighted directions.
  assert(map.statistics.projectedMass > 1);
});

Deno.test("translated, rotated and uniformly scaled instances preserve Beer attenuation", () => {
  const volume = voxelizeGroom(slab(), { resolution: 32 });
  const base = shadow(volume);
  const rotation = new THREE.Quaternion().setFromEuler(
    new THREE.Euler(.3, .6, -.2),
  );
  const matrix = new THREE.Matrix4().compose(
    new THREE.Vector3(3, -2, 4),
    rotation,
    new THREE.Vector3(2, 2, 2),
  );
  const light = new THREE.Vector3(0, 0, 1).applyQuaternion(rotation).toArray();
  const transformed = shadow(volume, light, matrix.elements);
  const p = new THREE.Vector3(0, 0, -2).applyMatrix4(matrix).toArray();
  assertAlmostEquals(tau(transformed, p), tau(base, [0, 0, -2]), .06);
  assertAlmostEquals(
    transformed.statistics.projectedMass,
    base.statistics.projectedMass * 4,
    1e-6,
  );
  const scaleOnly = shadow(
    volume,
    [0, 0, 1],
    new THREE.Matrix4().makeScale(2, 2, 2).elements,
  );
  assertEquals(scaleOnly.data, base.data);
});

Deno.test("nonuniform affine instance area matches an equivalent transformed density grid", () => {
  const volume = voxelizeGroom(slab(), { resolution: 32 });
  // X-directed fibers: transverse Y/Z radius scales equally by2; length by3.
  const scales: THREE.Vector3Tuple = [3, 2, 2];
  const transformed = shadow(
    volume,
    [0, 0, 1],
    new THREE.Matrix4().makeScale(...scales).elements,
  );
  const equivalent: GroomVolume = {
    ...volume,
    bounds: {
      min: volume.bounds.min.map((value, k) =>
        value * scales[k]
      ) as THREE.Vector3Tuple,
      max: volume.bounds.max.map((value, k) =>
        value * scales[k]
      ) as THREE.Vector3Tuple,
    },
    voxelSize: volume.voxelSize.map((value, k) =>
      value * scales[k]
    ) as THREE.Vector3Tuple,
    mass: volume.mass.map((value) => value * 6),
    moments: volume.moments.map((value) => value * 6),
  };
  const direct = shadow(equivalent);
  assertAlmostEquals(
    transformed.statistics.projectedMass,
    direct.statistics.projectedMass,
    1e-6,
  );
  assertAlmostEquals(
    tau(transformed, [0, 0, -4]),
    tau(direct, [0, 0, -4]),
    .001,
  );
  const mirrored = shadow(
    volume,
    [0, 0, 1],
    new THREE.Matrix4().makeScale(-3, 2, 2).elements,
  );
  assertAlmostEquals(
    tau(mirrored, [0, 0, -4]),
    tau(transformed, [0, 0, -4]),
    .001,
  );
});

Deno.test("sparse boundary fibers conserve mass, empty fields transmit and overlapping instances add depth", () => {
  const volume = voxelizeGroom(
    generated([
      { points: [[0, 0, 0], [1, 1, 1]], radii: [.01, 0] },
      { points: [[-1, 1, -.2], [1, -1, .2]], radii: [.005, .005] },
    ]),
    { resolution: 16 },
  );
  assertAlmostEquals(
    volume.statistics.sourceMass,
    volume.statistics.storedMass,
    1e-8,
  );
  const one = shadow(volume);
  const two = buildDirectionalGroomShadow(
    [{ volume, matrixWorld: identity }, { volume, matrixWorld: identity }],
    [0, 0, 1],
    { resolution: 48 },
  );
  assertAlmostEquals(
    two.statistics.projectedMass,
    one.statistics.projectedMass * 2,
    1e-10,
  );
  assertAlmostEquals(tau(two, [0, 0, -2]), tau(one, [0, 0, -2]) * 2, .001);
  const empty = voxelizeGroom(generated([]), { resolution: 16 });
  assertEquals(empty.indices.length, 0);
  for (
    const map of [
      shadow(empty),
      buildDirectionalGroomShadow([], [0, 1, 0], { resolution: 16 }),
    ]
  ) {
    assertEquals(map.statistics.projectedMass, 0);
    assertEquals(map.statistics.maximumUnclampedDepth, 0);
    for (let i = 0; i < map.data.length; i += 4) {
      assertEquals([...map.data.subarray(i, i + 4)], [0, 0, 0, 255]);
    }
  }
});

Deno.test("volume allocation, work, matrix and malformed sparse data are bounded", () => {
  const input = slab([0]);
  assertThrows(() => voxelizeGroom(input, { resolution: 15 }), RangeError);
  assertThrows(() => voxelizeGroom(input, { resolution: 129 }), RangeError);
  assertThrows(() => voxelizeGroom(input, { maxBytes: 100 }), RangeError);
  const badRadius = structuredClone(input);
  badRadius.strands[0].radii[0] = NaN;
  assertThrows(() => voxelizeGroom(badRadius), RangeError);
  const duplicate = structuredClone(input);
  duplicate.strands[1].id = duplicate.strands[0].id;
  assertThrows(() => voxelizeGroom(duplicate), RangeError);
  const busy = generated(
    Array.from(
      { length: 70_000 },
      (): Fiber => ({
        points: [[0, 0, 0], [1, 1, 1]],
        radii: [.00001, .00001],
      }),
    ),
  );
  assertThrows(
    () => voxelizeGroom(busy, { resolution: 128 }),
    RangeError,
    "quadrature",
  );
  const volume = voxelizeGroom(input, { resolution: 16 });
  assertThrows(
    () =>
      buildDirectionalGroomShadow([{ volume, matrixWorld: identity }], [
        0,
        0,
        0,
      ]),
    RangeError,
  );
  assertThrows(
    () =>
      buildDirectionalGroomShadow([{ volume, matrixWorld: identity }], [
        0,
        1,
        0,
      ], { resolution: 193 }),
    RangeError,
  );
  assertThrows(
    () =>
      shadow(
        volume,
        [0, 0, 1],
        new THREE.Matrix4().makeScale(0, 1, 1).elements,
      ),
    RangeError,
  );
  const perspective = [...identity];
  perspective[3] = .1;
  assertThrows(() => shadow(volume, [0, 0, 1], perspective), RangeError);
  assertThrows(
    () =>
      shadow(
        volume,
        [0, 0, 1],
        new THREE.Matrix4().makeTranslation(1e308, 0, 0).elements,
      ),
    RangeError,
  );
  const bad = { ...volume, moments: volume.moments.slice() };
  bad.moments[0] = -1;
  assertThrows(() => shadow(bad), RangeError);
  const badIndices = { ...volume, indices: volume.indices.slice() };
  badIndices.indices[0] = 16 ** 3;
  assertThrows(() => shadow(badIndices), RangeError);
});

Deno.test("ambient density conserves each projected area and finite Beer attenuation follows density, thickness and radius", () => {
  const make = (layers = [0], radius = .004, copies = 1) =>
    ambient(voxelizeGroom(slab(layers, radius, copies), { resolution: 48 }));
  const thin = make(), dense = make([0], .004, 2);
  const thick = make([0, .04]), wide = make([0], .008);
  const p: THREE.Vector3Tuple = [0, 0, -.08];
  const value = ambientDirections(thin, p).positive[2];
  const doubled = ambientDirections(dense, p).positive[2];
  // An X-aligned sheet has transverse optical depth 2r * 48. The local
  // triangular kernel weights its distance .08 by (1-.08/.4).
  assertAlmostEquals(value, Math.exp(-.008 * 48 * .8), .025);
  assertAlmostEquals(doubled, value ** 2, .006);
  assert(ambientDirections(thick, p).positive[2] < value - .1);
  assertAlmostEquals(ambientDirections(wide, p).positive[2], doubled, .02);
  assertAlmostEquals(ambientDirections(thin, p).positive[0], 1, 1e-12);
  assertAlmostEquals(ambientDirections(thin, p).negative[0], 1, 1e-12);
  assertAlmostEquals(thin.statistics.projectedMass[0], 0, 1e-12);
  for (const axis of [1, 2]) {
    assertAlmostEquals(thin.statistics.projectedMass[axis], .008 * 48, 1e-7);
  }
  for (const map of [thin, dense, thick, wide]) {
    for (let axis = 0; axis < 3; axis++) {
      assertAlmostEquals(
        map.statistics.storedProjectedMass[axis],
        map.statistics.projectedMass[axis],
        1e-7,
      );
    }
    assertEquals(map.statistics.bytes, 48 ** 3 * 8);
    assertEquals(map.statistics.peakBytes, 48 ** 3 * 20 + 49 * 16);
  }
});

Deno.test("ambient falloff reverses by direction, reaches receivers outside source bounds and becomes clear beyond its local reach", () => {
  const volume = voxelizeGroom(slab([-.45, .45]), { resolution: 48 });
  const map = ambient(volume, .2);
  const below: THREE.Vector3Tuple = [0, 0, volume.bounds.min[2] - .02];
  const near = ambientDirections(map, below);
  assert(
    near.positive[2] < .9,
    "Nearby density must reach below its source cube",
  );
  assertAlmostEquals(near.negative[2], 1, 1e-12);
  const above = ambientDirections(map, [0, 0, -below[2]]);
  assertAlmostEquals(above.negative[2], near.positive[2], .002);
  assertAlmostEquals(above.positive[2], 1, 1e-12);
  for (
    const point of [[0, 0, -.8], [0, 0, .8], [
      2,
      0,
      -.55,
    ]] as THREE.Vector3Tuple[]
  ) {
    const clear = ambientDirections(map, point);
    for (const value of [...clear.positive, ...clear.negative]) {
      assertAlmostEquals(value, 1, 1e-12);
    }
  }
  const sheet = ambient(voxelizeGroom(slab([0]), { resolution: 48 }));
  const nearSheet = ambientDirections(sheet, [0, 0, -.04]).positive[2];
  const middle = ambientDirections(sheet, [0, 0, -.2]).positive[2];
  const far = ambientDirections(sheet, [0, 0, -.6]).positive[2];
  assert(nearSheet < middle && middle < far);
  assertAlmostEquals(far, 1, 1e-12);
});

Deno.test("ambient half-cell paths remain symmetric, small distances vanish and empty fields are fully visible", () => {
  const volume = voxelizeGroom(slab([0]), { resolution: 48 });
  const symmetric = ambientDirections(ambient(volume), [0, 0, 0]);
  assertAlmostEquals(symmetric.positive[2], symmetric.negative[2], .001);
  assert(symmetric.positive[2] < .9 && symmetric.positive[2] > .7);
  const short = ambientDirections(ambient(volume, 1e-10), [0, 0, 0]);
  for (const value of [...short.positive, ...short.negative]) {
    assertAlmostEquals(value, 1, 1e-12);
  }
  const empty = voxelizeGroom(generated([]), { resolution: 16 });
  for (
    const map of [
      ambient(empty),
      buildAmbientGroomVisibility([], { resolution: 16 }),
    ]
  ) {
    assertEquals(map.statistics.activeVoxels, 0);
    assertEquals(map.statistics.maximumOpticalDepth, [0, 0, 0]);
    assert(map.positiveData.every((value) => value === 255));
    assert(map.negativeData.every((value) => value === 255));
  }
});

Deno.test("ambient field is deterministic and affine instances transform orientation, area and distance", () => {
  const input = slab([-.15, .15]);
  const volume = voxelizeGroom(input, { resolution: 32 });
  const base = buildAmbientGroomVisibility([{ volume, matrixWorld: identity }]);
  assertEquals(base.resolution, 64);
  assertAlmostEquals(
    base.distance,
    Math.max(...volume.voxelSize) * volume.resolution * .12,
    1e-12,
  );
  const reversed = { ...input, strands: [...input.strands].reverse() };
  const repeated = buildAmbientGroomVisibility([{
    volume: voxelizeGroom(reversed, { resolution: 32 }),
    matrixWorld: identity,
  }]);
  assertEquals(repeated.positiveData, base.positiveData);
  assertEquals(repeated.negativeData, base.negativeData);
  const uniform = new THREE.Matrix4().makeScale(2, 2, 2).setPosition(3, -2, 4);
  const scaled = buildAmbientGroomVisibility([{
    volume,
    matrixWorld: uniform.elements,
  }]);
  assertAlmostEquals(scaled.distance, base.distance * 2, 1e-12);
  assertEquals(scaled.positiveData, base.positiveData);
  assertEquals(scaled.negativeData, base.negativeData);
  const p: THREE.Vector3Tuple = [0, 0, -.18];
  const rotation = new THREE.Matrix4().makeRotationZ(Math.PI / 2);
  const rotated = ambient(volume, .4, rotation.elements);
  const original = ambient(volume);
  const directions = ambientDirections(
    rotated,
    new THREE.Vector3(...p).applyMatrix4(rotation).toArray(),
  );
  const before = ambientDirections(original, p);
  assertAlmostEquals(directions.positive[1], before.positive[0], .001);
  assertAlmostEquals(directions.positive[2], before.positive[2], .001);
  assertAlmostEquals(rotated.statistics.projectedMass[1], 0, 1e-12);
  assert(rotated.statistics.projectedMass[0] > 0);

  const scales: THREE.Vector3Tuple = [3, 2, 2];
  const nonuniform = ambient(
    volume,
    .8,
    new THREE.Matrix4().makeScale(...scales).elements,
  );
  const equivalent: GroomVolume = {
    ...volume,
    bounds: {
      min: volume.bounds.min.map((value, k) =>
        value * scales[k]
      ) as THREE.Vector3Tuple,
      max: volume.bounds.max.map((value, k) =>
        value * scales[k]
      ) as THREE.Vector3Tuple,
    },
    voxelSize: volume.voxelSize.map((value, k) =>
      value * scales[k]
    ) as THREE.Vector3Tuple,
    mass: volume.mass.map((value) => value * 6),
    moments: volume.moments.map((value) => value * 6),
  };
  const direct = ambient(equivalent, .8);
  for (let axis = 0; axis < 3; axis++) {
    assertAlmostEquals(
      nonuniform.statistics.projectedMass[axis],
      direct.statistics.projectedMass[axis],
      1e-6,
    );
    assertAlmostEquals(
      ambientDirections(nonuniform, [0, 0, -.36]).positive[axis],
      ambientDirections(direct, [0, 0, -.36]).positive[axis],
      .004,
    );
  }
});

Deno.test("ambient allocations, finite reach, malformed fields and projection work are bounded", () => {
  const volume = voxelizeGroom(slab([0]), { resolution: 16 });
  const instances = [{ volume, matrixWorld: identity }];
  for (const resolution of [15, 97, NaN, 32.5]) {
    assertThrows(
      () => buildAmbientGroomVisibility(instances, { resolution }),
      RangeError,
    );
  }
  for (const distance of [0, -1, NaN, Infinity]) {
    assertThrows(
      () => buildAmbientGroomVisibility(instances, { distance }),
      RangeError,
    );
  }
  assertThrows(
    () => buildAmbientGroomVisibility(instances, { maxBytes: 1 }),
    RangeError,
    "maxBytes",
  );
  assertThrows(
    () => buildAmbientGroomVisibility(Array(65).fill(instances[0])),
    RangeError,
    "64 instances",
  );
  assertThrows(
    () => ambient(volume, .2, new THREE.Matrix4().makeScale(0, 1, 1).elements),
    RangeError,
  );
  assertThrows(
    () =>
      ambient(
        volume,
        .2,
        new THREE.Matrix4().makeTranslation(1e308, 0, 0).elements,
      ),
    RangeError,
  );
  const bad = { ...volume, moments: volume.moments.slice() };
  bad.moments[0] = -1;
  assertThrows(() => ambient(bad), RangeError);
  const many = 45_000;
  const dense: GroomVolume = {
    ...volume,
    resolution: 64,
    voxelSize: volume.voxelSize.map((value) => value / 4) as THREE.Vector3Tuple,
    indices: Uint32Array.from({ length: many }, (_, i) => i),
    mass: new Float32Array(many).fill(1),
    moments: Float32Array.from({ length: many * 6 }, (_, i) => i % 6 ? 0 : 1),
  };
  assertThrows(
    () =>
      buildAmbientGroomVisibility(
        Array(64).fill({ volume: dense, matrixWorld: identity }),
      ),
    RangeError,
    "cardinal-axis projections",
  );
});
