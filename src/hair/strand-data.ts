import * as THREE from "three";
import type { XYZ } from "../primitives.ts";
import { mulberry32 } from "../random.ts";
import { finite, integer, positive, range, vector } from "../validate.ts";

export interface StrandRoot {
  position: XYZ;
  normal: XYZ;
  uv?: readonly [number, number];
  faceIndex?: number;
  region?: string;
}
export interface StrandGuide {
  points: readonly XYZ[];
  region?: string;
}
export interface Strand {
  points: XYZ[];
  radii: number[];
  shade: number;
}
export interface StrandData {
  version: 1;
  strands: Strand[];
  guides: XYZ[][];
  seed: number;
}
export interface RootSamplingOptions {
  count?: number;
  seed?: number;
  /** Acceptance probability at a candidate root, from zero to one. */
  density?: (root: StrandRoot) => number;
  /** Scalar vertex attribute, or the first component of a color attribute. */
  densityAttribute?: string;
  region?: (root: StrandRoot) => string;
  /** Rejection sampling fails explicitly when this budget is exhausted. */
  maxAttempts?: number;
}
export interface GroomOptions {
  seed?: number;
  /** Base strand length before bending, clumping, noise, and collision. */
  length?: number;
  lengthVariation?: number;
  radius?: number;
  tipRadius?: number;
  taper?: number;
  segments?: number;
  /** World-space comb bias added to the weighted surface normal. */
  direction?: XYZ;
  normalInfluence?: number;
  /** World-space endpoint displacement, applied quadratically along the strand. */
  bend?: XYZ;
  /** Guide shape is arc-length sampled and scaled to the requested strand length. */
  guides?: readonly StrandGuide[];
  guideInfluences?: number;
  /** Pull tips towards the nearest matching guide tip; zero preserves root spacing. */
  clump?: number;
  curl?: { radius: number; turns: number };
  frizz?: { amplitude: number; frequency: number };
  flyaways?: { fraction: number; amplitude: number };
  /** Static ellipsoid clearance; roots remain fixed. This is not a physics solver. */
  colliders?: readonly { center: XYZ; radii: XYZ }[];
}

const MAX_STRANDS = 20_000;
const MAX_POINTS = 2_000_000;
function vec(value: XYZ, label: string): THREE.Vector3 {
  if (!Array.isArray(value) || value.length !== 3) {
    throw new TypeError(`${label} must contain three finite numbers`);
  }
  return vector(value, label);
}
function xyz(value: THREE.Vector3): XYZ {
  return [value.x, value.y, value.z];
}

/** A repeatable generator independent of Math.random and browser state. */
export function strandRandom(seed: number): () => number {
  return mulberry32(integer(seed, 0, 0xffffffff, "seed"));
}

