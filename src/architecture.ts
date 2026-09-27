import {
  box,
  cylinder,
  extrude,
  group,
  type GroupOptions,
  material as makeMaterial,
  type MeshOptions,
  THREE,
} from "./prelude.ts";

/** Options shared by multi-part architectural compositions. */
export interface CompositionOptions extends GroupOptions {
  material?: THREE.Material | THREE.Material[];
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

function positive(value: number, label: string, zero = false): number {
  if (!Number.isFinite(value) || (zero ? value < 0 : value <= 0)) {
    throw new RangeError(
      `${label} must be finite and ${zero ? "nonnegative" : "positive"}`,
    );
  }
  return value;
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
    const center = opening.center ?? 0;
    if (!Number.isFinite(center)) {
      throw new RangeError("opening.center must be finite");
    }
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
  const radialSegments = options.radialSegments ?? 24;
  if (!Number.isInteger(radialSegments) || radialSegments < 3) {
    throw new RangeError("radialSegments must be an integer >= 3");
  }
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
