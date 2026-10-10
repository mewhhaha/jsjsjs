/** Exportable, batched strand geometry for groomed hair, fur, grass and fibers. */
import * as THREE from "three";
import { type GroupOptions, transform } from "../primitives.ts";
import {
  groom,
  type GroomOptions,
  type RootSamplingOptions,
  sampleRoots,
  type StrandData,
} from "./strand-data.ts";

export type HairSurface = THREE.Mesh | THREE.BufferGeometry;
export interface StrandRenderOptions extends GroupOptions {
  mode?: "tubes" | "ribbons";
  /** Tube sides, 3–12. Default 4. */
  radialSegments?: number;
  /** Crossed ribbons per strand; default 1. */
  ribbonPlanes?: 1 | 2 | 3;
  material?: THREE.Material;
  color?: THREE.ColorRepresentation;
  tipColor?: THREE.ColorRepresentation;
  /** Additional per-strand brightness variation, 0–1. Default .15. */
  colorVariation?: number;
}
export interface HairOptions {
  roots?: RootSamplingOptions;
  groom?: GroomOptions;
  render?: StrandRenderOptions;
}
export interface HairMaterialOptions
  extends THREE.MeshPhysicalMaterialParameters {}

/** Anisotropic PBR approximation for mesh strands, not a multiple-scattering hair BSDF. */
export function hairMaterial(
  options: HairMaterialOptions = {},
): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: "#ffffff",
    roughness: .5,
    metalness: 0,
    anisotropy: .7,
    anisotropyRotation: 0,
    specularIntensity: .45,
    sheen: .15,
    sheenColor: "#bda48b",
    vertexColors: true,
    side: THREE.DoubleSide,
    ...options,
  });
}

/** Sample a static surface, groom its roots, and batch the resulting strands. */
export function hair(
  surface: HairSurface,
  options: HairOptions = {},
): THREE.Group {
  const roots = sampleRoots(surface, options.roots);
  const data = groom(roots, { seed: options.roots?.seed, ...options.groom });
  return strands(data, options.render);
}

function validate(data: StrandData, options: StrandRenderOptions): number {
  if (
    data.version !== 1 || !Array.isArray(data.strands) ||
    data.strands.length === 0 || data.strands.length > 20_000
  ) {
    throw new RangeError("Strand data must have version 1 and 1–20000 strands");
  }
  if (!["tubes", "ribbons"].includes(options.mode ?? "tubes")) {
    throw new RangeError("Strand mode must be tubes or ribbons");
  }
  const radial = options.radialSegments ?? 4;
  if (!Number.isInteger(radial) || radial < 3 || radial > 12) {
    throw new RangeError("radialSegments must be an integer from 3 to 12");
  }
  if (![1, 2, 3].includes(options.ribbonPlanes ?? 1)) {
    throw new RangeError("ribbonPlanes must be 1, 2 or 3");
  }
  const variation = options.colorVariation ?? .15;
  if (!Number.isFinite(variation) || variation < 0 || variation > 1) {
    throw new RangeError("colorVariation must be in [0,1]");
  }
  let vertices = 0;
  for (const strand of data.strands) {
    if (
      !Array.isArray(strand.points) || strand.points.length < 2 ||
      strand.points.length > 129 || strand.radii.length !== strand.points.length
    ) {
      throw new RangeError(
        "Each strand needs 2–129 points and a radius for every point",
      );
    }
    if (
      !Number.isFinite(strand.shade) || strand.shade < 0 || strand.shade > 2
    ) throw new RangeError("Strand shade must be in [0,2]");
    strand.points.forEach((p, i) => {
      if (p.length !== 3 || !p.every(Number.isFinite)) {
        throw new RangeError("Strand positions must be finite XYZ tuples");
      }
      if (!Number.isFinite(strand.radii[i]) || strand.radii[i] < 0) {
        throw new RangeError("Strand radii must be nonnegative and finite");
      }
      if (i && p.every((value, k) => value === strand.points[i - 1][k])) {
        throw new RangeError("Consecutive strand points must be distinct");
      }
    });
    if (!(strand.radii[0] > 0)) {
      throw new RangeError("Strand root radius must be positive");
    }
    vertices += options.mode === "ribbons"
      ? strand.points.length * 2 * (options.ribbonPlanes ?? 1)
      : strand.points.length * (radial + 1) + 2;
  }
  if (vertices > 2_000_000) {
    throw new RangeError(
      "Strand mesh exceeds 2000000 vertices; reduce count, segments or tube sides",
    );
  }
  return vertices;
}

