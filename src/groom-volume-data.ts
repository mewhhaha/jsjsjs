/** Static full-fiber density and directional optical-depth fields, without a DOM. */
import * as THREE from "three";
import type { GeneratedGroom, GroomXYZ } from "./groom-data.ts";

export interface GroomVolumeOptions {
  /** Cubic grid resolution, 16–128. Default 64. */
  resolution?: number;
  /** Dense workspace plus worst-case sparse output, default 128 MiB. */
  maxBytes?: number;
}

export interface GroomVolume {
  version: 1;
  resolution: number;
  bounds: { min: GroomXYZ; max: GroomXYZ };
  voxelSize: GroomXYZ;
  /** Sorted sparse voxel indices: x + resolution * (y + resolution * z). */
  indices: Uint32Array;
  /** Integrated geometric extinction area, sum(2 * radius * segment length). */
  mass: Float32Array;
  /** Six mass-weighted orientation moments per voxel: xx, yy, zz, xy, xz, yz. */
  moments: Float32Array;
  statistics: {
    fibers: number;
    segments: number;
    quadratureSamples: number;
    activeVoxels: number;
    sourceMass: number;
    storedMass: number;
    bytes: number;
    /** Conservative typed-buffer bound, including a fully occupied sparse output. */
    peakBytes: number;
  };
}

export interface GroomVolumeInstance {
  volume: GroomVolume;
  /** Affine local-to-world matrix in Three's column-major element order. */
  matrixWorld: readonly number[];
}

export interface DirectionalGroomShadowOptions {
  /** Cubic optical-depth texture resolution, 16–192. Default 96. */
  resolution?: number;
}

export interface DirectionalGroomShadow {
  resolution: number;
  /** RG encode low/high bytes of 16-bit optical depth. B=0, A=255. */
  data: Uint8Array;
  /** Column-major transform. Texture Z increases away from the light. */
  worldToTexture: number[];
  /** Unit world-space direction from the receiver toward the light. */
  direction: GroomXYZ;
  /** Decode normalized RG as (r + 256*g) * (maxOpticalDepth / 257). */
  maxOpticalDepth: number;
  statistics: {
    instances: number;
    activeVoxels: number;
    projectedMass: number;
    storedProjectedMass: number;
    coveredColumns: number;
    saturatedVoxels: number;
    maximumUnclampedDepth: number;
    bytes: number;
    peakBytes: number;
  };
}

export interface AmbientGroomVisibilityOptions {
  /** World-aligned cubic grid resolution, 16–96. Default 64. */
  resolution?: number;
  /** Positive world-unit reach; default 0.12 times the transformed source extent. */
  distance?: number;
  /** Dense optical-depth workspace and output textures, default 32 MiB. */
  maxBytes?: number;
}

export interface AmbientGroomVisibility {
  resolution: number;
  distance: number;
  /** RGB store Beer transmittance toward +X, +Y, +Z; A=255. */
  positiveData: Uint8Array;
  /** RGB store Beer transmittance toward -X, -Y, -Z; A=255. */
  negativeData: Uint8Array;
  /** Column-major world-to-texture transform. Outside the cube is unoccluded. */
  worldToTexture: number[];
  statistics: {
    instances: number;
    activeVoxels: number;
    /** Three cardinal axes per active source voxel; at most eight million. */
    axisProjections: number;
    /** Integrated extinction area before the finite-distance kernel, by X/Y/Z. */
    projectedMass: GroomXYZ;
    storedProjectedMass: GroomXYZ;
    /** Largest distance-weighted optical depth in either direction, by X/Y/Z. */
    maximumOpticalDepth: GroomXYZ;
    bytes: number;
    peakBytes: number;
  };
}

const MAX_POINTS = 4_000_000;
const MAX_SAMPLES = 16_000_000;
const MAX_PROJECTED_VOXELS = 8_000_000;
const MAX_OPTICAL_DEPTH = 16;
const clamp = (n: number, a = 0, b = 1) => Math.max(a, Math.min(b, n));
const dot = (a: GroomXYZ, b: GroomXYZ) =>
  a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