/** Sample static triangles uniformly by world-space area, with optional density masks. */
export function sampleRoots(
  surface: THREE.Mesh | THREE.BufferGeometry,
  options: RootSamplingOptions = {},
): StrandRoot[] {
  const count = integer(options.count ?? 1000, 0, MAX_STRANDS, "count");
  const random = strandRandom(options.seed ?? 1);
  const attempts = integer(
    options.maxAttempts ?? Math.max(1000, count * 100),
    count,
    10_000_000,
    "maxAttempts",
  );
  const mesh = surface instanceof THREE.Mesh ? surface : undefined;
  const geometry = mesh ? mesh.geometry : surface;
  if (!(geometry instanceof THREE.BufferGeometry)) {
    throw new TypeError("sampleRoots requires a Mesh or BufferGeometry");
  }
  if (
    mesh instanceof THREE.SkinnedMesh || mesh instanceof THREE.InstancedMesh
  ) {
    throw new TypeError("sampleRoots requires a static, non-instanced mesh");
  }
  if (
    Object.values(geometry.morphAttributes).some((attributes) =>
      attributes.length
    )
  ) {
    throw new TypeError(
      "sampleRoots does not support morph geometry; bake it first",
    );
  }
  if (geometry.drawRange.start !== 0 || geometry.drawRange.count !== Infinity) {
    throw new TypeError(
      "sampleRoots does not support custom draw ranges; bake them first",
    );
  }
  const position = geometry.getAttribute("position");
  if (!position || position.itemSize !== 3 || position.count < 3) {
    throw new TypeError(
      "surface requires a three-component position attribute",
    );
  }
  const normal = geometry.getAttribute("normal");
  const uv = geometry.getAttribute("uv");
  const density = options.densityAttribute
    ? geometry.getAttribute(options.densityAttribute)
    : undefined;
  if (options.densityAttribute && !density) {
    throw new TypeError(
      `Missing density attribute ${options.densityAttribute}`,
    );
  }
  for (
    const [label, attribute, size] of [["normal", normal, 3], ["uv", uv, 2], [
      "density",
      density,
      1,
    ]] as const
  ) {
    if (
      attribute &&
      (attribute.itemSize < size || attribute.count !== position.count)
    ) {
      throw new TypeError(
        `${label} attribute has an invalid size or vertex count`,
      );
    }
  }
  const matrix = new THREE.Matrix4();
  if (mesh) {
    mesh.updateWorldMatrix(true, false);
    matrix.copy(mesh.matrixWorld);
    matrix.elements.forEach((v) => finite(v, "surface transform"));
    if (Math.abs(matrix.determinant()) < 1e-15) {
      throw new RangeError("surface transform is singular");
    }
  }
  const normalMatrix = new THREE.Matrix3().getNormalMatrix(matrix);
  const positions: THREE.Vector3[] = [];
  for (let i = 0; i < position.count; i++) {
    const point = new THREE.Vector3().fromBufferAttribute(position, i)
      .applyMatrix4(matrix);
    point.toArray().forEach((v) => finite(v, "surface position"));
    positions.push(point);
    if (normal) {
      [normal.getX(i), normal.getY(i), normal.getZ(i)].forEach((v) =>
        finite(v, "surface normal")
      );
    }
    if (uv) [uv.getX(i), uv.getY(i)].forEach((v) => finite(v, "surface uv"));
    if (density) range(density.getX(i), 0, 1, "density attribute");
  }
  const index = geometry.index;
  const indexCount = index?.count ?? position.count;
  if (indexCount % 3 !== 0) {
    throw new RangeError(
      "surface triangle index count must be divisible by three",
    );
  }
  const triangles: {
    a: number;
    b: number;
    c: number;
    area: number;
    face: number;
    normal: THREE.Vector3;
  }[] = [];
  let total = 0;
  for (let i = 0; i < indexCount; i += 3) {
    const ids = [0, 1, 2].map((j) =>
      integer(
        index ? index.getX(i + j) : i + j,
        0,
        position.count - 1,
        "triangle index",
      )
    );
    const [a, b, c] = ids;
    const faceNormal = positions[b].clone().sub(positions[a]).cross(
      positions[c].clone().sub(positions[a]),
    );
    const area = faceNormal.length() / 2;
    finite(area, "triangle area");
    if (area === 0) continue;
    total += area;
    triangles.push({
      a,
      b,
      c,
      area: total,
      face: i / 3,
      normal: faceNormal.normalize(),
    });
  }
  positive(total, "surface area");
  const roots: StrandRoot[] = [];
  for (let attempt = 0; roots.length < count && attempt < attempts; attempt++) {
    const target = random() * total;
    let lo = 0, hi = triangles.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (triangles[mid].area < target) lo = mid + 1;
      else hi = mid;
    }
    const tri = triangles[lo];
    const r = Math.sqrt(random()), s = random();
    const weights = [1 - r, r * (1 - s), r * s];
    const ids = [tri.a, tri.b, tri.c];
    const point = new THREE.Vector3(), n = new THREE.Vector3();
    const uvPoint = new THREE.Vector2();
    let probability = density ? 0 : 1;
    ids.forEach((id, j) => {
      point.addScaledVector(positions[id], weights[j]);
      if (normal) {
        n.addScaledVector(
          new THREE.Vector3().fromBufferAttribute(normal, id),
          weights[j],
        );
      }
      if (uv) {
        uvPoint.addScaledVector(
          new THREE.Vector2(uv.getX(id), uv.getY(id)),
          weights[j],
        );
      }
      if (density) probability += density.getX(id) * weights[j];
    });
    if (normal) n.applyMatrix3(normalMatrix);
    if (n.lengthSq() < 1e-20) n.copy(tri.normal);
    n.normalize();
    const root: StrandRoot = {
      position: xyz(point),
      normal: xyz(n),
      faceIndex: tri.face,
    };
    if (uv) root.uv = [uvPoint.x, uvPoint.y];
    if (options.density) {
      probability *= range(
        options.density(root),
        0,
        1,
        "density callback result",
      );
    }
    if (random() >= probability) continue;
    if (options.region) {
      root.region = options.region(root);
      if (typeof root.region !== "string") {
        throw new TypeError("region callback must return a string");
      }
    }
    roots.push(root);
  }
  if (roots.length !== count) {
    throw new RangeError(
      `Density sampling accepted ${roots.length}/${count} roots after ${attempts} attempts; increase maxAttempts or the mask density`,
    );
  }
  return roots;
}

