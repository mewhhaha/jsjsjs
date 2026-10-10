/** Architectural compositions: stairs, ramps, arches, walls, columns and gable roofs. */
import * as THREE from "three";
import {
  box,
  cylinder,
  extrude,
  group,
  type GroupOptions,
  material as makeMaterial,
  type MeshOptions,
  transform,
} from "./primitives.ts";
import { finite, integer, positive } from "./validate.ts";

/** Options shared by multi-part architectural compositions. */
export interface CompositionOptions extends GroupOptions {
  material?: THREE.Material | THREE.Material[];
}

export interface StairsOptions extends CompositionOptions {
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

export interface ArchOptions extends CompositionOptions {
  /** Clear horizontal space between the piers. Defaults to 2. */
  openingWidth?: number;
  /** Clear height from the floor to the inner crown. Defaults to 3. */
  openingHeight?: number;
  /** Front-to-back depth, centered on Z. Defaults to 0.4. */
  depth?: number;
  /** Uniform width of the piers and crown ring. Defaults to 0.25. */
  thickness?: number;
  /** Crown curve resolution; integer >= 4. Defaults to 24. */
  segments?: number;
}

export interface WallOpening {
  width: number;
  height: number;
  /** Height of the opening's bottom above the wall's floor; zero makes a door. */
  bottom?: number;
  /** Horizontal offset from the wall's center. */
  center?: number;
}
export interface WallOptions extends CompositionOptions {
  width?: number;
  height?: number;
  depth?: number;
  opening?: WallOpening;
}
export interface ColumnOptions extends CompositionOptions {
  radius?: number;
  /** Total height including base and capital. */
  height?: number;
  /** Defaults to radius * 1.4. */
  baseRadius?: number;
  /** Set to zero to omit the base. */
  baseHeight?: number;
  /** Defaults to radius * 1.4. */
  capitalRadius?: number;
  /** Set to zero to omit the capital. */
  capitalHeight?: number;
  radialSegments?: number;
}
export interface GableRoofOptions extends MeshOptions {
  width?: number;
  depth?: number;
  /** Ridge height above the eaves, excluding thickness. */
  rise?: number;
  /** Vertical thickness, not distance normal to the sloped surface. */
  thickness?: number;
}

/** Steps centered on X, starting at Z=0 and ascending toward +Z.
 * Each step is a named mesh, sharing one material. Solid columns touch without overlap.
 */
export function stairs(options: StairsOptions = {}): THREE.Group {
  const width = positive(options.width ?? 2, "width");
  const rise = positive(options.rise ?? 0.2, "rise");
  const run = positive(options.run ?? 0.3, "run");
  const steps = integer(options.steps ?? 6, 1, Infinity, "steps");
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
  const sharedMaterial = options.material ?? makeMaterial();
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
    new THREE.Mesh(geometry, options.material ?? makeMaterial()),
    options,
  );
}

/**
 * Semicircular arch with an open passage and separate named piers and crown.
 * Centered on X/Z, standing on Y=0, with its front facing +Z.
 * openingHeight must be at least openingWidth / 2; equality omits the piers.
 */
export function arch(options: ArchOptions = {}): THREE.Group {
  const width = positive(options.openingWidth ?? 2, "openingWidth");
  const height = positive(options.openingHeight ?? 3, "openingHeight");
  const depth = positive(options.depth ?? 0.4, "depth");
  const thickness = positive(options.thickness ?? 0.25, "thickness");
  const segments = integer(options.segments ?? 24, 4, Infinity, "segments");
  const radius = width / 2;
  const springHeight = height - radius;
  if (springHeight < 0) {
    throw new RangeError("openingHeight must be >= openingWidth / 2");
  }
  const paint = options.material ?? makeMaterial();
  const children: THREE.Object3D[] = [];
  if (springHeight > 0) {
    for (
      const [name, direction] of [
        ["left_pier", -1],
        ["right_pier", 1],
      ] as const
    ) {
      children.push(box([thickness, springHeight, depth], {
        name,
        position: [direction * (radius + thickness / 2), springHeight / 2, 0],
        material: paint,
      }));
    }
  }

  const profile = new THREE.Shape();
  profile.absarc(0, springHeight, radius + thickness, 0, Math.PI, false);
  profile.lineTo(-radius, springHeight);
  profile.absarc(0, springHeight, radius, Math.PI, 0, true);
  profile.closePath();
  children.push(extrude(profile, {
    name: "crown",
    depth,
    curveSegments: segments,
    position: [0, 0, -depth / 2],
    material: paint,
  }));
  return group(children, options);
}

