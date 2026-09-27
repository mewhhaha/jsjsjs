/** Editable guide grooms and deterministic, renderer-independent child fibers. */
import * as THREE from "three";
import { type Strand, strandRandom } from "./strand-data.ts";

export type GroomXYZ = [number, number, number];

/** Persistent attachment data. Evaluation against an animated surface is separate. */
export interface GroomRootBinding {
  surfaceId: string;
  triangleIndex: number;
  barycentric: GroomXYZ;
  uv?: [number, number];
}

export interface GroomGuide {
  /** Stable identity; reordering other guides never changes this guide's fibers. */
  id: string;
  layer: string;
  /** A parting or other boundary. Children never interpolate across guides/regions. */
  region?: string;
  points: GroomXYZ[];
  /** Full root-to-tip strip width, either constant or one value per point. */
  width: number | number[];
  /** Outward facing direction at each point; transported frames are used if absent. */
  normals?: GroomXYZ[];
  root?: GroomRootBinding;
}

/** Independent settings for a named hair, undercoat, guard-hair, or other layer. */
export interface GroomLayer {
  id: string;
  kind?: "hair" | "undercoat" | "guard" | "flyaway";
  /** Full-density children per guide, 1–512. */
  children: number;
  radius: number;
  tipRadius?: number;
  /** Attraction to the guide toward the tip, 0–1. Default .6. */
  clump?: number;
  /** Maximum outward child offset / guide width, 0–1. Default .09; roots stay fixed. */
  depth?: number;
  /** Maximum fractional shortening, 0–1. Default .08; minimum length is 5%. */
  lengthVariation?: number;
  /** Smooth displacement amplitude in model units; roots remain attached. */
  frizz?: number;
  /** Fraction of fibers given a larger loose arc, 0–1. Default 0. */
  flyaways?: number;
  color?: string;
  tipColor?: string;
  roughness?: number;
}

/** JSON-safe source of truth; render geometry and textures are derived from this. */
export interface GuideGroom {
  version: 1;
  seed: number;
  name?: string;
  layers: GroomLayer[];
  guides: GroomGuide[];
}

export interface GroomFiber extends Strand {
  id: string;
  guideId: string;
  layer: string;
  region?: string;
  /** Source guide arc coordinates. Shorter children end before 1. */
  guideT: number[];
}

export interface GeneratedGroom {
  version: 1;
  seed: number;
  source: GuideGroom;
  strands: GroomFiber[];
}

export interface GenerateGroomOptions {
  /** Stable nested selection from 0–1. Positive values retain a child per guide. */
  density?: number;
  /** Segments per child, 1–128. Default 24. */
  segments?: number;
}

export interface GroomGuideSample {
  position: GroomXYZ;
  normal: GroomXYZ;
  side: GroomXYZ;
  tangent: GroomXYZ;
  width: number;
}

const MAX_GUIDES = 20_000;
const MAX_FIBERS = 200_000;
const MAX_SOURCE_POINTS = 2_000_000;
const MAX_GENERATED_POINTS = 4_000_000;

function object(value: unknown, fields: string[], label: string): void {
  if (
    typeof value !== "object" || value === null || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  ) throw new TypeError(`${label} must be a plain object`);
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) {
      throw new TypeError(`${label} contains unsupported field ${key}`);
    }
  }
}

function text(value: unknown, label: string): asserts value is string {
  if (
    typeof value !== "string" || value.trim().length === 0 ||
    value.length > 256 ||
    Array.from(value).some((character) => character.charCodeAt(0) < 32)
  ) {
    throw new TypeError(
      `${label} must be a nonempty string up to 256 characters`,
    );
  }
}

function number(
  value: unknown,
  min: number,
  max: number,
  label: string,
): number {
  if (
    typeof value !== "number" || !Number.isFinite(value) || value < min ||
    value > max
  ) {
    throw new RangeError(
      `${label} must be finite and between ${min} and ${max}`,
    );
  }
  return value;
}

