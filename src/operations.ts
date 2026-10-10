/** Solid modeling uses Manifold WASM, loaded lazily on first operation. */
import * as THREE from "three";
import type { Manifold, ManifoldToplevel } from "manifold-3d";
import {
  extrude,
  material,
  type MeshOptions,
  transform,
} from "./primitives.ts";

export type Outline = THREE.Shape | readonly (readonly [number, number])[];
export interface SolidOptions extends MeshOptions {
  /** A single output material; defaults to the first input mesh's first material. */
  material?: THREE.Material;
  /** Smooth all shared vertices; defaults to flat face normals. */
  smooth?: boolean;
  /** Vertex welding tolerance, in model units. Defaults to Manifold's tolerance. */
  tolerance?: number;
}
export interface OffsetProfileOptions {
  join?: "round" | "miter" | "square";
  miterLimit?: number;
  segments?: number;
}
export interface BevelOptions extends MeshOptions {
  depth?: number;
  amount?: number;
  segments?: number;
  curveSegments?: number;
}

let kernel: Promise<ManifoldToplevel> | undefined;
function engine(): Promise<ManifoldToplevel> {
  return kernel ??= import("manifold-3d").then(async ({ default: Module }) => {
    const result = await Module();
    result.setup();
    return result;
  });
}

/** Average area-weighted face normals across position duplicates, retaining UV seams. */
function smoothNormals(geometry: THREE.BufferGeometry): void {
  const position = geometry.getAttribute("position");
  const index = geometry.index!;
  const sums = new Map<string, THREE.Vector3>();
  const keys = Array.from(
    { length: position.count },
    (_, i) => `${position.getX(i)},${position.getY(i)},${position.getZ(i)}`,
  );
  const a = new THREE.Vector3(),
    b = new THREE.Vector3(),
    c = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    const vertices = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    a.fromBufferAttribute(position, vertices[0]);
    b.fromBufferAttribute(position, vertices[1]);
    c.fromBufferAttribute(position, vertices[2]);
    const normal = b.sub(a).cross(c.sub(a));
    for (const vertex of vertices) {
      const key = keys[vertex];
      if (!sums.has(key)) sums.set(key, new THREE.Vector3());
      sums.get(key)!.add(normal);
    }
  }
  for (const normal of sums.values()) normal.normalize();
  const normals = new Float32Array(position.count * 3);
  keys.forEach((key, i) =>
    (sums.get(key) ?? a.set(0, 0, 0)).toArray(normals, i * 3)
  );
  geometry.setAttribute("normal", new THREE.BufferAttribute(normals, 3));
}

function ring(
  points: readonly (readonly [number, number])[],
): [number, number][] {
  const result = points.map(([x, y]): [number, number] => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      throw new RangeError("Profile coordinates must be finite");
    }
    return [x, y];
  });
  if (
    result.length > 1 && result[0][0] === result.at(-1)![0] &&
    result[0][1] === result.at(-1)![1]
  ) result.pop();
  if (result.length < 3 || Math.abs(area(result)) < 1e-12) {
    throw new RangeError("Profile must enclose a nonzero area");
  }
  return result;
}
function area(points: [number, number][]): number {
  return points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + p[0] * q[1] - p[1] * q[0];
  }, 0) / 2;
}

/** Offset a closed XY outline, preserving holes and returning all surviving islands.
 * Positive distances expand the solid; negative distances shrink it. Curves are sampled.
 */
