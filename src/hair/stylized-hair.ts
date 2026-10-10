/** Sculpted, closed hair locks for stylized characters; ordinary portable meshes. */
import * as THREE from "three";
import type { XYZ } from "../primitives.ts";
import { integer, range, vector } from "../validate.ts";

export interface HairLockOptions {
  name?: string;
  /** Full width at a widthProfile value of 1. */
  width?: number;
  /** Height of the arched upper surface; the underside is one quarter as deep. */
  thickness?: number;
  /** Uniformly spaced width multipliers, root to tip. Interior values must be positive. */
  widthProfile?: readonly number[];
  /** Outward direction. Projected perpendicular to the curve at each sample. */
  normal?: XYZ;
  /** Outward directions at each input path point; useful on a curved scalp. */
  normals?: readonly XYZ[];
  /** Twist about the path, in degrees, applied gradually from root to tip. */
  twist?: number;
  /** Bias the crown height toward one edge; -0.7 to 0.7. */
  ridge?: number;
  /** Along-curve subdivisions, 2 to 256. */
  segments?: number;
  /** Cross-section subdivisions, 4 to 32 per surface. */
  crossSegments?: number;
  color?: THREE.ColorRepresentation;
  tipColor?: THREE.ColorRepresentation;
  roughness?: number;
  material?: THREE.Material;
}

function boundedVector(value: XYZ, name: string): THREE.Vector3 {
  const result = vector(value, name);
  value.forEach((component) =>
    range(component, -1e6, 1e6, `${name} component`)
  );
  return result;
}

function profileAt(profile: readonly number[], t: number): number {
  const at = t * (profile.length - 1);
  const index = Math.min(profile.length - 2, Math.floor(at));
  return THREE.MathUtils.lerp(profile[index], profile[index + 1], at - index);
}

/**
 * Sweep a broad convex wedge through a centripetal Catmull–Rom curve. Unlike a
 * round tube, the upper ridge, thin edges and shallow underside create the
 * large readable planes of sculpted cartoon hair. Both ends are closed, zero
 * width endpoints use a single pole, and UV v runs from root to tip.
 */