function integer(
  value: unknown,
  min: number,
  max: number,
  label: string,
): number {
  const result = number(value, min, max, label);
  if (!Number.isInteger(result)) {
    throw new RangeError(`${label} must be an integer`);
  }
  return result;
}

function vector(value: unknown, size: number, label: string): void {
  if (!Array.isArray(value) || value.length !== size) {
    throw new TypeError(`${label} must contain ${size} finite numbers`);
  }
  for (const n of value) number(n, -1e12, 1e12, label);
}

function validateGuide(guide: GroomGuide): void {
  object(
    guide,
    ["id", "layer", "region", "points", "width", "normals", "root"],
    "guide",
  );
  text(guide.id, "guide.id");
  text(guide.layer, "guide.layer");
  if (guide.region !== undefined) text(guide.region, "guide.region");
  if (
    !Array.isArray(guide.points) || guide.points.length < 2 ||
    guide.points.length > 257
  ) throw new RangeError("Each guide needs 2–257 points");
  if (
    Array.isArray(guide.width) && guide.width.length !== guide.points.length
  ) {
    throw new RangeError("Guide widths must have one value per point");
  }
  if (
    guide.normals !== undefined &&
    (!Array.isArray(guide.normals) ||
      guide.normals.length !== guide.points.length)
  ) throw new RangeError("Guide normals must have one value per point");
  let widest = 0;
  for (let i = 0; i < guide.points.length; i++) {
    vector(guide.points[i], 3, "guide point");
    if (i && guide.points[i].every((n, k) => n === guide.points[i - 1][k])) {
      throw new RangeError("Consecutive guide points must be distinct");
    }
    if (
      i &&
      guide.points[i].reduce(
          (sum, n, k) => sum + (n - guide.points[i - 1][k]) ** 2,
          0,
        ) === 0
    ) {
      throw new RangeError(
        "Consecutive guide points are below numeric resolution",
      );
    }
    const width = Array.isArray(guide.width) ? guide.width[i] : guide.width;
    widest = Math.max(widest, number(width, 0, 1e12, "guide width"));
    if (guide.normals) {
      vector(guide.normals[i], 3, "guide normal");
      if (Math.hypot(...guide.normals[i]) < 1e-12) {
        throw new RangeError("Guide normals must be nonzero");
      }
    }
  }
  if (!(widest > 0)) throw new RangeError("Each guide needs a positive width");
  if (guide.root !== undefined) {
    object(
      guide.root,
      ["surfaceId", "triangleIndex", "barycentric", "uv"],
      "guide.root",
    );
    text(guide.root.surfaceId, "root.surfaceId");
    integer(guide.root.triangleIndex, 0, 0x7fffffff, "root.triangleIndex");
    vector(guide.root.barycentric, 3, "root.barycentric");
    guide.root.barycentric.forEach((n) => number(n, 0, 1, "root.barycentric"));
    if (
      Math.abs(guide.root.barycentric.reduce((a, b) => a + b, 0) - 1) > 1e-6
    ) {
      throw new RangeError("Root barycentric coordinates must sum to 1");
    }
    if (guide.root.uv !== undefined) vector(guide.root.uv, 2, "root.uv");
  }
}

function validateLayer(layer: GroomLayer): void {
  object(layer, [
    "id",
    "kind",
    "children",
    "radius",
    "tipRadius",
    "clump",
    "depth",
    "lengthVariation",
    "frizz",
    "flyaways",
    "color",
    "tipColor",
    "roughness",
  ], "layer");
  text(layer.id, "layer.id");
  if (
    layer.kind !== undefined &&
    !["hair", "undercoat", "guard", "flyaway"].includes(layer.kind)
  ) {
    throw new RangeError(
      "layer.kind must be hair, undercoat, guard, or flyaway",
    );
  }
  integer(layer.children, 1, 512, "layer.children");
  number(layer.radius, Number.MIN_VALUE, 1e12, "layer.radius");
  if (layer.tipRadius !== undefined) {
    number(layer.tipRadius, 0, layer.radius, "layer.tipRadius");
  }
  for (
    const key of [
      "clump",
      "depth",
      "lengthVariation",
      "flyaways",
      "roughness",
    ] as const
  ) {
    if (layer[key] !== undefined) number(layer[key], 0, 1, `layer.${key}`);
  }
  if (layer.frizz !== undefined) number(layer.frizz, 0, 1e12, "layer.frizz");
  if (layer.color !== undefined) text(layer.color, "layer.color");
  if (layer.tipColor !== undefined) text(layer.tipColor, "layer.tipColor");
}

