/** CPU baking of the actual fibers of an editable guide groom. No canvas is used. */
import {
  createGroomGuideSampler,
  type GeneratedGroom,
  type GroomFiber,
  type GroomGuide,
} from "./groom-data.ts";
import type { HairCardAtlas, HairCardGuide } from "./hair-cards.ts";

export interface GroomCardBakeOptions {
  /** Source guides to bake, in atlas order. Default: every source guide. */
  guideIds?: readonly string[];
  /** Maximum atlas width, a power of two from 128 to 4096. Default 2048. */
  textureSize?: number;
  /** Tile dimensions include the transparent gutter. Defaults 32 × 64. */
  tileWidth?: number;
  tileHeight?: number;
  /** Transparent pixels around every tile. Default 2. */
  gutter?: number;
  /** Widen cards to enclose their actual fibers, with this margin. Default 1.05. */
  widthPadding?: number;
  /** Maximum total bytes for the five RGBA8 maps. Default 128 MiB. */
  maxBytes?: number;
}

export interface BakedGroomCardGuide extends HairCardGuide {
  sourceGuideId: string;
  layer: string;
  region?: string;
}

export interface GroomCardTile {
  sourceGuideId: string;
  layer: string;
  variant: number;
  fiberCount: number;
  /** Decodes depthData.R back into model units. */
  depthMin: number;
  depthMax: number;
}

export interface BakedGroomCards {
  guides: BakedGroomCardGuide[];
  atlas: HairCardAtlas;
  tiles: GroomCardTile[];
  /** Small JSON-safe metadata; pixel buffers remain in atlas rather than extras. */
  maps: {
    diffuse: { data: "data"; colorSpace: "srgb"; encoding: string };
    normal: { data: "normalData"; colorSpace: "linear"; encoding: string };
    direction: { data: "tangentData"; colorSpace: "linear"; encoding: string };
    depth: { data: "depthData"; colorSpace: "linear"; encoding: string };
    attributes: {
      data: "attributeData";
      colorSpace: "linear";
      encoding: string;
    };
  };
  report: {
    width: number;
    height: number;
    tileWidth: number;
    tileHeight: number;
    gutter: number;
    guideCount: number;
    fiberCount: number;
    /** Uncompressed CPU pixels; GPU mipmaps add approximately one third. */
    bytes: number;
    mapCount: 5;
    /** Actual occupied atlas pixels, including partial fiber coverage. */
    coveredPixels: number;
  };
}

type XYZ = readonly [number, number, number];
interface ProjectedPoint {
  x: number;
  depth: number;
  t: number;
  rootToTip: number;
  radius: number;
}
interface ProjectedFiber {
  id: string;
  shade: number;
  points: ProjectedPoint[];
}

const clamp = (x: number, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const dot = (a: XYZ, b: XYZ) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const distance = (a: XYZ, b: XYZ) =>
  Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function integer(value: number, min: number, max: number, label: string) {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new RangeError(`${label} must be an integer in [${min},${max}]`);
  }
  return value;
}

function arc(points: readonly XYZ[]) {
  const lengths = [0];
  for (let i = 1; i < points.length; i++) {
    lengths.push(lengths[i - 1] + distance(points[i], points[i - 1]));
  }
  const total = lengths.at(-1)!;
  return { total, t: lengths.map((length) => length / total) };
}

function segmentAt(times: number[], t: number) {
  let low = 0, high = times.length - 1;
  while (high - low > 1) {
    const mid = (low + high) >>> 1;
    if (times[mid] <= t) low = mid;
    else high = mid;
  }
  return Math.min(low, times.length - 2);
}

function widthAt(widths: number[], times: number[], t: number) {
  const at = segmentAt(times, t);
  return lerp(
    widths[at],
    widths[at + 1],
    clamp((t - times[at]) / (times[at + 1] - times[at])),
  );
}

function idByte(id: string) {
  let value = 2166136261;
  for (let i = 0; i < id.length; i++) {
    value = Math.imul(value ^ id.charCodeAt(i), 16777619);
  }
  return value >>> 24;
}

/** Exact box-filter coverage of a locally straight infinite strip. */
function stripCoverage(distance: number, radius: number, a: number, b: number) {
  const large = Math.max(a, b), small = Math.min(a, b);
  if (large < 1e-15) return Math.abs(distance) <= radius ? 1 : 0;
  const halfSum = (large + small) * .5;
  const halfDifference = (large - small) * .5;
  const cdf = (x: number) => {
    if (small < 1e-15) return clamp((x + large * .5) / large);
    if (x <= -halfSum) return 0;
    if (x < -halfDifference) return (x + halfSum) ** 2 / (2 * large * small);
    if (x <= halfDifference) return .5 + x / large;
    if (x < halfSum) return 1 - (halfSum - x) ** 2 / (2 * large * small);
    return 1;
  };
  return clamp(cdf(radius - distance) - cdf(-radius - distance));
}