export async function offsetProfile(
  profile: Outline,
  distance: number,
  options: OffsetProfileOptions = {},
): Promise<THREE.Shape[]> {
  if (!Number.isFinite(distance)) {
    throw new RangeError("distance must be finite");
  }
  const segments = options.segments ?? 32;
  const limit = options.miterLimit ?? 2;
  if (!Number.isInteger(segments) || segments < 3) {
    throw new RangeError("segments must be an integer >= 3");
  }
  if (!Number.isFinite(limit) || limit < 1) {
    throw new RangeError("miterLimit must be >= 1");
  }
  const joins = { round: "Round", miter: "Miter", square: "Square" } as const;
  const join = joins[options.join ?? "round"];
  if (!join) throw new RangeError("Unknown offset join");
  const sampled = profile instanceof THREE.Shape
    ? profile.extractPoints(segments)
    : null;
  const contours = [
    sampled
      ? ring(sampled.shape.map((p) => [p.x, p.y]))
      : ring(profile as readonly (readonly [number, number])[]),
  ];
  for (const hole of sampled?.holes ?? []) {
    contours.push(ring(hole.map((p) => [p.x, p.y])));
  }
  contours.forEach((contour, i) => {
    if ((area(contour) > 0) !== (i === 0)) contour.reverse();
  });
  const m = await engine();
  const source = new m.CrossSection(contours, "NonZero");
  let expanded: InstanceType<ManifoldToplevel["CrossSection"]> | undefined;
  const pieces: InstanceType<ManifoldToplevel["CrossSection"]>[] = [];
  try {
    expanded = source.offset(distance, join, limit, segments);
    pieces.push(...expanded.decompose());
    return pieces.filter((piece) => piece.area() > 0).map((piece) => {
      const polygons = piece.toPolygons().sort((a, b) =>
        Math.abs(area(b)) - Math.abs(area(a))
      );
      const shape = new THREE.Shape(
        polygons[0].map(([x, y]) => new THREE.Vector2(x, y)),
      );
      for (const polygon of polygons.slice(1)) {
        shape.holes.push(
          new THREE.Path(polygon.map(([x, y]) => new THREE.Vector2(x, y))),
        );
      }
      return shape;
    });
  } finally {
    for (const piece of pieces) piece.delete();
    expanded?.delete();
    source.delete();
  }
}

/** Extrude an XY profile along +Z with beveled perimeter edges, including holes.
 * amount extends beyond both Z ends and the outline. This is not an arbitrary mesh edge modifier.
 */
export function bevel(
  profile: Outline,
  options: BevelOptions = {},
): THREE.Mesh {
  const { amount = .05, segments = 3, depth = 1, curveSegments, ...mesh } =
    options;
  const shape = profile instanceof THREE.Shape
    ? profile
    : new THREE.Shape(ring(profile).map(([x, y]) => new THREE.Vector2(x, y)));
  return extrude(shape, {
    ...mesh,
    depth,
    curveSegments,
    bevelEnabled: true,
    bevelSize: amount,
    bevelThickness: amount,
    bevelSegments: segments,
  });
}