/** Validate, copy, and detach an editable groom from the caller's arrays. */
export function createGroom(input: GuideGroom): GuideGroom {
  object(input, ["version", "seed", "name", "layers", "guides"], "groom");
  if (input.version !== 1) throw new RangeError("Groom version must be 1");
  integer(input.seed, 0, 0xffffffff, "groom.seed");
  if (input.name !== undefined) text(input.name, "groom.name");
  if (
    !Array.isArray(input.layers) || !input.layers.length ||
    input.layers.length > 128
  ) {
    throw new RangeError("A groom needs 1–128 named layers");
  }
  if (
    !Array.isArray(input.guides) || !input.guides.length ||
    input.guides.length > MAX_GUIDES
  ) {
    throw new RangeError(`A groom needs 1–${MAX_GUIDES} named guides`);
  }
  const layers = new Map<string, GroomLayer>();
  for (const layer of input.layers) {
    validateLayer(layer);
    if (layers.has(layer.id)) {
      throw new RangeError(`Duplicate layer id: ${layer.id}`);
    }
    layers.set(layer.id, layer);
  }
  const ids = new Set<string>();
  let pointCount = 0, fiberCount = 0;
  for (const guide of input.guides) {
    validateGuide(guide);
    if (ids.has(guide.id)) {
      throw new RangeError(`Duplicate guide id: ${guide.id}`);
    }
    ids.add(guide.id);
    const layer = layers.get(guide.layer);
    if (!layer) throw new RangeError(`Unknown layer: ${guide.layer}`);
    pointCount += guide.points.length;
    fiberCount += layer.children;
    if (pointCount > MAX_SOURCE_POINTS || fiberCount > MAX_FIBERS) {
      throw new RangeError(
        `Groom exceeds ${MAX_SOURCE_POINTS} source points or ${MAX_FIBERS} children`,
      );
    }
  }
  // Explicit copies preserve the public schema, omit optional undefined values,
  // and keep root attachments independent from edits to the original document.
  const result: GuideGroom = {
    version: 1,
    seed: input.seed,
    layers: input.layers.map((layer) => {
      const copy: GroomLayer = {
        id: layer.id,
        children: layer.children,
        radius: layer.radius,
      };
      if (layer.kind !== undefined) copy.kind = layer.kind;
      for (
        const key of [
          "tipRadius",
          "clump",
          "depth",
          "lengthVariation",
          "frizz",
          "flyaways",
          "roughness",
        ] as const
      ) {
        if (layer[key] !== undefined) copy[key] = layer[key];
      }
      if (layer.color !== undefined) copy.color = layer.color;
      if (layer.tipColor !== undefined) copy.tipColor = layer.tipColor;
      return copy;
    }),
    guides: input.guides.map((guide) => {
      const copy: GroomGuide = {
        id: guide.id,
        layer: guide.layer,
        points: guide.points.map((p) => [...p]),
        width: Array.isArray(guide.width) ? [...guide.width] : guide.width,
      };
      if (guide.region !== undefined) copy.region = guide.region;
      if (guide.normals) copy.normals = guide.normals.map((n) => [...n]);
      if (guide.root) {
        copy.root = {
          surfaceId: guide.root.surfaceId,
          triangleIndex: guide.root.triangleIndex,
          barycentric: [...guide.root.barycentric],
        };
        if (guide.root.uv) copy.root.uv = [...guide.root.uv];
      }
      return copy;
    }),
  };
  if (input.name !== undefined) result.name = input.name;
  return result;
}

/** Portable, validated groom document. Geometry, textures, and callbacks are excluded. */
export function serializeGroom(groom: GuideGroom): string {
  return JSON.stringify(createGroom(groom), null, 2);
}