/**
 * Wall centered in X/Z with its base at Y=0. An optional rectangular opening
 * is genuinely empty. Panels remain separate named meshes, not a fused solid.
 */
export function wall(options: WallOptions = {}): THREE.Group {
  const width = positive(options.width ?? 4, "width");
  const height = positive(options.height ?? 3, "height");
  const depth = positive(options.depth ?? 0.25, "depth");
  const parts: THREE.Object3D[] = [];
  const paint = options.material ?? makeMaterial();
  const panel = (name: string, w: number, h: number, x: number, y: number) => {
    if (h > 0) {
      parts.push(
        box([w, h, depth], { name, material: paint, position: [x, y, 0] }),
      );
    }
  };
  if (!options.opening) {
    panel("body", width, height, 0, height / 2);
  } else {
    const opening = options.opening;
    const w = positive(opening.width, "opening.width");
    const h = positive(opening.height, "opening.height");
    const bottom = positive(opening.bottom ?? 0, "opening.bottom", true);
    const center = finite(opening.center ?? 0, "opening.center");
    const left = center - w / 2;
    const right = center + w / 2;
    const top = bottom + h;
    if (left <= -width / 2 || right >= width / 2 || top > height) {
      throw new RangeError(
        "opening must fit inside wall width, with positive side panels, and not exceed wall height",
      );
    }
    const leftWidth = left + width / 2;
    const rightWidth = width / 2 - right;
    panel(
      "left_panel",
      leftWidth,
      height,
      -width / 2 + leftWidth / 2,
      height / 2,
    );
    panel(
      "right_panel",
      rightWidth,
      height,
      right + rightWidth / 2,
      height / 2,
    );
    panel("sill", w, bottom, center, bottom / 2);
    panel("lintel", w, height - top, center, top + (height - top) / 2);
  }
  return group(parts, { name: "wall", ...options });
}

/**
 * Y-up column centered in X/Z and standing at Y=0. Total height includes the
 * separately editable cylindrical base, shaft, and capital.
 */
export function column(options: ColumnOptions = {}): THREE.Group {
  const radius = positive(options.radius ?? 0.25, "radius");
  const height = positive(options.height ?? 3, "height");
  const baseRadius = positive(options.baseRadius ?? radius * 1.4, "baseRadius");
  const capitalRadius = positive(
    options.capitalRadius ?? radius * 1.4,
    "capitalRadius",
  );
  const baseHeight = positive(options.baseHeight ?? 0.15, "baseHeight", true);
  const capitalHeight = positive(
    options.capitalHeight ?? 0.15,
    "capitalHeight",
    true,
  );
  const shaftHeight = height - baseHeight - capitalHeight;
  if (shaftHeight <= 0) {
    throw new RangeError("height must exceed baseHeight + capitalHeight");
  }
  const radialSegments = integer(
    options.radialSegments ?? 24,
    3,
    Infinity,
    "radialSegments",
  );
  const paint = options.material ?? makeMaterial();
  const parts: THREE.Object3D[] = [];
  const part = (name: string, r: number, h: number, y: number) => {
    if (h > 0) {
      parts.push(
        cylinder(r, h, {
          name,
          material: paint,
          position: [0, y, 0],
          radialSegments,
        }),
      );
    }
  };
  part("base", baseRadius, baseHeight, baseHeight / 2);
  part("shaft", radius, shaftHeight, baseHeight + shaftHeight / 2);
  part("capital", capitalRadius, capitalHeight, height - capitalHeight / 2);
  return group(parts, { name: "column", ...options });
}

/**
 * Closed, constant vertical thickness roof shell with its ridge along Z.
 * X/Z are centered. Eave undersides start at Y=0, and the ridge top is
 * rise + thickness. The space beneath the slopes is empty (no filled gables).
 */
export function gableRoof(
  options: GableRoofOptions = {},
): THREE.Mesh<THREE.ExtrudeGeometry> {
  const width = positive(options.width ?? 4, "width");
  const depth = positive(options.depth ?? 3, "depth");
  const rise = positive(options.rise ?? 1, "rise");
  const thickness = positive(options.thickness ?? 0.15, "thickness");
  const shape = new THREE.Shape();
  shape.moveTo(-width / 2, 0);
  shape.lineTo(0, rise);
  shape.lineTo(width / 2, 0);
  shape.lineTo(width / 2, thickness);
  shape.lineTo(0, rise + thickness);
  shape.lineTo(-width / 2, thickness);
  shape.closePath();
  const roof = extrude(shape, {
    ...options,
    name: options.name ?? "gable_roof",
    depth,
  });
  roof.geometry.translate(0, 0, -depth / 2);
  return roof;
}