function projectFibers(
  guide: GroomGuide,
  fibers: GroomFiber[],
  padding: number,
) {
  const sample = createGroomGuideSampler(guide);
  const sourceArc = arc(guide.points);
  const widths = guide.points.map((_, i) =>
    Array.isArray(guide.width) ? guide.width[i] : guide.width
  );
  let depthMin = Infinity, depthMax = -Infinity;
  const projected: ProjectedFiber[] = [];
  const seen = new Set<string>();
  for (const fiber of fibers) {
    if (typeof fiber.id !== "string" || !fiber.id || seen.has(fiber.id)) {
      throw new RangeError(
        "Baked fibers need unique nonempty IDs within their guide",
      );
    }
    seen.add(fiber.id);
    if (
      !Array.isArray(fiber.points) || fiber.points.length < 2 ||
      fiber.points.length > 257 ||
      fiber.radii?.length !== fiber.points.length ||
      fiber.guideT?.length !== fiber.points.length ||
      !Number.isFinite(fiber.shade) || fiber.shade < 0 || fiber.shade > 2 ||
      fiber.layer !== guide.layer
    ) throw new RangeError(`Invalid generated fiber ${fiber.id}`);
    const points: ProjectedPoint[] = [];
    for (let i = 0; i < fiber.points.length; i++) {
      const point = fiber.points[i],
        radius = fiber.radii[i],
        t = fiber.guideT[i];
      if (
        !Array.isArray(point) || point.length !== 3 ||
        !point.every(Number.isFinite) ||
        !Number.isFinite(radius) || radius < 0 ||
        !Number.isFinite(t) || t < 0 || t > 1 ||
        (i > 0 && t < fiber.guideT[i - 1]) ||
        (i > 0 && distance(point, fiber.points[i - 1]) === 0)
      ) throw new RangeError(`Invalid generated fiber point in ${fiber.id}`);
      const frame = sample(t);
      const offset: XYZ = [
        point[0] - frame.position[0],
        point[1] - frame.position[1],
        point[2] - frame.position[2],
      ];
      const x = dot(offset, frame.side), depth = dot(offset, frame.normal);
      const bound = 2 * (Math.abs(x) + radius) * padding;
      const at = segmentAt(sourceArc.t, t);
      // Expanding both endpoints encloses the complete linear segment, even
      // when a child is much shorter than the source guide.
      widths[at] = Math.max(widths[at], bound);
      widths[at + 1] = Math.max(widths[at + 1], bound);
      depthMin = Math.min(depthMin, depth - radius);
      depthMax = Math.max(depthMax, depth + radius);
      points.push({ x, depth, t, radius, rootToTip: 0 });
    }
    const fiberArc = arc(fiber.points);
    points.forEach((point, i) => point.rootToTip = fiberArc.t[i]);
    projected.push({ id: fiber.id, shade: fiber.shade, points });
  }
  if (!Number.isFinite(depthMin)) depthMin = depthMax = 0;
  const normals = sourceArc.t.map((t) =>
    [...sample(t).normal] as [number, number, number]
  );
  return { fibers: projected, widths, sourceArc, depthMin, depthMax, normals };
}

/**
 * Bake every selected clump from its generated fibers in the source guide's
 * transported frame. Each source guide receives its own texture tile. Coverage,
 * cylindrical fiber normals, direction, nearest depth and strand coordinates
 * all come from those fibers; no replacement texture strands are synthesized.
 * Pixel dimensions and bytes are checked before allocating the atlas.
 */
