import * as THREE from "three";
import {
  box,
  group,
  type GroupOptions,
  material,
  type MeshOptions,
  transform,
} from "./prelude.ts";

export interface StairsOptions extends GroupOptions {
  material?: THREE.Material | THREE.Material[];
  width?: number;
  /** Number of steps (a positive integer). */
  steps?: number;
  /** Height gained and depth traveled per step. */
  rise?: number;
  run?: number;
  /** Solid columns or separate floating treads. Defaults to solid. */
  style?: "solid" | "treads";
  /** Floating tread thickness; defaults to rise / 4 and cannot exceed rise. */
  treadThickness?: number;
}

export interface RampOptions extends MeshOptions {
  width?: number;
  height?: number;
  length?: number;
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and positive`);
  }
  return value;
}

/** Steps centered on X, starting at Z=0 and ascending toward +Z.
 * Each step is a named mesh, sharing one material. Solid columns touch without overlap.
 */
export function stairs(options: StairsOptions = {}): THREE.Group {
  const width = positive(options.width ?? 2, "width");
  const rise = positive(options.rise ?? 0.2, "rise");
  const run = positive(options.run ?? 0.3, "run");
  const steps = options.steps ?? 6;
  if (!Number.isSafeInteger(steps) || steps < 1) {
    throw new RangeError("steps must be a positive safe integer");
  }
  positive(steps * rise, "total rise");
  positive(steps * run, "total run");
  const style = options.style ?? "solid";
  if (style !== "solid" && style !== "treads") {
    throw new RangeError("style must be solid or treads");
  }
  const thickness = positive(
    options.treadThickness ?? rise / 4,
    "treadThickness",
  );
  if (thickness > rise) {
    throw new RangeError("treadThickness must not exceed rise");
  }
  const sharedMaterial = options.material ?? material();
  const result = group([], options);
  for (let index = 0; index < steps; index++) {
    const top = (index + 1) * rise;
    const height = style === "solid" ? top : thickness;
    result.add(box([width, height, run], {
      name: `step_${index + 1}`,
      material: sharedMaterial,
      position: [0, top - height / 2, (index + 0.5) * run],
    }));
  }
  return result;
}

/** Closed triangular wedge centered on X, with its low edge at Y=Z=0
 * and its high end at Z=length. All faces have outward normals and planar UVs.
 */
export function ramp(options: RampOptions = {}): THREE.Mesh {
  const halfWidth = positive(options.width ?? 2, "width") / 2;
  const height = positive(options.height ?? 1, "height");
  const length = positive(options.length ?? 3, "length");
  const points = [
    [-halfWidth, 0, 0],
    [halfWidth, 0, 0],
    [-halfWidth, 0, length],
    [halfWidth, 0, length],
    [-halfWidth, height, length],
    [halfWidth, height, length],
  ];
  // Bottom, high end, left side, right side, sloping top. Separate face
  // vertices keep the edges sharp, while shared positions form a closed solid.
  const faces = [
    { vertices: [0, 1, 3, 2], axes: [0, 2] },
    { vertices: [2, 3, 5, 4], axes: [0, 1] },
    { vertices: [0, 2, 4], axes: [2, 1] },
    { vertices: [1, 5, 3], axes: [2, 1] },
    { vertices: [0, 4, 5, 1], axes: [0, 2] },
  ];
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  for (const { vertices, axes } of faces) {
    const start = positions.length / 3;
    for (const vertex of vertices) {
      const point = points[vertex];
      positions.push(...point);
      uvs.push(point[axes[0]], point[axes[1]]);
    }
    for (let i = 1; i < vertices.length - 1; i++) {
      indices.push(start, start + i, start + i + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.addGroup(0, indices.length, 0);
  geometry.computeVertexNormals();
  return transform(
    new THREE.Mesh(geometry, options.material ?? material()),
    options,
  );
}