function integer(value: number, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer in [${min},${max}]`);
  }
  return value;
}

function finiteVector(
  value: unknown,
  label: string,
): asserts value is GroomXYZ {
  if (
    !Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite)
  ) {
    throw new TypeError(`${label} must contain three finite numbers`);
  }
}

function unit(value: GroomXYZ, label: string): GroomXYZ {
  finiteVector(value, label);
  const length = Math.hypot(...value);
  if (!Number.isFinite(length) || length < 1e-15) {
    throw new RangeError(`${label} must be nonzero`);
  }
  return value.map((n) => n / length) as GroomXYZ;
}

function cross(a: GroomXYZ, b: GroomXYZ): GroomXYZ {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Clamping neighboring cells keeps all mass even at a boundary. */
function neighbors(x: number, y: number, z: number, n: number) {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = x - ix, fy = y - iy, fz = z - iz;
  return {
    x: [clamp(ix, 0, n - 1), clamp(ix + 1, 0, n - 1)],
    y: [clamp(iy, 0, n - 1), clamp(iy + 1, 0, n - 1)],
    z: [clamp(iz, 0, n - 1), clamp(iz + 1, 0, n - 1)],
    wx: [1 - fx, fx],
    wy: [1 - fy, fy],
    wz: [1 - fz, fz],
  };
}

/**
 * Voxelize every supplied fiber, independently of its display LOD. Midpoint
 * quadrature samples at most half a voxel apart, integrating linear radii
 * exactly before conservative trilinear splatting. Orientation moments store
 * geometric projected area; this is extinction, not an artist darkness mask.
 */
export function voxelizeGroom(
  generated: GeneratedGroom,
  options: GroomVolumeOptions = {},
): GroomVolume {
  const resolution = integer(
    options.resolution ?? 64,
    16,
    128,
    "volume resolution",
  );
  const maxBytes = integer(
    options.maxBytes ?? 128 * 1024 * 1024,
    1,
    512 * 1024 * 1024,
    "maxBytes",
  );
  if (
    generated?.version !== 1 || generated.source?.version !== 1 ||
    !Array.isArray(generated.strands) || generated.strands.length > 200_000
  ) {
    throw new TypeError(
      "voxelizeGroom requires a version 1 generated groom with at most 200000 fibers",
    );
  }
  const cells = resolution ** 3;
  // Seven dense floats, then an index and seven floats per occupied cell.
  const peakBytes = cells * (28 + 32) + generated.strands.length * 8;
  if (peakBytes > maxBytes) {
    throw new RangeError(
      `Groom voxelization needs up to ${peakBytes} bytes, above maxBytes`,
    );
  }
  const low: GroomXYZ = [Infinity, Infinity, Infinity];
  const high: GroomXYZ = [-Infinity, -Infinity, -Infinity];
  let points = 0, segments = 0, sourceMass = 0;
  const ids = new Set<string>();
  for (const fiber of generated.strands) {
    if (typeof fiber.id !== "string" || !fiber.id || ids.has(fiber.id)) {
      throw new RangeError("Volume fibers need unique nonempty IDs");
    }
    ids.add(fiber.id);
    if (
      !Array.isArray(fiber.points) || fiber.points.length < 2 ||
      fiber.points.length > 257 || !Array.isArray(fiber.radii) ||
      fiber.radii.length !== fiber.points.length
    ) {
      throw new RangeError(
        "Volume fibers need 2–257 points with matching radii",
      );
    }
    points += fiber.points.length;
    if (points > MAX_POINTS) {
      throw new RangeError("Groom voxelization exceeds 4000000 fiber points");
    }
    for (let i = 0; i < fiber.points.length; i++) {
      const p = fiber.points[i], r = fiber.radii[i];
      finiteVector(p, "Fiber point");
      if (
        p.some((value) => Math.abs(value) > 1e12) || !Number.isFinite(r) ||
        r < 0 || r > 1e12
      ) {
        throw new RangeError(
          "Fiber coordinates/radii exceed the finite 1e12 model-unit limit",
        );
      }
      for (let k = 0; k < 3; k++) {
        low[k] = Math.min(low[k], p[k] - r);
        high[k] = Math.max(high[k], p[k] + r);
      }
      if (i) {
        const previous = fiber.points[i - 1];
        const length = Math.hypot(
          p[0] - previous[0],
          p[1] - previous[1],
          p[2] - previous[2],
        );
        if (!(length > 0)) {
          throw new RangeError(
            "Consecutive volume fiber points must be distinct",
          );
        }
        sourceMass += (fiber.radii[i - 1] + r) * length;
        segments++;
      }
    }
  }
  if (!generated.strands.length) {
    low.fill(-.5);
    high.fill(.5);
  }
  const center = low.map((value, k) => (value + high[k]) * .5) as GroomXYZ;
  const extent = Math.max(...high.map((value, k) => value - low[k]));
  // One cell of padding on every side; also avoid coordinates below machine precision.
  const minimumExtent = Math.max(
    1e-12,
    ...center.map((value) => Math.abs(value) * Number.EPSILON * resolution * 8),
  );
  const edge = Math.max(extent, minimumExtent) * resolution / (resolution - 2);
  const min = center.map((value) => value - edge * .5) as GroomXYZ;
  const max = center.map((value) => value + edge * .5) as GroomXYZ;
  const size = edge / resolution;
  let samples = 0;
  for (const fiber of generated.strands) {
    for (let i = 1; i < fiber.points.length; i++) {
      if (fiber.radii[i - 1] + fiber.radii[i] === 0) continue;
      const a = fiber.points[i - 1], b = fiber.points[i];
      samples += Math.max(
        1,
        Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) / size * 2),
      );
      if (samples > MAX_SAMPLES) {
        throw new RangeError(
          "Groom voxelization exceeds 16000000 quadrature samples; reduce resolution or source sampling",
        );
      }
    }
  }
  const dense = new Float32Array(cells * 7);
  // Stable summation order makes reordering source fibers harmless.
  const fibers = [...generated.strands].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0
  );
  for (const fiber of fibers) {
    for (let i = 1; i < fiber.points.length; i++) {
      const ra = fiber.radii[i - 1], rb = fiber.radii[i];
      if (ra + rb === 0) continue;
      const a = fiber.points[i - 1], b = fiber.points[i];
      const dx = b[0] - a[0], dy = b[1] - a[1], dz = b[2] - a[2];
      const length = Math.hypot(dx, dy, dz);
      const count = Math.max(1, Math.ceil(length / size * 2));
      const tx = dx / length, ty = dy / length, tz = dz / length;
      const tensor = [tx * tx, ty * ty, tz * tz, tx * ty, tx * tz, ty * tz];
      for (let j = 0; j < count; j++) {
        const t = (j + .5) / count;
        const mass = 2 * (ra + (rb - ra) * t) * length / count;
        const cell = neighbors(
          (a[0] + dx * t - min[0]) / size - .5,
          (a[1] + dy * t - min[1]) / size - .5,
          (a[2] + dz * t - min[2]) / size - .5,
          resolution,
        );
        for (let z = 0; z < 2; z++) {
          for (let y = 0; y < 2; y++) {
            for (let x = 0; x < 2; x++) {
              const weight = mass * cell.wx[x] * cell.wy[y] * cell.wz[z];
              if (weight === 0) continue;
              const at = (cell.x[x] +
                resolution * (cell.y[y] + resolution * cell.z[z])) * 7;
              dense[at] += weight;
              for (let k = 0; k < 6; k++) {
                dense[at + k + 1] += weight * tensor[k];
              }
            }
          }
        }
      }
    }
  }
  let occupied = 0;
  for (let at = 0; at < dense.length; at += 7) if (dense[at] > 0) occupied++;
  const indices = new Uint32Array(occupied);
  const mass = new Float32Array(occupied);
  const moments = new Float32Array(occupied * 6);
  let cursor = 0, storedMass = 0;
  for (let cell = 0; cell < cells; cell++) {
    const at = cell * 7;
    if (!(dense[at] > 0)) continue;
    indices[cursor] = cell;
    mass[cursor] = dense[at];
    moments.set(dense.subarray(at + 1, at + 7), cursor * 6);
    storedMass += dense[at];
    cursor++;
  }
  const bytes = indices.byteLength + mass.byteLength + moments.byteLength;
  return {
    version: 1,
    resolution,
    bounds: { min, max },
    voxelSize: [size, size, size],
    indices,
    mass,
    moments,
    statistics: {
      fibers: generated.strands.length,
      segments,
      quadratureSamples: samples,
      activeVoxels: occupied,
      sourceMass,
      storedMass,
      bytes,
      peakBytes,
    },
  };
}

function validateVolume(volume: GroomVolume) {
  if (volume?.version !== 1) {
    throw new TypeError("Directional shadows need version 1 groom volumes");
  }
  const n = integer(volume.resolution, 16, 128, "volume resolution");
  finiteVector(volume.bounds?.min, "Volume bounds.min");
  finiteVector(volume.bounds?.max, "Volume bounds.max");
  finiteVector(volume.voxelSize, "Volume voxelSize");
  for (let k = 0; k < 3; k++) {
    const extent = volume.bounds.max[k] - volume.bounds.min[k];
    if (
      !(extent > 0) || !(volume.voxelSize[k] > 0) ||
      Math.abs(volume.voxelSize[k] * n / extent - 1) > 1e-5
    ) {
      throw new RangeError(
        "Volume voxel dimensions must match positive bounds",
      );
    }
  }
  if (
    !(volume.indices instanceof Uint32Array) ||
    !(volume.mass instanceof Float32Array) ||
    !(volume.moments instanceof Float32Array) ||
    volume.indices.length > n ** 3 ||
    volume.mass.length !== volume.indices.length ||
    volume.moments.length !== volume.indices.length * 6
  ) {
    throw new RangeError(
      "Volume sparse indices, mass and six orientation moments must have matching lengths",
    );
  }
  for (let i = 0; i < volume.indices.length; i++) {
    const index = volume.indices[i], m = volume.mass[i], at = i * 6;
    if (
      index >= n ** 3 || (i && index <= volume.indices[i - 1]) ||
      !Number.isFinite(m) || !(m > 0)
    ) {
      throw new RangeError(
        "Sparse volume indices must increase, with finite positive mass",
      );
    }
    const xx = volume.moments[at] / m,
      yy = volume.moments[at + 1] / m,
      zz = volume.moments[at + 2] / m;
    const xy = volume.moments[at + 3] / m,
      xz = volume.moments[at + 4] / m,
      yz = volume.moments[at + 5] / m;
    const determinant = xx * yy * zz + 2 * xy * xz * yz - xx * yz * yz -
      yy * xz * xz - zz * xy * xy;
    if (
      ![xx, yy, zz, xy, xz, yz].every(Number.isFinite) ||
      Math.min(xx, yy, zz) < -1e-5 || Math.abs(xx + yy + zz - 1) > 1e-4 ||
      xy * xy > xx * yy + 1e-5 || xz * xz > xx * zz + 1e-5 ||
      yz * yz > yy * zz + 1e-5 || determinant < -1e-5
    ) {
      throw new RangeError(
        "Volume orientation moments must form a positive second-moment tensor with trace equal to mass",
      );
    }
  }
}

function affine(elements: readonly number[]) {
  if (
    !Array.isArray(elements) || elements.length !== 16 ||
    !elements.every(Number.isFinite) || Math.abs(elements[3]) > 1e-12 ||
    Math.abs(elements[7]) > 1e-12 || Math.abs(elements[11]) > 1e-12 ||
    Math.abs(elements[15] - 1) > 1e-12
  ) {
    throw new RangeError(
      "Groom instances need finite affine column-major 4x4 matrices",
    );
  }
  const matrix = new THREE.Matrix4().fromArray(elements);
  const determinant = matrix.determinant();
  if (!Number.isFinite(determinant) || determinant === 0) {
    throw new RangeError("Groom instance matrices must be invertible");
  }
  const inverse = matrix.clone().invert().elements;
  if (!inverse.every(Number.isFinite)) {
    throw new RangeError("Groom instance inverse must be finite");
  }
  return { elements, inverse, determinant };
}

function point(elements: readonly number[], p: GroomXYZ): GroomXYZ {
  return [
    elements[0] * p[0] + elements[4] * p[1] + elements[8] * p[2] + elements[12],
    elements[1] * p[0] + elements[5] * p[1] + elements[9] * p[2] + elements[13],
    elements[2] * p[0] + elements[6] * p[1] + elements[10] * p[2] +
    elements[14],
  ];
}

/**
 * Project integrated fiber area into a light-aligned volume and accumulate
 * optical depth away from the light. A voxel uses sqrt(1-E[(t·L)^2]) as an
 * approximation to E[|t×L|]; it is exact for aligned fibers and can overestimate
 * extinction for mixed orientations. Affine instances use local normalized
 * inv(A)*L and projected area scale |det(A)|*|inv(A)*L|.
 *
 * Sample Beer transmittance as exp(-tau). Outside XY or upstream Z means tau=0;
 * downstream Z should clamp to the far slice, which includes the whole column.
 * Two padding cells keep the first/last slices outside all splatted mass.
 */
export function buildDirectionalGroomShadow(
  instances: readonly GroomVolumeInstance[],
  direction: GroomXYZ,
  options: DirectionalGroomShadowOptions = {},
): DirectionalGroomShadow {
  const resolution = integer(
    options.resolution ?? 96,
    16,
    192,
    "shadow resolution",
  );
  const toward = unit(direction, "Light direction");
  if (!Array.isArray(instances) || instances.length > 64) {
    throw new RangeError(
      "Directional groom shadows support at most 64 instances",
    );
  }
  const away = toward.map((value) => -value) as GroomXYZ;
  const right = unit(
    cross(Math.abs(away[1]) < .95 ? [0, 1, 0] : [1, 0, 0], away),
    "Light frame",
  );
  const up = cross(away, right);
  const low: GroomXYZ = [Infinity, Infinity, Infinity],
    high: GroomXYZ = [-Infinity, -Infinity, -Infinity];
  let activeVoxels = 0;
  const validated = new Set<GroomVolume>();
  const prepared = instances.map((instance) => {
    if (!instance || !instance.volume) {
      throw new TypeError("Each groom shadow instance needs a volume");
    }
    const volume = instance.volume;
    if (!validated.has(volume)) {
      validateVolume(volume);
      validated.add(volume);
    }
    const matrix = affine(instance.matrixWorld);
    const inverse = matrix.inverse;
    const localL: GroomXYZ = [
      inverse[0] * toward[0] + inverse[4] * toward[1] + inverse[8] * toward[2],
      inverse[1] * toward[0] + inverse[5] * toward[1] + inverse[9] * toward[2],
      inverse[2] * toward[0] + inverse[6] * toward[1] + inverse[10] * toward[2],
    ];
    const localLength = Math.hypot(...localL);
    const area = Math.abs(matrix.determinant) * localLength;
    if (!Number.isFinite(area) || !(area > 0)) {
      throw new RangeError(
        "Groom instance projected area must be finite and positive",
      );
    }
    for (let k = 0; k < 3; k++) localL[k] /= localLength;
    activeVoxels += volume.indices.length;
    if (activeVoxels > MAX_PROJECTED_VOXELS) {
      throw new RangeError(
        "Directional groom shadow exceeds 8000000 active voxel projections",
      );
    }
    if (volume.indices.length) {
      for (let z = 0; z < 2; z++) {
        for (let y = 0; y < 2; y++) {
          for (let x = 0; x < 2; x++) {
            const p = point(matrix.elements, [
              volume.bounds[x ? "max" : "min"][0],
              volume.bounds[y ? "max" : "min"][1],
              volume.bounds[z ? "max" : "min"][2],
            ]);
            const light = [dot(p, right), dot(p, up), dot(p, away)];
            for (let k = 0; k < 3; k++) {
              low[k] = Math.min(low[k], light[k]);
              high[k] = Math.max(high[k], light[k]);
            }
          }
        }
      }
    }
    return { volume, matrix, localL, area };
  });
  if (!activeVoxels) {
    low.fill(-.5);
    high.fill(.5);
  }
  if (![...low, ...high].every(Number.isFinite)) {
    throw new RangeError("Transformed groom bounds must be finite");
  }
  const center = low.map((value, k) =>
    value + (high[k] - value) * .5
  ) as GroomXYZ;
  const extent = Math.max(...high.map((value, k) => value - low[k]));
  const edge = extent * resolution / (resolution - 4);
  if (!Number.isFinite(edge) || !(edge > 0)) {
    throw new RangeError("Directional groom shadow bounds must be finite");
  }
  const min = center.map((value) => value - edge * .5) as GroomXYZ;
  const size = edge / resolution;
  const voxelArea = size * size;
  if (!Number.isFinite(voxelArea) || !(voxelArea > 0)) {
    throw new RangeError(
      "Directional groom shadow voxel area must be finite and positive",
    );
  }
  const worldToTexture = new THREE.Matrix4().set(
    right[0] / edge,
    right[1] / edge,
    right[2] / edge,
    -min[0] / edge,
    up[0] / edge,
    up[1] / edge,
    up[2] / edge,
    -min[1] / edge,
    away[0] / edge,
    away[1] / edge,
    away[2] / edge,
    -min[2] / edge,
    0,
    0,
    0,
    1,
  ).elements;
  if (
    !worldToTexture.every((value) =>
      Number.isFinite(value) && Math.abs(value) <= 3e38
    )
  ) {
    throw new RangeError(
      "Directional groom texture transform must fit finite Float32 coordinates",
    );
  }
  const cells = resolution ** 3;
  const extinction = new Float32Array(cells);
  let projectedMass = 0;
  for (const { volume, matrix, localL, area } of prepared) {
    const n = volume.resolution;
    const [lx, ly, lz] = localL;
    for (let i = 0; i < volume.indices.length; i++) {
      const index = volume.indices[i],
        x = index % n,
        y = Math.floor(index / n) % n,
        z = Math.floor(index / (n * n));
      const at = i * 6, m = volume.mass[i], q = volume.moments;
      const along =
        (q[at] * lx * lx + q[at + 1] * ly * ly + q[at + 2] * lz * lz +
          2 *
            (q[at + 3] * lx * ly + q[at + 4] * lx * lz + q[at + 5] * ly * lz)) /
        m;
      const projected = m * area * Math.sqrt(Math.max(0, 1 - clamp(along)));
      if (projected === 0) continue;
      projectedMass += projected;
      const p = point(matrix.elements, [
        volume.bounds.min[0] + (x + .5) * volume.voxelSize[0],
        volume.bounds.min[1] + (y + .5) * volume.voxelSize[1],
        volume.bounds.min[2] + (z + .5) * volume.voxelSize[2],
      ]);
      const cell = neighbors(
        (dot(p, right) - min[0]) / size - .5,
        (dot(p, up) - min[1]) / size - .5,
        (dot(p, away) - min[2]) / size - .5,
        resolution,
      );
      const opticalMass = projected / voxelArea;
      if (!Number.isFinite(opticalMass) || opticalMass > 3e38) {
        throw new RangeError(
          "Directional groom extinction exceeds Float32 range",
        );
      }
      for (let iz = 0; iz < 2; iz++) {
        for (let iy = 0; iy < 2; iy++) {
          for (let ix = 0; ix < 2; ix++) {
            const weight = cell.wx[ix] * cell.wy[iy] * cell.wz[iz];
            if (weight === 0) continue;
            extinction[
              cell.x[ix] + resolution * (cell.y[iy] + resolution * cell.z[iz])
            ] += opticalMass * weight;
          }
        }
      }
    }
  }
  const data = new Uint8Array(cells * 4);
  let storedProjectedMass = 0,
    maximumUnclampedDepth = 0,
    coveredColumns = 0,
    saturatedVoxels = 0;
  for (let y = 0; y < resolution; y++) {
    for (let x = 0; x < resolution; x++) {
      let accumulated = 0;
      for (let z = 0; z < resolution; z++) {
        const cell = x + resolution * (y + resolution * z);
        const delta = extinction[cell];
        if (!Number.isFinite(delta)) {
          throw new RangeError(
            "Directional groom extinction accumulation overflowed",
          );
        }
        const opticalDepth = accumulated + delta * .5;
        accumulated += delta;
        if (opticalDepth > MAX_OPTICAL_DEPTH) saturatedVoxels++;
        const packed = Math.round(
          clamp(opticalDepth / MAX_OPTICAL_DEPTH) * 65535,
        );
        data[cell * 4] = packed & 255;
        data[cell * 4 + 1] = packed >>> 8;
        data[cell * 4 + 3] = 255;
      }
      if (accumulated > 0) coveredColumns++;
      storedProjectedMass += accumulated * voxelArea;
      maximumUnclampedDepth = Math.max(maximumUnclampedDepth, accumulated);
    }
  }
  return {
    resolution,
    data,
    worldToTexture: [...worldToTexture],
    direction: toward,
    maxOpticalDepth: MAX_OPTICAL_DEPTH,
    statistics: {
      instances: instances.length,
      activeVoxels,
      projectedMass,
      storedProjectedMass,
      coveredColumns,
      saturatedVoxels,
      maximumUnclampedDepth,
      bytes: data.byteLength,
      peakBytes: data.byteLength + extinction.byteLength,
    },
  };
}

/**
 * Approximate local ambient visibility with six cardinal paths through the full
 * groom. Each path integrates extinction weighted by max(0, 1-s/distance), then
 * stores exp(-tau). Zeroth/first prefix moments integrate that triangular kernel
 * exactly through piecewise-constant cells, including the receiver's half cell.
 * No artist darkness factor, per-fragment ray march, or infinite shadow column
 * is needed. Bounds include the finite reach plus two empty cells on each side.
 *
 * A renderer samples both linear RGBA8 fields and weights RGB by max(normal,0)
 * and max(-normal,0), dividing their sum by abs(nx)+abs(ny)+abs(nz). The normal is
 * world-space. Outside the texture cube all directions have visibility 1.
 * This coarse six-direction cubature can miss diagonal occluders; extinction
 * also retains the documented second-moment orientation approximation above.
 */
export function buildAmbientGroomVisibility(
  instances: readonly GroomVolumeInstance[],
  options: AmbientGroomVisibilityOptions = {},
): AmbientGroomVisibility {
  const resolution = integer(
    options.resolution ?? 64,
    16,
    96,
    "ambient resolution",
  );
  const maxBytes = integer(
    options.maxBytes ?? 32 * 1024 * 1024,
    1,
    512 * 1024 * 1024,
    "maxBytes",
  );
  // Three dense Float32 extinction channels, two RGBA8 outputs, two scan lines.
  const cells = resolution ** 3;
  const peakBytes = cells * 20 + (resolution + 1) * 16;
  if (peakBytes > maxBytes) {
    throw new RangeError(
      `Groom ambient visibility needs ${peakBytes} bytes, above maxBytes`,
    );
  }
  if (!Array.isArray(instances) || instances.length > 64) {
    throw new RangeError(
      "Groom ambient visibility supports at most 64 instances",
    );
  }
  const low: GroomXYZ = [Infinity, Infinity, Infinity];
  const high: GroomXYZ = [-Infinity, -Infinity, -Infinity];
  const validated = new Set<GroomVolume>();
  let activeVoxels = 0;
  const prepared = instances.map((instance) => {
    if (!instance || !instance.volume) {
      throw new TypeError("Each groom ambient instance needs a volume");
    }
    const volume = instance.volume;
    if (!validated.has(volume)) {
      validateVolume(volume);
      validated.add(volume);
    }
    const matrix = affine(instance.matrixWorld);
    const axes = [0, 1, 2].map((axis) => {
      const localL = matrix.inverse.slice(axis * 4, axis * 4 + 3) as GroomXYZ;
      const length = Math.hypot(...localL);
      const area = Math.abs(matrix.determinant) * length;
      if (!Number.isFinite(area) || !(area > 0)) {
        throw new RangeError(
          "Groom ambient projected area must be finite and positive",
        );
      }
      for (let k = 0; k < 3; k++) localL[k] /= length;
      return { localL, area };
    });
    activeVoxels += volume.indices.length;
    if (activeVoxels * 3 > MAX_PROJECTED_VOXELS) {
      throw new RangeError(
        "Groom ambient visibility exceeds 8000000 cardinal-axis projections",
      );
    }
    if (volume.indices.length) {
      for (let z = 0; z < 2; z++) {
        for (let y = 0; y < 2; y++) {
          for (let x = 0; x < 2; x++) {
            const p = point(matrix.elements, [
              volume.bounds[x ? "max" : "min"][0],
              volume.bounds[y ? "max" : "min"][1],
              volume.bounds[z ? "max" : "min"][2],
            ]);
            for (let k = 0; k < 3; k++) {
              low[k] = Math.min(low[k], p[k]);
              high[k] = Math.max(high[k], p[k]);
            }
          }
        }
      }
    }
    return { volume, matrix, axes };
  });
  if (!activeVoxels) {
    low.fill(-.5);
    high.fill(.5);
  }
  if (![...low, ...high].every(Number.isFinite)) {
    throw new RangeError("Transformed groom ambient bounds must be finite");
  }
  const extent = Math.max(...high.map((value, k) => value - low[k]));
  const distance = options.distance ?? extent * .12;
  if (!Number.isFinite(distance) || !(distance > 0)) {
    throw new RangeError("Groom ambient distance must be finite and positive");
  }
  const center = low.map((value, k) =>
    value + (high[k] - value) * .5
  ) as GroomXYZ;
  const edge = (extent + 2 * distance) * resolution / (resolution - 4);
  if (!Number.isFinite(edge) || !(edge > 0)) {
    throw new RangeError("Groom ambient bounds must be finite and positive");
  }
  const min = center.map((value) => value - edge * .5) as GroomXYZ;
  const size = edge / resolution, voxelArea = size * size;
  if (!Number.isFinite(voxelArea) || !(voxelArea > 0)) {
    throw new RangeError(
      "Groom ambient voxel area must be finite and positive",
    );
  }
  const worldToTexture = new THREE.Matrix4().set(
    1 / edge,
    0,
    0,
    -min[0] / edge,
    0,
    1 / edge,
    0,
    -min[1] / edge,
    0,
    0,
    1 / edge,
    -min[2] / edge,
    0,
    0,
    0,
    1,
  ).elements;
  if (
    !worldToTexture.every((value) =>
      Number.isFinite(value) && Math.abs(value) <= 3e38
    )
  ) {
    throw new RangeError(
      "Groom ambient texture transform must fit finite Float32 coordinates",
    );
  }
  const extinction = new Float32Array(cells * 3);
  const projectedMass: GroomXYZ = [0, 0, 0];
  for (const { volume, matrix, axes } of prepared) {
    const n = volume.resolution;
    for (let i = 0; i < volume.indices.length; i++) {
      const index = volume.indices[i],
        x = index % n,
        y = Math.floor(index / n) % n,
        z = Math.floor(index / (n * n));
      const p = point(matrix.elements, [
        volume.bounds.min[0] + (x + .5) * volume.voxelSize[0],
        volume.bounds.min[1] + (y + .5) * volume.voxelSize[1],
        volume.bounds.min[2] + (z + .5) * volume.voxelSize[2],
      ]);
      const cell = neighbors(
        (p[0] - min[0]) / size - .5,
        (p[1] - min[1]) / size - .5,
        (p[2] - min[2]) / size - .5,
        resolution,
      );
      const at = i * 6, m = volume.mass[i], q = volume.moments;
      for (let axis = 0; axis < 3; axis++) {
        const { localL: [lx, ly, lz], area } = axes[axis];
        const along =
          (q[at] * lx * lx + q[at + 1] * ly * ly + q[at + 2] * lz * lz +
            2 *
              (q[at + 3] * lx * ly + q[at + 4] * lx * lz +
                q[at + 5] * ly * lz)) /
          m;
        const projected = m * area * Math.sqrt(Math.max(0, 1 - clamp(along)));
        if (projected === 0) continue;
        const opticalMass = projected / voxelArea;
        if (!Number.isFinite(opticalMass) || opticalMass > 3e38) {
          throw new RangeError(
            "Groom ambient extinction exceeds Float32 range",
          );
        }
        projectedMass[axis] += projected;
        for (let iz = 0; iz < 2; iz++) {
          for (let iy = 0; iy < 2; iy++) {
            for (let ix = 0; ix < 2; ix++) {
              const weight = cell.wx[ix] * cell.wy[iy] * cell.wz[iz];
              if (weight === 0) continue;
              const out = cell.x[ix] +
                resolution * (cell.y[iy] + resolution * cell.z[iz]);
              extinction[out * 3 + axis] += opticalMass * weight;
            }
          }
        }
      }
    }
  }
  const positiveData = new Uint8Array(cells * 4).fill(255);
  const negativeData = new Uint8Array(cells * 4).fill(255);
  const prefix = new Float64Array(resolution + 1);
  const moment = new Float64Array(resolution + 1);
  const reach = distance / size;
  const storedProjectedMass: GroomXYZ = [0, 0, 0];
  const maximumOpticalDepth: GroomXYZ = [0, 0, 0];
  const strides = [1, resolution, resolution * resolution];
  for (let axis = 0; axis < 3; axis++) {
    const stride = strides[axis];
    const perpendicular = strides.filter((_, k) => k !== axis);
    for (let b = 0; b < resolution; b++) {
      for (let a = 0; a < resolution; a++) {
        const base = a * perpendicular[0] + b * perpendicular[1];
        for (let i = 0; i < resolution; i++) {
          const delta = extinction[(base + i * stride) * 3 + axis];
          if (!Number.isFinite(delta)) {
            throw new RangeError(
              "Groom ambient extinction accumulation overflowed",
            );
          }
          prefix[i + 1] = prefix[i] + delta;
          moment[i + 1] = moment[i] + delta * (i + .5);
        }
        storedProjectedMass[axis] += prefix[resolution] * voxelArea;
        for (let i = 0; i < resolution; i++) {
          const cell = base + i * stride;
          const delta = extinction[cell * 3 + axis];
          let positive: number, negative: number;
          if (reach <= .5) {
            // A sub-cell path stays in the receiver's cell. Its triangular
            // integral is density * distance/2, which tends smoothly to zero.
            positive = negative = delta * reach * .5;
          } else {
            const receiver = i + .5;
            const middleMass = prefix[i] + delta * .5;
            const middleMoment = moment[i] + delta * (i * .5 + .125);
            const high = Math.min(resolution, receiver + reach);
            const low = Math.max(0, receiver - reach);
            const highCell = Math.floor(high), lowCell = Math.floor(low);
            const highFraction = high - highCell, lowFraction = low - lowCell;
            const highDelta = highCell === resolution
              ? 0
              : extinction[(base + highCell * stride) * 3 + axis];
            const lowDelta = extinction[(base + lowCell * stride) * 3 + axis];
            const highMass = prefix[highCell] + highDelta * highFraction;
            const lowMass = prefix[lowCell] + lowDelta * lowFraction;
            const highMoment = moment[highCell] +
              highDelta * (highCell * highFraction + highFraction ** 2 * .5);
            const lowMoment = moment[lowCell] +
              lowDelta * (lowCell * lowFraction + lowFraction ** 2 * .5);
            const positiveMass = highMass - middleMass;
            const negativeMass = middleMass - lowMass;
            positive = Math.max(
              0,
              positiveMass -
                (highMoment - middleMoment - receiver * positiveMass) / reach,
            );
            negative = Math.max(
              0,
              negativeMass -
                (receiver * negativeMass - middleMoment + lowMoment) / reach,
            );
          }
          positiveData[cell * 4 + axis] = Math.round(Math.exp(-positive) * 255);
          negativeData[cell * 4 + axis] = Math.round(Math.exp(-negative) * 255);
          maximumOpticalDepth[axis] = Math.max(
            maximumOpticalDepth[axis],
            positive,
            negative,
          );
        }
      }
    }
  }
  return {
    resolution,
    distance,
    positiveData,
    negativeData,
    worldToTexture: [...worldToTexture],
    statistics: {
      instances: instances.length,
      activeVoxels,
      axisProjections: activeVoxels * 3,
      projectedMass,
      storedProjectedMass,
      maximumOpticalDepth,
      bytes: positiveData.byteLength + negativeData.byteLength,
      peakBytes,
    },
  };
}