/** Parse an editable groom document, rejecting incompatible versions and invalid data. */
export function parseGroom(json: string): GuideGroom {
  if (typeof json !== "string" || json.length > 256_000_000) {
    throw new RangeError("Groom JSON must be a string no larger than 256 MB");
  }
  return createGroom(JSON.parse(json));
}

function tuple(v: THREE.Vector3): GroomXYZ {
  return [v.x, v.y, v.z];
}

function perpendicular(
  tangent: THREE.Vector3,
  normal: THREE.Vector3,
): THREE.Vector3 {
  normal.addScaledVector(tangent, -normal.dot(tangent));
  if (normal.lengthSq() < 1e-20) {
    normal.set(
      Math.abs(tangent.z) > .9 ? 1 : 0,
      0,
      Math.abs(tangent.z) > .9 ? 0 : 1,
    );
    normal.addScaledVector(tangent, -normal.dot(tangent));
  }
  return normal.normalize();
}

/**
 * Cache an arc-length sampler for the authoring strip. The frame is shared by
 * child generation and card baking; side = normal × tangent. Input is detached.
 */
export function createGroomGuideSampler(
  guide: GroomGuide,
): (t: number) => GroomGuideSample {
  validateGuide(guide);
  const points = guide.points.map((p) => new THREE.Vector3(...p));
  const widths = Array.isArray(guide.width)
    ? [...guide.width]
    : points.map(() => guide.width as number);
  const distances = [0];
  for (let i = 1; i < points.length; i++) {
    distances.push(distances[i - 1] + points[i].distanceTo(points[i - 1]));
  }
  const length = distances.at(-1)!;
  if (!Number.isFinite(length) || !(length > 0)) {
    throw new RangeError("Guide length must be finite and positive");
  }
  const tangents = points.map((p, i) => {
    const direction = points[Math.min(i + 1, points.length - 1)].clone().sub(
      points[Math.max(0, i - 1)],
    );
    if (direction.lengthSq() < 1e-20) {
      direction.copy(i ? p : points[1]).sub(i ? points[i - 1] : p);
    }
    return direction.normalize();
  });
  const normals: THREE.Vector3[] = [];
  const rotation = new THREE.Quaternion();
  for (let i = 0; i < points.length; i++) {
    const normal = guide.normals
      ? new THREE.Vector3(...guide.normals[i])
      : i
      ? normals[i - 1].clone().applyQuaternion(
        rotation.setFromUnitVectors(tangents[i - 1], tangents[i]),
      )
      : new THREE.Vector3(0, 0, 1);
    normals.push(perpendicular(tangents[i], normal));
  }
  return (t: number): GroomGuideSample => {
    number(t, 0, 1, "guide arc coordinate");
    const distance = t * length;
    let lo = 0, hi = distances.length - 1;
    while (hi - lo > 1) {
      const middle = (lo + hi) >>> 1;
      if (distances[middle] <= distance) lo = middle;
      else hi = middle;
    }
    const u = (distance - distances[lo]) / (distances[hi] - distances[lo]);
    const tangent = tangents[lo].clone().lerp(tangents[hi], u);
    if (tangent.lengthSq() < 1e-20) tangent.copy(points[hi]).sub(points[lo]);
    tangent.normalize();
    const normal = perpendicular(
      tangent,
      normals[lo].clone().lerp(normals[hi], u),
    );
    return {
      position: tuple(points[lo].clone().lerp(points[hi], u)),
      tangent: tuple(tangent),
      normal: tuple(normal),
      side: tuple(normal.clone().cross(tangent).normalize()),
      width: widths[lo] + (widths[hi] - widths[lo]) * u,
    };
  };
}

function hash(value: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < value.length; i++) {
    h = Math.imul(h ^ value.charCodeAt(i), 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x7feb352d);
  h ^= h >>> 15;
  h = Math.imul(h, 0x846ca68b);
  return (h ^ h >>> 16) >>> 0;
}

