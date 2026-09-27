/** Editable repeated assemblies; X is width, Y is up, and Z is depth. */
import {
  box,
  extrude,
  group,
  type GroupOptions,
  material as makeMaterial,
  THREE,
} from "./prelude.ts";

export interface AssemblyOptions extends GroupOptions {
  material?: THREE.Material | THREE.Material[];
}
export interface RailingOptions extends AssemblyOptions {
  width?: number;
  height?: number;
  depth?: number;
  postWidth?: number;
  /** Includes both end posts; mutually exclusive with postSpacing. */
  postCount?: number;
  /** Maximum center-to-center post spacing. */
  postSpacing?: number;
  railCount?: 1 | 2;
  railHeight?: number;
  railMaterial?: THREE.Material | THREE.Material[];
}
export interface FenceOptions extends AssemblyOptions {
  width?: number;
  height?: number;
  depth?: number;
  slatWidth?: number;
  slatDepth?: number;
  slatCount?: number;
  /** Maximum clear gap, including the two edge gaps. */
  slatSpacing?: number;
  topProfile?: "flat" | "pointed";
  tipHeight?: number;
  railHeight?: number;
  railMaterial?: THREE.Material | THREE.Material[];
}
export interface GrilleOptions extends AssemblyOptions {
  width?: number;
  height?: number;
  depth?: number;
  frameWidth?: number;
  barWidth?: number;
  /** Interior bars only; zero omits this direction. */
  verticalCount?: number;
  horizontalCount?: number;
  /** Maximum clear opening; mutually exclusive with the corresponding count. */
  verticalSpacing?: number;
  horizontalSpacing?: number;
  barMaterial?: THREE.Material | THREE.Material[];
}
export interface LouversOptions extends AssemblyOptions {
  width?: number;
  height?: number;
  depth?: number;
  frameWidth?: number;
  count?: number;
  slatThickness?: number;
  slatDepth?: number;
  /** Rotation around X in degrees, between -90 and 90. */
  angle?: number;
  slatMaterial?: THREE.Material | THREE.Material[];
}
export interface ShelvingOptions extends AssemblyOptions {
  width?: number;
  height?: number;
  depth?: number;
  /** Shelf count; a single shelf is placed at the floor. */
  count?: number;
  thickness?: number;
  support?: "posts" | "sides";
  supportWidth?: number;
  shelfMaterial?: THREE.Material | THREE.Material[];
}
function positive(n: number, label: string) {
  if (!Number.isFinite(n) || n <= 0) {
    throw new RangeError(`${label} must be finite and positive`);
  }
  return n;
}
function count(n: number, label: string, min = 1) {
  if (!Number.isSafeInteger(n) || n < min) {
    throw new RangeError(`${label} must be a safe integer >= ${min}`);
  }
  return n;
}
function fits(condition: boolean, message: string) {
  if (!condition) throw new RangeError(message);
}
/** Equal clear gaps at both edges and between bars. */
function distributed(
  length: number,
  size: number,
  amount: number | undefined,
  spacing: number | undefined,
  fallback: number,
  label: string,
  min = 0,
) {
  fits(
    amount === undefined || spacing === undefined,
    `${label} count and spacing are mutually exclusive`,
  );
  const n = count(
    amount ?? (spacing === undefined ? fallback : Math.max(
      min,
      Math.ceil(
        (length - positive(spacing, `${label} spacing`)) / (size + spacing),
      ),
    )),
    `${label} count`,
    min,
  );
  fits(n * size < length, `${label} must leave positive clear gaps`);
  const gap = (length - n * size) / (n + 1);
  return Array.from(
    { length: n },
    (_, i) => -length / 2 + gap + size / 2 + i * (size + gap),
  );
}
function rectFrame(
  width: number,
  height: number,
  depth: number,
  border: number,
  paint: THREE.Material | THREE.Material[],
) {
  fits(
    2 * border < Math.min(width, height),
    "frameWidth must leave an opening",
  );
  return [
    box([border, height, depth], {
      name: "frame_left",
      material: paint,
      position: [-(width - border) / 2, height / 2, 0],
    }),
    box([border, height, depth], {
      name: "frame_right",
      material: paint,
      position: [(width - border) / 2, height / 2, 0],
    }),
    box([width - 2 * border, border, depth], {
      name: "frame_bottom",
      material: paint,
      position: [0, border / 2, 0],
    }),
    box([width - 2 * border, border, depth], {
      name: "frame_top",
      material: paint,
      position: [0, height - border / 2, 0],
    }),
  ];
}
/** Posts include both endpoints; top rail is flush with total height. */
export function railing(options: RailingOptions = {}): THREE.Group {
  const width = positive(options.width ?? 3, "width"),
    height = positive(options.height ?? 1, "height"),
    depth = positive(options.depth ?? 0.12, "depth");
  const postWidth = positive(options.postWidth ?? 0.1, "postWidth"),
    railHeight = positive(options.railHeight ?? 0.08, "railHeight");
  const railCount = options.railCount ?? 2;
  fits(railCount === 1 || railCount === 2, "railCount must be 1 or 2");
  fits(
    postWidth < width && railHeight * railCount < height,
    "posts and rails must fit within railing dimensions",
  );
  fits(
    options.postCount === undefined || options.postSpacing === undefined,
    "postCount and postSpacing are mutually exclusive",
  );
  const n = count(
    options.postCount ??
      Math.ceil(
          (width - postWidth) /
            positive(options.postSpacing ?? 1, "postSpacing"),
        ) + 1,
    "postCount",
    2,
  );
  const step = (width - postWidth) / (n - 1);
  fits(step > postWidth, "posts must leave positive gaps");
  const paint = options.material ?? makeMaterial();
  const parts: THREE.Object3D[] = Array.from(
    { length: n },
    (_, i) =>
      box([postWidth, height, depth], {
        name: `post_${i}`,
        material: paint,
        position: [-(width - postWidth) / 2 + step * i, height / 2, 0],
      }),
  );
  for (let i = 0; i < railCount; i++) {
    const y = i === 0 ? height - railHeight / 2 : height / 2;
    parts.push(
      box([width, railHeight, depth], {
        name: i === 0 ? "rail_top" : "rail_middle",
        material: options.railMaterial ?? paint,
        position: [0, y, 0],
      }),
    );
  }
  return group(parts, { name: "railing", ...options });
}
/** Two backing rails and equally spaced front slats; total depth includes both layers. */
export function fence(options: FenceOptions = {}): THREE.Group {
  const width = positive(options.width ?? 3, "width"),
    height = positive(options.height ?? 1.5, "height"),
    depth = positive(options.depth ?? 0.12, "depth");
  const slatWidth = positive(options.slatWidth ?? 0.18, "slatWidth"),
    slatDepth = positive(options.slatDepth ?? depth / 2, "slatDepth"),
    railHeight = positive(options.railHeight ?? 0.1, "railHeight");
  const profile = options.topProfile ?? "flat";
  fits(
    profile === "flat" || profile === "pointed",
    "topProfile must be flat or pointed",
  );
  const tip = positive(
    options.tipHeight ?? Math.min(slatWidth / 2, height / 4),
    "tipHeight",
  );
  fits(
    slatDepth < depth && railHeight < height / 4 && tip <= height / 4,
    "slats, tips and rails must fit within fence dimensions",
  );
  const xs = distributed(
    width,
    slatWidth,
    options.slatCount,
    options.slatSpacing,
    9,
    "slat",
    1,
  );
  const paint = options.material ?? makeMaterial();
  const parts: THREE.Object3D[] = xs.map((x, i) => {
    if (profile === "flat") {
      return box([slatWidth, height, slatDepth], {
        name: `slat_${i}`,
        material: paint,
        position: [x, height / 2, (depth - slatDepth) / 2],
      });
    }
    const shape = new THREE.Shape();
    shape.moveTo(-slatWidth / 2, 0);
    shape.lineTo(slatWidth / 2, 0);
    shape.lineTo(slatWidth / 2, height - tip);
    shape.lineTo(0, height);
    shape.lineTo(-slatWidth / 2, height - tip);
    shape.closePath();
    return extrude(shape, {
      name: `slat_${i}`,
      material: paint,
      depth: slatDepth,
      position: [x, 0, depth / 2 - slatDepth],
    });
  });
  for (let i = 0; i < 2; i++) {
    parts.push(
      box([width, railHeight, depth - slatDepth], {
        name: `rail_${i}`,
        material: options.railMaterial ?? paint,
        position: [0, height * (i === 0 ? 0.25 : 0.75), -slatDepth / 2],
      }),
    );
  }
  return group(parts, { name: "fence", ...options });
}
/** Rectangular frame and interior grid bars, with genuine clear openings. */
export function grille(options: GrilleOptions = {}): THREE.Group {
  const width = positive(options.width ?? 2, "width"),
    height = positive(options.height ?? 2, "height"),
    depth = positive(options.depth ?? 0.1, "depth");
  const border = positive(options.frameWidth ?? 0.1, "frameWidth"),
    bar = positive(options.barWidth ?? 0.05, "barWidth");
  const paint = options.material ?? makeMaterial(),
    barPaint = options.barMaterial ?? paint;
  const parts: THREE.Object3D[] = rectFrame(
    width,
    height,
    depth,
    border,
    paint,
  );
  const innerWidth = width - 2 * border, innerHeight = height - 2 * border;
  const xs = distributed(
    innerWidth,
    bar,
    options.verticalCount,
    options.verticalSpacing,
    4,
    "vertical",
  );
  const ys = distributed(
    innerHeight,
    bar,
    options.horizontalCount,
    options.horizontalSpacing,
    4,
    "horizontal",
  );
  xs.forEach((x, i) =>
    parts.push(
      box([bar, innerHeight, depth], {
        name: `vertical_${i}`,
        material: barPaint,
        position: [x, height / 2, 0],
      }),
    )
  );
  ys.forEach((y, i) =>
    parts.push(
      box([innerWidth, bar, depth], {
        name: `horizontal_${i}`,
        material: barPaint,
        position: [0, height / 2 + y, 0],
      }),
    )
  );
  return group(parts, { name: "grille", ...options });
}
/** Framed horizontal slats, rotated around X; rotated bounds must fit inside the frame. */
export function louvers(options: LouversOptions = {}): THREE.Group {
  const width = positive(options.width ?? 2, "width"),
    height = positive(options.height ?? 2, "height"),
    depth = positive(options.depth ?? 0.3, "depth");
  const border = positive(options.frameWidth ?? 0.1, "frameWidth"),
    thickness = positive(options.slatThickness ?? 0.04, "slatThickness"),
    slatDepth = positive(options.slatDepth ?? depth, "slatDepth");
  const n = count(options.count ?? 6, "count"), angle = options.angle ?? 45;
  fits(
    Number.isFinite(angle) && Math.abs(angle) <= 90,
    "angle must be finite and between -90 and 90 degrees",
  );
  const radians = THREE.MathUtils.degToRad(angle);
  const projectedHeight = Math.abs(Math.cos(radians)) * thickness +
    Math.abs(Math.sin(radians)) * slatDepth;
  const projectedDepth = Math.abs(Math.sin(radians)) * thickness +
    Math.abs(Math.cos(radians)) * slatDepth;
  fits(projectedDepth <= depth + 1e-12, "rotated slats must fit within depth");
  const paint = options.material ?? makeMaterial();
  const parts: THREE.Object3D[] = rectFrame(
    width,
    height,
    depth,
    border,
    paint,
  );
  const ys = distributed(
    height - 2 * border,
    projectedHeight,
    n,
    undefined,
    n,
    "slat",
    1,
  );
  ys.forEach((y, i) =>
    parts.push(
      box([width - 2 * border, thickness, slatDepth], {
        name: `slat_${i}`,
        material: options.slatMaterial ?? paint,
        position: [0, y + height / 2, 0],
        rotation: [angle, 0, 0],
      }),
    )
  );
  return group(parts, { name: "louvers", ...options });
}
/** Open shelving with four posts or two full-depth sidewalls and equally spaced shelves. */
export function shelving(options: ShelvingOptions = {}): THREE.Group {
  const width = positive(options.width ?? 2, "width"),
    height = positive(options.height ?? 2, "height"),
    depth = positive(options.depth ?? 0.5, "depth");
  const thickness = positive(options.thickness ?? 0.05, "thickness"),
    supportWidth = positive(options.supportWidth ?? 0.06, "supportWidth"),
    n = count(options.count ?? 5, "count");
  const support = options.support ?? "posts";
  fits(
    support === "posts" || support === "sides",
    "support must be posts or sides",
  );
  fits(
    2 * supportWidth < width &&
      (support !== "posts" || 2 * supportWidth < depth) &&
      n * thickness < height,
    "shelves and supports must fit with positive gaps",
  );
  const paint = options.material ?? makeMaterial();
  const parts: THREE.Object3D[] = [];
  for (let i = 0; i < 2; i++) {
    const x = (i === 0 ? -1 : 1) * (width - supportWidth) / 2;
    if (support === "sides") {
      parts.push(
        box([supportWidth, height, depth], {
          name: i === 0 ? "side_left" : "side_right",
          material: paint,
          position: [x, height / 2, 0],
        }),
      );
    } else {for (let j = 0; j < 2; j++) {
        parts.push(
          box([supportWidth, height, supportWidth], {
            name: `post_${i}_${j}`,
            material: paint,
            position: [
              x,
              height / 2,
              (j === 0 ? -1 : 1) * (depth - supportWidth) / 2,
            ],
          }),
        );
      }}
  }
  for (let i = 0; i < n; i++) {
    parts.push(
      box([width - 2 * supportWidth, thickness, depth], {
        name: `shelf_${i}`,
        material: options.shelfMaterial ?? paint,
        position: [
          0,
          thickness / 2 + (n === 1 ? 0 : i * (height - thickness) / (n - 1)),
          0,
        ],
      }),
    );
  }
  return group(parts, { name: "shelving", ...options });
}