/** Generate editable tapered centerlines; controls are static geometry, not simulation. */
export function groom(
  roots: readonly StrandRoot[],
  options: GroomOptions = {},
): StrandData {
  integer(roots.length, 0, MAX_STRANDS, "root count");
  const seed = options.seed ?? 1, random = strandRandom(seed);
  const segments = integer(options.segments ?? 16, 2, 128, "segments");
  const guides = options.guides ?? [];
  integer(guides.length, 0, 1024, "guide count");
  const pointCount = roots.length * (segments + 1) +
    guides.reduce((n, guide) => n + guide.points.length + segments + 1, 0);
  integer(pointCount, 0, MAX_POINTS, "total point budget");
  const length = positive(options.length ?? .2, "length");
  const variation = range(
    options.lengthVariation ?? .2,
    0,
    1 - Number.EPSILON,
    "lengthVariation",
  );
  const radius = positive(options.radius ?? .002, "radius");
  const tipRadius = range(
    options.tipRadius ?? Math.min(.0001, radius),
    0,
    radius,
    "tipRadius",
  );
  const taper = positive(options.taper ?? 1, "taper");
  const direction = vec(options.direction ?? [0, 0, 0], "direction");
  const bend = vec(options.bend ?? [0, 0, 0], "bend");
  const normalInfluence = range(
    options.normalInfluence ?? 1,
    0,
    1e6,
    "normalInfluence",
  );
  const influences = integer(
    options.guideInfluences ?? 3,
    1,
    8,
    "guideInfluences",
  );
  const clump = range(options.clump ?? 0, 0, 1, "clump");
  const curlRadius = range(
    options.curl?.radius ?? 0,
    0,
    Infinity,
    "curl.radius",
  );
  const curlTurns = finite(options.curl?.turns ?? 0, "curl.turns");
  const frizz = range(
    options.frizz?.amplitude ?? 0,
    0,
    Infinity,
    "frizz.amplitude",
  );
  const frequency = range(
    options.frizz?.frequency ?? 4,
    0,
    1e6,
    "frizz.frequency",
  );
  const flyFraction = range(
    options.flyaways?.fraction ?? 0,
    0,
    1,
    "flyaways.fraction",
  );
  const flyAmplitude = range(
    options.flyaways?.amplitude ?? 0,
    0,
    Infinity,
    "flyaways.amplitude",
  );
  integer(options.colliders?.length ?? 0, 0, 128, "collider count");
  const colliders = (options.colliders ?? []).map((collider) => {
    const center = vec(collider.center, "collider.center"),
      radii = vec(collider.radii, "collider.radii");
    radii.toArray().forEach((r) => positive(r, "collider.radii"));
    return { center, radii };
  });
  const rootVectors = roots.map((root) => {
    if (root.region !== undefined && typeof root.region !== "string") {
      throw new TypeError("root.region must be a string");
    }
    const p = vec(root.position, "root.position"),
      n = vec(root.normal, "root.normal");
    positive(n.length(), "root normal length");
    n.normalize();
    const heading = n.clone().multiplyScalar(normalInfluence).add(direction);
    positive(heading.length(), "combined normal and direction length");
    return { p, n, heading: heading.normalize() };
  });
  const preparedGuides = guides.map((guide) => {
    integer(guide.points.length, 2, MAX_POINTS, "guide point count");
    if (guide.region !== undefined && typeof guide.region !== "string") {
      throw new TypeError("guide.region must be a string");
    }
    const points = guide.points.map((point) => vec(point, "guide point"));
    const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
    curve.arcLengthDivisions = Math.max(
      200,
      Math.min(10_000, points.length * 10),
    );
    const arcLength = positive(curve.getLength(), "guide length");
    const samples = curve.getSpacedPoints(segments);
    return {
      root: points[0],
      offsets: samples.map((p) => p.sub(points[0]).divideScalar(arcLength)),
      region: guide.region,
    };
  });
  const strands = roots.map((root, index): Strand => {
    const { p, heading } = rootVectors[index];
    const strandLength = length * (1 + (random() * 2 - 1) * variation);
    const phase = random() * Math.PI * 2;
    const fly = random() < flyFraction ? flyAmplitude : 0;
    const shade = .8 + random() * .4;
    const u = new THREE.Vector3(
      Math.abs(heading.y) < .9 ? 0 : 1,
      Math.abs(heading.y) < .9 ? 1 : 0,
      0,
    ).cross(heading).normalize();
    const v = heading.clone().cross(u).normalize();
    const nearby = preparedGuides.filter((guide) =>
      guide.region === root.region
    ).map((guide) => ({ guide, distance: guide.root.distanceToSquared(p) }))
      .sort((a, b) => a.distance - b.distance).slice(0, influences);
    const weightTotal = nearby.reduce(
      (sum, item) => sum + 1 / Math.max(item.distance, 1e-12),
      0,
    );
    const basePoints: THREE.Vector3[] = [];
    for (let j = 0; j <= segments; j++) {
      const t = j / segments;
      const offset = new THREE.Vector3();
      if (nearby.length) {
        for (const item of nearby) {
          offset.addScaledVector(
            item.guide.offsets[j],
            strandLength / Math.max(item.distance, 1e-12) / weightTotal,
          );
        }
        offset.addScaledVector(direction, strandLength * t * t);
      } else offset.copy(heading).multiplyScalar(strandLength * t);
      const point = p.clone().add(offset).addScaledVector(bend, t * t);
      if (nearby.length && clump) {
        const nearest = nearby[0].guide;
        const target = nearest.root.clone().addScaledVector(
          nearest.offsets[j],
          strandLength,
        ).addScaledVector(bend, t * t);
        point.lerp(target, clump * t * t);
      }
      basePoints.push(point);
    }
    const points: XYZ[] = [], radii: number[] = [];
    for (let j = 0; j <= segments; j++) {
      const t = j / segments;
      const point = basePoints[j].clone();
      // Transport the curl frame along the combed path, avoiding a world-axis curl.
      const tangent = basePoints[Math.min(segments, j + 1)].clone().sub(
        basePoints[Math.max(0, j - 1)],
      );
      if (tangent.lengthSq() > 1e-20) {
        tangent.normalize();
        u.addScaledVector(tangent, -u.dot(tangent));
        if (u.lengthSq() < 1e-20) {
          u.set(
            Math.abs(tangent.y) < .9 ? 0 : 1,
            Math.abs(tangent.y) < .9 ? 1 : 0,
            0,
          ).cross(tangent);
        }
        u.normalize();
        v.copy(tangent).cross(u).normalize();
      }
      const angle = Math.PI * 2 * curlTurns * t + phase;
      const envelope = Math.sin(t * Math.PI / 2);
      point.addScaledVector(u, curlRadius * envelope * Math.cos(angle));
      point.addScaledVector(v, curlRadius * envelope * Math.sin(angle));
      point.addScaledVector(
        u,
        envelope *
          (frizz * Math.sin(t * frequency * Math.PI * 2 + phase) +
            fly * t * Math.cos(phase)),
      );
      point.addScaledVector(
        v,
        envelope *
          (frizz * Math.sin(t * frequency * Math.PI * 2 * 1.618 + phase * 2.3) +
            fly * t * Math.sin(phase)),
      );
      if (j > 0) {
        // Repeated passes help adjacent colliders; incompatible overlaps are not a simulation.
        for (let pass = 0; pass < 3; pass++) {
          for (const collider of colliders) {
            const delta = point.clone().sub(collider.center).divide(
              collider.radii,
            );
            const d = delta.length();
            if (d < 1) {
              if (d < 1e-12) {
                delta.copy(heading).divide(collider.radii).normalize();
              } else delta.divideScalar(d);
              point.copy(
                delta.multiply(collider.radii).multiplyScalar(1 + 1e-7).add(
                  collider.center,
                ),
              );
            }
          }
        }
      }
      point.toArray().forEach((value) =>
        finite(value, "generated strand position")
      );
      points.push(
        j === 0
          ? [root.position[0], root.position[1], root.position[2]]
          : xyz(point),
      );
      radii.push(tipRadius + (radius - tipRadius) * Math.pow(1 - t, taper));
    }
    return { points, radii, shade };
  });
  return {
    version: 1,
    strands,
    guides: guides.map((guide) => guide.points.map((p) => [p[0], p[1], p[2]])),
    seed,
  };
}
