/** Capture directions and atlas metadata for Y-up octahedral imposters. */
import type { Vector3Tuple } from "three";

export type ImposterUV = [number, number];
export type ImposterCoverage = 180 | 360;

export interface ImposterOptions {
  /** 180 captures the upper hemisphere; 360 includes the bottom. Default 180. */
  coverage?: ImposterCoverage;
  /** Odd number of rows and columns, from 3 through 33. Default 9. */
  grid?: number;
  /** Tile width and height including its transparent gutter. Default 256. */
  tileSize?: number;
  /** Transparent pixels on each edge, inside each tile. Default 2. */
  gutter?: number;
  /** Multiplier on the shared bounding-sphere framing, from 1 to 4. Default 1.05. */
  padding?: number;
}

export interface ResolvedImposterOptions {
  coverage: ImposterCoverage;
  grid: number;
  tileSize: number;
  gutter: number;
  padding: number;
}

export interface ImposterRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImposterTile {
  index: number;
  row: number;
  col: number;
  /** Endpoint lattice coordinates; these are NOT texture pixel coordinates. */
  octUV: ImposterUV;
  /** Unit vector pointing from the model center toward the camera. */
  direction: Vector3Tuple;
  /** Orthonormal camera basis, with direction pointing backward from the camera. */
  up: Vector3Tuple;
  right: Vector3Tuple;
  /** Whole tile, in pixels from the atlas's top-left corner. */
  rect: ImposterRect;
  /** Rendered square excluding transparent gutters, in atlas pixels. */
  contentRect: ImposterRect;
  /** contentRect divided by atlas dimensions; origin is TOP LEFT, v increases down. */
  uvRect: ImposterRect;
}

export interface ImposterManifest {
  format: "threejs-octahedral-imposter";
  version: 1;
  options: ResolvedImposterOptions;
  atlas: { width: number; height: number; origin: "top-left" };
  /** World-space center of the shared capture bounding sphere and camera target. */
  center: Vector3Tuple;
  radius: number;
  orthographic: { width: number; height: number };
  conventions: {
    worldUp: "+Y";
    direction: "target-to-camera";
    textureOrigin: "top-left";
    lattice: "endpoints";
    projection: "orthographic";
    mapping: string;
    cameraBasis: string;
    uvSampling: string;
  };
  tiles: ImposterTile[];
}

export function resolveImposterOptions(
  options: ImposterOptions = {},
): ResolvedImposterOptions {
  const resolved = {
    coverage: options.coverage ?? 180,
    grid: options.grid ?? 9,
    tileSize: options.tileSize ?? 256,
    gutter: options.gutter ?? 2,
    padding: options.padding ?? 1.05,
  };
  checkCoverage(resolved.coverage);
  if (
    !Number.isInteger(resolved.grid) || resolved.grid < 3 ||
    resolved.grid > 33 || resolved.grid % 2 !== 1
  ) {
    throw new Error("Imposter grid must be an odd integer from 3 through 33");
  }
  if (
    !Number.isInteger(resolved.tileSize) || resolved.tileSize < 16 ||
    resolved.tileSize > 2048
  ) {
    throw new Error(
      "Imposter tileSize must be an integer from 16 through 2048",
    );
  }
  if (
    !Number.isInteger(resolved.gutter) || resolved.gutter < 0 ||
    resolved.gutter * 2 >= resolved.tileSize
  ) {
    throw new Error(
      "Imposter gutter must be a nonnegative integer smaller than half tileSize",
    );
  }
  if (
    !Number.isFinite(resolved.padding) || resolved.padding < 1 ||
    resolved.padding > 4
  ) {
    throw new Error("Imposter padding must be from 1 through 4");
  }
  if (resolved.grid * resolved.tileSize > 8192) {
    throw new Error("Imposter atlas cannot exceed 8192 pixels per side");
  }
  return resolved;
}

function checkCoverage(coverage: ImposterCoverage) {
  if (coverage !== 180 && coverage !== 360) {
    throw new Error("Imposter coverage must be 180 or 360");
  }
}

function signNonZero(value: number): number {
  return value < 0 ? -1 : 1;
}

function normalize(vector: readonly number[]): Vector3Tuple {
  if (vector.length !== 3 || !vector.every(Number.isFinite)) {
    throw new Error("Imposter direction must contain three finite numbers");
  }
  const length = Math.hypot(...vector);
  if (!Number.isFinite(length) || length === 0) {
    throw new Error("Imposter direction must have finite nonzero length");
  }
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}