export function hairLock(
  path: readonly XYZ[],
  options: HairLockOptions = {},
): THREE.Mesh<THREE.BufferGeometry> {
  integer(path.length, 2, 256, "path point count");
  const points = path.map((point) => boundedVector(point, "path point"));
  for (let i = 1; i < points.length; i++) {
    if (points[i].distanceToSquared(points[i - 1]) < 1e-16) {
      throw new RangeError("path has repeated consecutive points");
    }
  }
  const width = range(options.width ?? .2, 1e-6, 1e6, "width");
  const thickness = range(
    options.thickness ?? width * .24,
    1e-6,
    1e6,
    "thickness",
  );
  const segments = integer(options.segments ?? 24, 2, 256, "segments");
  const crossSegments = integer(
    options.crossSegments ?? 8,
    4,
    32,
    "crossSegments",
  );
  const ridge = range(options.ridge ?? 0, -.7, .7, "ridge");
  const twist = THREE.MathUtils.degToRad(
    range(options.twist ?? 0, -720, 720, "twist"),
  );
  const roughness = range(options.roughness ?? .48, 0, 1, "roughness");
  const profile = options.widthProfile ?? [.62, 1, .94, .64, 0];
  integer(profile.length, 2, 64, "widthProfile length");
  profile.forEach((value, index) => {
    range(value, 0, 8, "widthProfile value");
    if (index > 0 && index < profile.length - 1 && value === 0) {
      throw new RangeError("interior widthProfile values must be positive");
    }
  });
  if (profile.every((value) => value === 0)) {
    throw new RangeError("widthProfile must contain a positive value");
  }
  if (options.normals && options.normals.length !== points.length) {
    throw new RangeError("normals must match the path point count");
  }
  const suppliedNormals = options.normals?.map((normal) =>
    boundedVector(normal, "normal")
  );
  const initialNormal = boundedVector(options.normal ?? [0, 0, 1], "normal");
  for (const normal of suppliedNormals ?? [initialNormal]) {
    if (normal.lengthSq() < 1e-16) {
      throw new RangeError("normal must be nonzero");
    }
    normal.normalize();
  }

  const curve = new THREE.CatmullRomCurve3(points, false, "centripetal");
  curve.arcLengthDivisions = Math.max(200, segments * 8);
  const tangents = Array.from(
    { length: segments + 1 },
    (_, i) => curve.getTangentAt(i / segments),
  );
  const positions: number[] = [],
    uvs: number[] = [],
    colors: number[] = [],
    indices: number[] = [];
  const rings: number[][] = [];
  const baseColor = new THREE.Color(options.color ?? "#4a2939");
  const tipColor = new THREE.Color(
    options.tipColor ?? options.color ?? "#4a2939",
  );
  let previousNormal: THREE.Vector3 | undefined;
  const quaternion = new THREE.Quaternion();

  function vertex(position: THREE.Vector3, u: number, t: number): number {
    const index = positions.length / 3;
    positions.push(...position.toArray());
    uvs.push(u, t);
    const color = baseColor.clone().lerp(tipColor, t * t).multiplyScalar(
      .82 + .18 * Math.sin(Math.PI * t * .8),
    );
    colors.push(...color.toArray());
    return index;
  }

  for (let row = 0; row <= segments; row++) {
    const t = row / segments;
    const center = curve.getPointAt(t), tangent = tangents[row];
    let normal: THREE.Vector3;
    if (suppliedNormals) {
      const at = curve.getUtoTmapping(t, 0) * (points.length - 1);
      const index = Math.min(points.length - 2, Math.floor(at));
      normal = suppliedNormals[index].clone().lerp(
        suppliedNormals[index + 1],
        at - index,
      );
    } else if (previousNormal) {
      quaternion.setFromUnitVectors(tangents[row - 1], tangent);
      normal = previousNormal.clone().applyQuaternion(quaternion);
    } else {
      normal = initialNormal.clone();
    }
    normal.addScaledVector(tangent, -normal.dot(tangent));
    if (normal.lengthSq() < 1e-10) {
      normal.set(
        Math.abs(tangent.x) < .8 ? 1 : 0,
        Math.abs(tangent.x) < .8 ? 0 : 1,
        0,
      );
      normal.addScaledVector(tangent, -normal.dot(tangent));
    }
    normal.normalize();
    previousNormal = normal.clone();
    normal.applyAxisAngle(tangent, twist * t);
    const side = new THREE.Vector3().crossVectors(normal, tangent).normalize();
    const scale = profileAt(profile, t);
    const ring: number[] = [];
    if (scale < 1e-10) {
      ring.push(vertex(center, .5, t));
    } else {
      // A convex crown and a shallow underside meet at thin, sharp edges.
      for (let col = 0; col < crossSegments * 2; col++) {
        const angle = col / (crossSegments * 2) * Math.PI * 2;
        const x = Math.cos(angle), upper = Math.sin(angle) >= 0;
        const arch = upper
          ? .55 * (1 - Math.abs(x)) + .45 * (1 - x * x)
          : Math.pow(Math.max(0, 1 - x * x), .52);
        const y = upper ? arch * (1 + ridge * x) : -arch * .25;
        const p = center.clone().addScaledVector(side, x * width * .5 * scale)
          .addScaledVector(normal, y * thickness * Math.pow(scale, .72));
        ring.push(vertex(p, col / (crossSegments * 2), t));
      }
    }
    rings.push(ring);
  }
  const sides = crossSegments * 2;
  for (let row = 0; row < segments; row++) {
    const a = rings[row], b = rings[row + 1];
    for (let col = 0; col < sides; col++) {
      const next = (col + 1) % sides;
      if (a.length === 1) indices.push(a[0], b[next], b[col]);
      else if (b.length === 1) indices.push(a[col], a[next], b[0]);
      else indices.push(a[col], a[next], b[col], a[next], b[next], b[col]);
    }
  }
  for (const end of [0, segments]) {
    const ring = rings[end];
    if (ring.length === 1) continue;
    const center = vertex(curve.getPointAt(end / segments), .5, end / segments);
    for (let col = 0; col < sides; col++) {
      const next = (col + 1) % sides;
      if (end === 0) indices.push(center, ring[next], ring[col]);
      else indices.push(center, ring[col], ring[next]);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const material = options.material ?? new THREE.MeshStandardMaterial({
    color: "#ffffff",
    vertexColors: true,
    roughness,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = options.name ?? "sculpted hair lock";
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.threejsHairLock = {
    version: 1,
    path: path.map((p) => [...p]),
    width,
    thickness,
    widthProfile: [...profile],
  };
  return mesh;
}