export function bakeGroomCards(
  generated: GeneratedGroom,
  options: GroomCardBakeOptions = {},
): BakedGroomCards {
  if (
    generated?.version !== 1 || generated.source?.version !== 1 ||
    !Array.isArray(generated.source.guides) || !Array.isArray(generated.strands)
  ) {
    throw new TypeError(
      "bakeGroomCards requires a version 1 generated guide groom",
    );
  }
  const textureSize = integer(
    options.textureSize ?? 2048,
    128,
    4096,
    "textureSize",
  );
  if ((textureSize & (textureSize - 1)) !== 0) {
    throw new RangeError("textureSize must be a power of two");
  }
  const tileWidth = integer(options.tileWidth ?? 32, 8, 1024, "tileWidth");
  const tileHeight = integer(options.tileHeight ?? 64, 8, 4096, "tileHeight");
  const gutter = integer(options.gutter ?? 2, 1, 64, "gutter");
  if (
    tileWidth - gutter * 2 < 3 || tileHeight - gutter * 2 < 3 ||
    tileWidth > textureSize
  ) {
    throw new RangeError(
      "Tiles need at least 3 × 3 inner pixels and must fit textureSize",
    );
  }
  const padding = options.widthPadding ?? 1.05;
  if (!Number.isFinite(padding) || padding < 1 || padding > 4) {
    throw new RangeError("widthPadding must be in [1,4]");
  }
  const maxBytes = integer(
    options.maxBytes ?? 128 * 1024 * 1024,
    1,
    512 * 1024 * 1024,
    "maxBytes",
  );
  const byId = new Map<string, GroomGuide>();
  for (const guide of generated.source.guides) {
    if (byId.has(guide.id)) {
      throw new RangeError(`Duplicate source guide ID: ${guide.id}`);
    }
    byId.set(guide.id, guide);
  }
  const ids = options.guideIds ??
    generated.source.guides.map((guide) => guide.id);
  if (
    !Array.isArray(ids) || ids.length < 1 || ids.length > 20_000 ||
    new Set(ids).size !== ids.length
  ) {
    throw new RangeError("Bake needs 1–20000 unique source guide IDs");
  }
  const sources = ids.map((id) => {
    const guide = byId.get(id);
    if (!guide) throw new RangeError(`Unknown source guide ID: ${id}`);
    // Validate all selected guide frames before allocating the maps.
    createGroomGuideSampler(guide);
    return guide;
  });
  const desiredWidth = 2 **
    Math.ceil(Math.log2(Math.sqrt(ids.length * tileWidth * tileHeight)));
  const columns = Math.max(
    1,
    Math.min(
      ids.length,
      Math.floor(Math.min(textureSize, desiredWidth) / tileWidth),
    ),
  );
  const width = columns * tileWidth;
  const height = Math.ceil(ids.length / columns) * tileHeight;
  const bytes = width * height * 4 * 5;
  if (height > 4096 || bytes > maxBytes) {
    throw new RangeError(
      `Groom card atlas needs ${width} × ${height} pixels and ${bytes} bytes; reduce guides/tile size or raise maxBytes (height limit 4096)`,
    );
  }
  const groups = new Map(ids.map((id) => [id, [] as GroomFiber[]]));
  let pointCount = 0;
  for (const fiber of generated.strands) {
    const group = groups.get(fiber.guideId);
    if (group) {
      if (!Array.isArray(fiber.points)) {
        throw new RangeError("Generated fibers need points");
      }
      pointCount += fiber.points.length;
      if (pointCount > 8_000_000) {
        throw new RangeError("Groom card bake exceeds 8000000 fiber points");
      }
      group.push(fiber);
    }
  }
  const data = new Uint8Array(width * height * 4);
  const normalData = new Uint8Array(data.length);
  const tangentData = new Uint8Array(data.length);
  const depthData = new Uint8Array(data.length);
  const attributeData = new Uint8Array(data.length);
  // Dilated neutral RGB under transparent texels prevents black filter fringes.
  for (let at = 0; at < data.length; at += 4) {
    data[at] = data[at + 1] = data[at + 2] = 255;
    normalData[at] = normalData[at + 1] = 128;
    normalData[at + 2] = 255;
    tangentData[at] = 128;
    tangentData[at + 1] = tangentData[at + 2] = 255;
  }
  const atlas: HairCardAtlas = {
    width,
    height,
    data,
    normalData,
    tangentData,
    depthData,
    attributeData,
    tiles: [],
  };
  const guides: BakedGroomCardGuide[] = [];
  const tiles: GroomCardTile[] = [];
  const innerWidth = tileWidth - gutter * 2 - 1;
  const innerHeight = tileHeight - gutter * 2 - 1;
  // Resolve the union of one fiber's segments first. Adding each segment's
  // opacity independently would make dark beads at every shared vertex.
  const fiberCoverage = new Float32Array(tileWidth * tileHeight);
  const fiberPixels = new Uint8Array(tileWidth * tileHeight * 7);
  let fiberCount = 0;
  for (let variant = 0; variant < sources.length; variant++) {
    const source = sources[variant];
    const fibers = groups.get(source.id)!;
    fibers.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
    const projected = projectFibers(source, fibers, padding);
    const ox = (variant % columns) * tileWidth + gutter;
    const oy = Math.floor(variant / columns) * tileHeight + gutter;
    atlas.tiles.push({
      u0: (ox + .5) / width,
      v0: (oy + .5) / height,
      u1: (ox + innerWidth + .5) / width,
      v1: (oy + innerHeight + .5) / height,
    });
    guides.push({
      sourceGuideId: source.id,
      layer: source.layer,
      ...(source.region === undefined ? {} : { region: source.region }),
      points: source.points.map((point) =>
        [...point] as [number, number, number]
      ),
      normals: projected.normals,
      width: projected.widths,
      shade: 1,
      variant,
    });
    tiles.push({
      sourceGuideId: source.id,
      layer: source.layer,
      variant,
      fiberCount: fibers.length,
      depthMin: projected.depthMin,
      depthMax: projected.depthMax,
    });
    fiberCount += fibers.length;
    const depthRange = Math.max(1e-12, projected.depthMax - projected.depthMin);
    const alongScale = innerHeight / projected.sourceArc.total;
    for (const fiber of projected.fibers) {
      const hash = idByte(fiber.id);
      const touched: number[] = [];
      for (let segment = 1; segment < fiber.points.length; segment++) {
        const a = fiber.points[segment - 1], b = fiber.points[segment];
        const wa = Math.max(
          1e-12,
          widthAt(projected.widths, projected.sourceArc.t, a.t),
        );
        const wb = Math.max(
          1e-12,
          widthAt(projected.widths, projected.sourceArc.t, b.t),
        );
        const ax = ox + (.5 + a.x / wa) * innerWidth;
        const ay = oy + a.t * innerHeight;
        const bx = ox + (.5 + b.x / wb) * innerWidth;
        const by = oy + b.t * innerHeight;
        const dx = bx - ax, dy = by - ay;
        // Cards have very different pixels-per-unit across and along a lock.
        // A pixel-space closest point would miss slanted/frizzy fibers after
        // converting its residual back to model units. Minimize that residual
        // in physical space from the start.
        const metricScaleX = innerWidth / ((wa + wb) * .5);
        const metricDx = dx / metricScaleX, metricDy = dy / alongScale;
        const lengthSquared = metricDx * metricDx + metricDy * metricDy;
        const physicalDx = b.x - a.x;
        const physicalDy = (b.t - a.t) * projected.sourceArc.total;
        const physicalLength = Math.hypot(physicalDx, physicalDy);
        const tx = physicalLength > 1e-12 ? physicalDx / physicalLength : 0;
        const ty = physicalLength > 1e-12 ? physicalDy / physicalLength : 1;
        const radius = Math.max(a.radius, b.radius);
        if (radius <= 0) continue;
        const pixelsAcross = innerWidth / Math.min(wa, wb);
        const maxRx = radius * pixelsAcross;
        const maxRy = radius * alongScale;
        const left = Math.max(ox, Math.floor(Math.min(ax, bx) - maxRx - .5));
        const right = Math.min(
          ox + innerWidth,
          Math.ceil(Math.max(ax, bx) + maxRx + .5),
        );
        const bottom = Math.max(oy, Math.floor(Math.min(ay, by) - maxRy - .5));
        const top = Math.min(
          oy + innerHeight,
          Math.ceil(Math.max(ay, by) + maxRy + .5),
        );
        for (let py = bottom; py <= top; py++) {
          for (let px = left; px <= right; px++) {
            const s = lengthSquared > 1e-12
              ? clamp(
                ((px - ax) / metricScaleX * metricDx +
                  (py - ay) / alongScale * metricDy) / lengthSquared,
              )
              : 0;
            const localRadius = lerp(a.radius, b.radius, s);
            const localWidth = lerp(wa, wb, s);
            const scaleX = innerWidth / localWidth;
            const ex = (px - lerp(ax, bx, s)) / scaleX;
            const ey = (py - lerp(ay, by, s)) / alongScale;
            const perpendicular = -ty * ex + tx * ey;
            const radialDistance = Math.hypot(ex, ey);
            const pixelRadius = Math.hypot(ty / scaleX, tx / alongScale) * .5;
            let coverage = stripCoverage(
              perpendicular,
              localRadius,
              Math.abs(ty) / scaleX,
              Math.abs(tx) / alongScale,
            );
            if (s === 0 || s === 1) {
              coverage = Math.min(
                coverage,
                clamp(
                  (localRadius + pixelRadius - radialDistance) /
                    Math.max(pixelRadius * 2, 1e-12),
                ),
              );
            }
            if (coverage <= 0) continue;
            const local = (py - oy) * tileWidth + px - ox;
            const first = fiberCoverage[local] === 0;
            if (first) touched.push(local);
            const pixel = local * 7;
            const lateral = clamp(
              perpendicular / Math.max(localRadius, 1e-12),
              -1,
              1,
            );
            const nz = Math.sqrt(Math.max(0, 1 - lateral * lateral));
            const outwardDepth = lerp(a.depth, b.depth, s) + localRadius * nz;
            const encodedDepth = Math.round(
              clamp((outwardDepth - projected.depthMin) / depthRange) * 255,
            );
            fiberCoverage[local] = Math.max(fiberCoverage[local], coverage);
            if (first || encodedDepth >= fiberPixels[pixel + 5]) {
              fiberPixels[pixel] = Math.round(
                ((-ty * lateral) * .5 + .5) * 255,
              );
              fiberPixels[pixel + 1] = Math.round(
                ((tx * lateral) * .5 + .5) * 255,
              );
              fiberPixels[pixel + 2] = Math.round((nz * .5 + .5) * 255);
              fiberPixels[pixel + 3] = Math.round((tx * .5 + .5) * 255);
              fiberPixels[pixel + 4] = Math.round((ty * .5 + .5) * 255);
              fiberPixels[pixel + 5] = encodedDepth;
              fiberPixels[pixel + 6] = Math.round(
                lerp(a.rootToTip, b.rootToTip, s) * 255,
              );
            }
          }
        }
      }
      for (const local of touched) {
        const px = ox + local % tileWidth,
          py = oy + Math.floor(local / tileWidth);
        const at = (py * width + px) * 4, pixel = local * 7;
        const coverage = fiberCoverage[local], old = data[at + 3] / 255;
        const combined = coverage + old * (1 - coverage);
        const inFront = old === 0 || fiberPixels[pixel + 5] >= depthData[at];
        const shade = Math.round(clamp(fiber.shade) * 255);
        const weight = inFront ? coverage : coverage * (1 - old);
        for (let channel = 0; channel < 3; channel++) {
          data[at + channel] = Math.round(
            (shade * weight + data[at + channel] * (combined - weight)) /
              combined,
          );
        }
        const alpha = Math.round(combined * 255);
        data[at + 3] =
          normalData[at + 3] =
          tangentData[at + 3] =
          depthData[at + 3] =
          attributeData[at + 3] =
            alpha;
        attributeData[at + 2] = alpha;
        if (inFront) {
          normalData.set(fiberPixels.subarray(pixel, pixel + 3), at);
          tangentData.set(fiberPixels.subarray(pixel + 3, pixel + 5), at);
          depthData[at] =
            depthData[at + 1] =
            depthData[at + 2] =
              fiberPixels[pixel + 5];
          attributeData[at] = fiberPixels[pixel + 6];
          attributeData[at + 1] = hash;
        }
        fiberCoverage[local] = 0;
      }
    }
  }
  let coveredPixels = 0;
  for (let at = 3; at < data.length; at += 4) if (data[at]) coveredPixels++;
  return {
    guides,
    atlas,
    tiles,
    maps: {
      diffuse: {
        data: "data",
        colorSpace: "srgb",
        encoding: "RGB fiber shade multiplier; A coverage",
      },
      normal: {
        data: "normalData",
        colorSpace: "linear",
        encoding:
          "RGB cylinder normal in card tangent space, [-1,1] encoded as [0,1]; A coverage",
      },
      direction: {
        data: "tangentData",
        colorSpace: "linear",
        encoding:
          "RG normalized side/along fiber direction, [-1,1] encoded as [0,1]; B anisotropy strength; A coverage",
      },
      depth: {
        data: "depthData",
        colorSpace: "linear",
        encoding:
          "R closest outward fiber depth, normalized between tile.depthMin and tile.depthMax; A coverage",
      },
      attributes: {
        data: "attributeData",
        colorSpace: "linear",
        encoding:
          "R actual fiber root-to-tip coordinate; G stable fiber ID hash; B/A coverage",
      },
    },
    report: {
      width,
      height,
      tileWidth,
      tileHeight,
      gutter,
      guideCount: guides.length,
      fiberCount,
      bytes,
      mapCount: 5,
      coveredPixels,
    },
  };
}