/** Decode a square lattice position to an outward, unit camera direction. */
export function decodeImposterDirection(
  octUV: readonly [number, number],
  coverage: ImposterCoverage = 180,
): Vector3Tuple {
  checkCoverage(coverage);
  if (
    octUV.length !== 2 ||
    !octUV.every((value) => Number.isFinite(value) && value >= 0 && value <= 1)
  ) {
    throw new Error("Imposter octUV must contain two numbers in [0, 1]");
  }
  const a = octUV[0] * 2 - 1;
  const b = octUV[1] * 2 - 1;
  let x = coverage === 180 ? (a + b) / 2 : a;
  let z = coverage === 180 ? (b - a) / 2 : b;
  // The hemisphere's square boundary is exactly the horizon. Preserve this
  // even when division by a non-power-of-two lattice size introduces roundoff.
  const y = coverage === 180 && (Math.abs(a) === 1 || Math.abs(b) === 1)
    ? 0
    : 1 - Math.abs(x) - Math.abs(z);
  if (coverage === 360 && y < 0) {
    const originalX = x;
    x = (1 - Math.abs(z)) * signNonZero(originalX);
    z = (1 - Math.abs(originalX)) * signNonZero(z);
  }
  return normalize([x, y, z]);
}

/** Encode an outward direction; 180 coverage rejects below-horizon directions. */
export function encodeImposterDirection(
  direction: readonly [number, number, number],
  coverage: ImposterCoverage = 180,
): ImposterUV {
  checkCoverage(coverage);
  const unit = normalize(direction);
  if (coverage === 180 && unit[1] < 0) {
    throw new Error(
      "180-degree imposters cannot encode below-horizon directions",
    );
  }
  const length = Math.abs(unit[0]) + Math.abs(unit[1]) + Math.abs(unit[2]);
  let x = unit[0] / length;
  let z = unit[2] / length;
  if (coverage === 180) {
    return [(x - z + 1) / 2, (x + z + 1) / 2];
  }
  if (unit[1] < 0) {
    const originalX = x;
    x = (1 - Math.abs(z)) * signNonZero(originalX);
    z = (1 - Math.abs(originalX)) * signNonZero(z);
  }
  return [(x + 1) / 2, (z + 1) / 2];
}

function cross(a: Vector3Tuple, b: Vector3Tuple): Vector3Tuple {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

export function makeImposterLayout(
  options: ImposterOptions,
  center: readonly [number, number, number],
  radius: number,
): ImposterManifest {
  const resolved = resolveImposterOptions(options);
  if (center.length !== 3 || !center.every(Number.isFinite)) {
    throw new Error("Imposter center must contain three finite numbers");
  }
  if (!Number.isFinite(radius) || radius <= 0) {
    throw new Error("Imposter radius must be positive and finite");
  }
  const { grid, tileSize, gutter, coverage, padding } = resolved;
  const atlasSize = grid * tileSize;
  const tiles: ImposterTile[] = [];
  for (let row = 0; row < grid; row++) {
    for (let col = 0; col < grid; col++) {
      const octUV: ImposterUV = [col / (grid - 1), row / (grid - 1)];
      const direction = decodeImposterDirection(octUV, coverage);
      const seedUp: Vector3Tuple = Math.abs(direction[1]) > 0.999999
        ? [0, 0, -1]
        : [0, 1, 0];
      const right = normalize(cross(seedUp, direction));
      const up = normalize(cross(direction, right));
      const rect = {
        x: col * tileSize,
        y: row * tileSize,
        width: tileSize,
        height: tileSize,
      };
      const contentRect = {
        x: rect.x + gutter,
        y: rect.y + gutter,
        width: tileSize - 2 * gutter,
        height: tileSize - 2 * gutter,
      };
      tiles.push({
        index: row * grid + col,
        row,
        col,
        octUV,
        direction,
        right,
        up,
        rect,
        contentRect,
        uvRect: {
          x: contentRect.x / atlasSize,
          y: contentRect.y / atlasSize,
          width: contentRect.width / atlasSize,
          height: contentRect.height / atlasSize,
        },
      });
    }
  }
  const extent = radius * padding * 2;
  if (!Number.isFinite(extent)) {
    throw new Error("Imposter capture extent must be finite");
  }
  return {
    format: "threejs-octahedral-imposter",
    version: 1,
    options: resolved,
    atlas: { width: atlasSize, height: atlasSize, origin: "top-left" },
    center: [...center],
    radius,
    orthographic: { width: extent, height: extent },
    conventions: {
      worldUp: "+Y",
      direction: "target-to-camera",
      textureOrigin: "top-left",
      lattice: "endpoints",
      projection: "orthographic",
      mapping: coverage === 180
        ? "a=2u-1; b=2v-1; x=(a+b)/2; z=(b-a)/2; y=1-|x|-|z|; direction=normalize(x,y,z)"
        : "a=2u-1; b=2v-1; x=a; z=b; y=1-|x|-|z|; if y<0: (x,z)=((1-|z|)*signNonZero(x),(1-|x|)*signNonZero(z)); direction=normalize(x,y,z)",
      cameraBasis:
        "right=normalize(seedUp cross direction); up=direction cross right; seedUp=+Y except |direction.y|>0.999999 uses -Z",
      uvSampling:
        "uvRect has top-left origin and v increases down; sample pixel centers within contentRect; convert v for bottom-left texture conventions",
    },
    tiles,
  };
}