/**
 * Derive fibers from named guide strips. Density only removes children; retained
 * IDs and paths stay identical. Partings and layer boundaries cannot be crossed
 * by interpolation because each child belongs to exactly one guide.
 */
export function generateGroomStrands(
  input: GuideGroom,
  options: GenerateGroomOptions = {},
): GeneratedGroom {
  object(options, ["density", "segments"], "generation options");
  const density = number(options.density ?? 1, 0, 1, "density");
  const segments = integer(options.segments ?? 24, 1, 128, "segments");
  const source = createGroom(input);
  const layers = new Map(source.layers.map((layer) => [layer.id, layer]));
  const count = source.guides.reduce(
    (sum, guide) =>
      sum +
      (density === 0
        ? 0
        : Math.max(1, Math.ceil(layers.get(guide.layer)!.children * density))),
    0,
  );
  if (count * (segments + 1) > MAX_GENERATED_POINTS) {
    throw new RangeError(
      `Generated groom exceeds ${MAX_GENERATED_POINTS} points; reduce density or segments`,
    );
  }
  const result: GeneratedGroom = {
    version: 1,
    seed: source.seed,
    source,
    strands: [],
  };
  if (!density) return result;
  for (const guide of source.guides) {
    const layer = layers.get(guide.layer)!;
    const sample = createGroomGuideSampler(guide);
    const selected = Array.from({ length: layer.children }, (_, index) => ({
      index,
      rank: hash(JSON.stringify([source.seed, guide.id, index, "selection"])),
    })).sort((a, b) => a.rank - b.rank || a.index - b.index)
      .slice(0, Math.max(1, Math.ceil(layer.children * density)))
      .sort((a, b) => a.index - b.index);
    for (const { index } of selected) {
      const rng = strandRandom(
        hash(JSON.stringify([source.seed, guide.id, index, "shape"])),
      );
      const rootAcross = rng() - .5;
      const length = Math.max(.05, 1 - (layer.lengthVariation ?? .08) * rng());
      const phase = rng() * Math.PI * 2;
      const frequency = 1.5 + rng() * 3;
      const depth = rng() * (layer.depth ?? .09);
      const loose = rng() < (layer.flyaways ?? 0);
      const looseSide = rng() * 2 - 1;
      const fiber: GroomFiber = {
        id: `${guide.id}:${index}`,
        guideId: guide.id,
        layer: guide.layer,
        points: [],
        radii: [],
        shade: .9 + rng() * .2,
        guideT: [],
      };
      if (guide.region !== undefined) fiber.region = guide.region;
      for (let j = 0; j <= segments; j++) {
        const t = j / segments, guideT = t * length;
        const frame = sample(guideT);
        const envelope = Math.sin(Math.PI * t);
        const attraction = 1 - (layer.clump ?? .6) * t * t * (3 - 2 * t);
        const phaseT = phase + t * frequency * Math.PI * 2;
        const frizz = (layer.frizz ?? 0) * envelope;
        const looseArc = loose
          ? frame.width * .45 * Math.sin(Math.PI * t * .85)
          : 0;
        const across = rootAcross * frame.width * attraction +
          frizz * Math.sin(phaseT) + looseArc * looseSide;
        const outward = depth * frame.width * envelope +
          frizz * .6 * Math.cos(phaseT) + looseArc * .65;
        const position: GroomXYZ = [
          frame.position[0] + frame.side[0] * across +
          frame.normal[0] * outward,
          frame.position[1] + frame.side[1] * across +
          frame.normal[1] * outward,
          frame.position[2] + frame.side[2] * across +
          frame.normal[2] * outward,
        ];
        if (
          j &&
          position.every((coordinate, k) =>
            coordinate === fiber.points[j - 1][k]
          )
        ) {
          throw new RangeError(
            `Guide ${guide.id} produces coincident child samples; increase segments or adjust its path`,
          );
        }
        fiber.points.push(position);
        fiber.radii.push(
          layer.radius +
            ((layer.tipRadius ?? 0) - layer.radius) * Math.pow(t, 1.35),
        );
        fiber.guideT.push(guideT);
      }
      result.strands.push(fiber);
    }
  }
  return result;
}