async function booleanOperation(
  kind: "union" | "subtract" | "intersect",
  objects: readonly THREE.Object3D[],
  options: SolidOptions,
): Promise<THREE.Mesh> {
  if (!objects.length) {
    throw new RangeError("Solid operations need at least one object");
  }
  if (
    options.tolerance !== undefined &&
    (!Number.isFinite(options.tolerance) || options.tolerance < 0)
  ) throw new RangeError("tolerance must be nonnegative and finite");
  const m = await engine();
  const allocated: Manifold[] = [];
  const keep = (value: Manifold) => {
    allocated.push(value);
    return value;
  };
  let firstMaterial: THREE.Material | undefined;
  try {
    const inputs = objects.map((object) => {
      const parts: Manifold[] = [];
      object.updateWorldMatrix(true, true);
      object.traverse((child) => {
        if (!(child instanceof THREE.Mesh)) return;
        if (
          child instanceof THREE.SkinnedMesh ||
          child instanceof THREE.InstancedMesh ||
          Object.keys(child.geometry.morphAttributes).length
        ) {
          throw new Error(
            "Solid operations require static meshes; bake skinning, instances and morph targets first",
          );
        }
        firstMaterial ??= Array.isArray(child.material)
          ? child.material[0]
          : child.material;
        const geometry = child.geometry;
        const position = geometry.getAttribute("position");
        if (!position || !position.count) return;
        const uv = geometry.getAttribute("uv");
        const count = geometry.index?.count ?? position.count;
        if (count % 3 !== 0) {
          throw new Error("Solid geometry must contain complete triangles");
        }
        const vertices = new Float32Array(position.count * 5);
        const point = new THREE.Vector3();
        if (Math.abs(child.matrixWorld.determinant()) < 1e-15) {
          throw new Error("Solid transforms must be invertible");
        }
        for (let i = 0; i < position.count; i++) {
          point.fromBufferAttribute(position, i).applyMatrix4(
            child.matrixWorld,
          );
          vertices.set([
            point.x,
            point.y,
            point.z,
            uv?.getX(i) ?? 0,
            uv?.getY(i) ?? 0,
          ], i * 5);
        }
        if (!vertices.every(Number.isFinite)) {
          throw new Error("Solid geometry must have finite positions and UVs");
        }
        const indices = new Uint32Array(count);
        const flipped = child.matrixWorld.determinant() < 0;
        for (let i = 0; i < count; i += 3) {
          for (let k = 0; k < 3; k++) {
            const index = geometry.index?.getX(i + k) ?? i + k;
            if (
              index >= position.count || index < 0 || !Number.isInteger(index)
            ) throw new Error("Invalid solid geometry index");
            indices[i + (flipped && k ? 3 - k : k)] = index;
          }
        }
        const mesh = new m.Mesh({
          numProp: 5,
          vertProperties: vertices,
          triVerts: indices,
          tolerance: options.tolerance,
        });
        mesh.merge();
        const solid = keep(new m.Manifold(mesh));
        if (solid.status() !== "NoError") {
          throw new Error(
            `Solid geometry must be closed and manifold: ${solid.status()}`,
          );
        }
        parts.push(solid);
      });
      if (!parts.length) {
        throw new Error("Each solid input must contain nonempty meshes");
      }
      return parts.slice(1).reduce((a, b) => keep(a.add(b)), parts[0]);
    });
    const result = inputs.slice(1).reduce(
      (a, b) =>
        keep(
          kind === "union"
            ? a.add(b)
            : kind === "subtract"
            ? a.subtract(b)
            : a.intersect(b),
        ),
      inputs[0],
    );
    const output = result.getMesh();
    const positions: number[] = [], uvs: number[] = [];
    for (let i = 0; i < output.vertProperties.length; i += output.numProp) {
      positions.push(...output.vertProperties.slice(i, i + 3));
      uvs.push(output.vertProperties[i + 3], output.vertProperties[i + 4]);
    }
    let geometry = new THREE.BufferGeometry();
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
    geometry.setIndex(new THREE.BufferAttribute(output.triVerts.slice(), 1));
    if (!options.smooth && output.triVerts.length) {
      const indexed = geometry;
      geometry = indexed.toNonIndexed();
      indexed.dispose();
    }
    if (options.smooth) smoothNormals(geometry);
    else geometry.computeVertexNormals();
    return transform(
      new THREE.Mesh(geometry, options.material ?? firstMaterial ?? material()),
      options,
    );
  } finally {
    for (const solid of allocated.reverse()) solid.delete();
  }
}

/** Union closed static meshes, baking world transforms. Output has one material, UVs and new normals. */
export function union(
  objects: readonly THREE.Object3D[],
  options: SolidOptions = {},
): Promise<THREE.Mesh> {
  return booleanOperation("union", objects, options);
}
/** Cut closed static meshes out of a base; inputs remain unchanged. */
export function subtract(
  base: THREE.Object3D,
  cutters: THREE.Object3D | readonly THREE.Object3D[],
  options: SolidOptions = {},
): Promise<THREE.Mesh> {
  return booleanOperation("subtract", [
    base,
    ...(Array.isArray(cutters) ? cutters : [cutters as THREE.Object3D]),
  ], options);
}
/** Keep the shared volume of closed static meshes. */
export function intersect(
  objects: readonly THREE.Object3D[],
  options: SolidOptions = {},
): Promise<THREE.Mesh> {
  return booleanOperation("intersect", objects, options);
}