/** Render reusable groom data without changing it. UV.u and tangent follow root-to-tip. */
export function strands(
  data: StrandData,
  options: StrandRenderOptions = {},
): THREE.Group {
  const vertexCount = validate(data, options);
  const mode = options.mode ?? "tubes";
  const sides = options.radialSegments ?? 4;
  const planes = options.ribbonPlanes ?? 1;
  const positions = new Float32Array(vertexCount * 3);
  const normals = new Float32Array(vertexCount * 3);
  const tangents = new Float32Array(vertexCount * 4);
  const colors = new Float32Array(vertexCount * 3);
  const uvs = new Float32Array(vertexCount * 2);
  const indices: number[] = [];
  const paint = options.material ?? hairMaterial();
  const base = new THREE.Color(
    options.color ?? (options.material ? "#ffffff" : "#493020"),
  );
  const tip = new THREE.Color(options.tipColor ?? base);
  let cursor = 0;
  const tint = new THREE.Color();
  const write = (
    position: THREE.Vector3,
    normal: THREE.Vector3,
    tangent: THREE.Vector3,
    u: number,
    v: number,
    shade: number,
  ): number => {
    position.toArray(positions, cursor * 3);
    normal.toArray(normals, cursor * 3);
    // UV.u follows the strand, UV.v crosses the section: its bitangent has
    // negative handedness relative to the outward normal and tangent.
    tangents.set([tangent.x, tangent.y, tangent.z, -1], cursor * 4);
    tint.copy(base).lerp(tip, u).multiplyScalar(shade).toArray(
      colors,
      cursor * 3,
    );
    uvs.set([u, v], cursor * 2);
    return cursor++;
  };
  for (const strand of data.strands) {
    const points = strand.points.map((p) => new THREE.Vector3(...p));
    const distance = [0];
    for (let i = 1; i < points.length; i++) {
      distance.push(distance[i - 1] + points[i].distanceTo(points[i - 1]));
    }
    const total = distance.at(-1)!;
    const directions = points.map((_, i) => {
      const delta = points[Math.min(i + 1, points.length - 1)].clone().sub(
        points[Math.max(i - 1, 0)],
      );
      if (delta.lengthSq() < 1e-20) {
        delta.copy(points[i]).sub(points[Math.max(i - 1, 0)]);
      }
      return delta.normalize();
    });
    const seed = Math.abs(directions[0].y) < .9
      ? new THREE.Vector3(0, 1, 0)
      : new THREE.Vector3(1, 0, 0);
    let normal = seed.addScaledVector(directions[0], -seed.dot(directions[0]))
      .normalize();
    const frames: THREE.Vector3[] = [];
    for (let i = 0; i < points.length; i++) {
      if (i) {
        normal = normal.clone().applyQuaternion(
          new THREE.Quaternion().setFromUnitVectors(
            directions[i - 1],
            directions[i],
          ),
        );
      }
      normal.addScaledVector(directions[i], -normal.dot(directions[i]))
        .normalize();
      frames.push(normal.clone());
    }
    const shade = Math.max(
      0,
      1 + (strand.shade - 1) * (options.colorVariation ?? .15) / .2,
    );
    if (mode === "ribbons") {
      for (let plane = 0; plane < planes; plane++) {
        const start = cursor;
        for (let i = 0; i < points.length; i++) {
          const side = frames[i].clone().applyAxisAngle(
            directions[i],
            plane * Math.PI / planes,
          );
          const facing = side.clone().cross(directions[i]).normalize();
          const left = points[i].clone().addScaledVector(
            side,
            -strand.radii[i],
          );
          const right = points[i].clone().addScaledVector(
            side,
            strand.radii[i],
          );
          write(left, facing, directions[i], distance[i] / total, 0, shade);
          write(right, facing, directions[i], distance[i] / total, 1, shade);
          if (i) {
            const a = start + (i - 1) * 2, b = a + 2;
            if (strand.radii[i - 1] > 0) indices.push(a, a + 1, b);
            if (strand.radii[i] > 0) indices.push(a + 1, b + 1, b);
          }
        }
      }
    } else {
      const start = cursor;
      for (let i = 0; i < points.length; i++) {
        const previous = Math.max(0, i - 1),
          next = Math.min(points.length - 1, i + 1);
        const slope = (strand.radii[next] - strand.radii[previous]) /
          (distance[next] - distance[previous]);
        for (let j = 0; j <= sides; j++) {
          const radial = frames[i].clone().applyAxisAngle(
            directions[i],
            j / sides * Math.PI * 2,
          );
          const position = points[i].clone().addScaledVector(
            radial,
            strand.radii[i],
          );
          const normal = radial.clone().addScaledVector(directions[i], -slope)
            .normalize();
          const tangent = directions[i].clone().addScaledVector(radial, slope)
            .normalize();
          write(
            position,
            normal,
            tangent,
            distance[i] / total,
            j / sides,
            shade,
          );
          if (i && j < sides) {
            const a = start + (i - 1) * (sides + 1) + j, b = a + sides + 1;
            if (strand.radii[i - 1] > 0) indices.push(a, a + 1, b);
            if (strand.radii[i] > 0) indices.push(a + 1, b + 1, b);
          }
        }
      }
      const root = write(
        points[0],
        directions[0].clone().negate(),
        frames[0],
        0,
        .5,
        shade,
      );
      const tipIndex = write(
        points.at(-1)!,
        directions.at(-1)!,
        frames.at(-1)!,
        1,
        .5,
        shade,
      );
      for (let j = 0; j < sides; j++) {
        indices.push(root, start + j + 1, start + j);
        if (strand.radii.at(-1)! > 0) {
          const end = start + (points.length - 1) * (sides + 1);
          indices.push(tipIndex, end + j, end + j + 1);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
  geometry.setAttribute("tangent", new THREE.BufferAttribute(tangents, 4));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const mesh = new THREE.Mesh(geometry, paint);
  mesh.name = "strand-preview";
  mesh.userData.threejsStrandPreview = true;
  const result = new THREE.Group();
  result.add(mesh);
  result.name = options.name ?? "strands";
  transform(result, options);
  if (options.preview) result.userData.preview = { ...options.preview };
  const materialColor = (paint as THREE.MeshStandardMaterial).color ??
    new THREE.Color("white");
  result.userData.threejsStrandId = result.uuid;
  result.userData.threejsStrands = {
    ...structuredClone(data),
    representation: mode,
    material: {
      color: base.clone().multiply(materialColor).toArray(),
      tipColor: tip.clone().multiply(materialColor).toArray(),
      roughness: (paint as THREE.MeshStandardMaterial).roughness ?? .5,
      colorVariation: options.colorVariation ?? .15,
    },
  };
  return result;
}
