/** Exportable alpha-masked hair cards with deterministic strand atlases. */
import * as THREE from "three";
import { mulberry32 } from "../random.ts";

export interface HairCardGuide {
  /** Ordered centerline points, from the scalp to the tip. */
  points: [number, number, number][];
  /** Full card width; a per-point array can taper or widen a lock. */
  width: number | number[];
  /** Outward-facing normals, one per point. Defaults to a radial head frame. */
  normals?: [number, number, number][];
  /** Increasing source arc coordinates in [0,1], one per point; retains baked UVs through LOD resampling. */
  arcT?: number[];
  /** Additional diffuse brightness, in [0,2]. Default 1. */
  shade?: number;
  /** Atlas tile index. Omit to choose deterministically. */
  variant?: number;
}

export interface HairCardAtlasOptions {
  seed?: number;
  /** Atlas width, a power of two from 128 to 1024; height is twice this. */
  textureSize?: number;
  /** Relative fiber count, .1–2. Default 1. */
  density?: number;
  /** Soft root fraction of card length, 0–.2. Default .015. */
  rootFade?: number;
}

export interface HairCardOptions extends HairCardAtlasOptions {
  /** A baked atlas. Omit to generate the eight procedural example tiles. */
  atlas?: HairCardAtlas;
  /** Shared material; supported texture slots receive this atlas. */
  material?: THREE.Material;
  color?: THREE.ColorRepresentation;
  tipColor?: THREE.ColorRepresentation;
  roughness?: number;
  name?: string;
  /** Per-card brightness variation, 0–1. Default .12. */
  colorVariation?: number;
  /** Inward edge curvature as a fraction of full width, 0–.5. Default 0. */
  camber?: number;
  /** Cross-section subdivisions, 1–8. Default 4 with camber, otherwise 1. */
  widthSegments?: number;
}

export interface HairCardAtlas {
  width: number;
  height: number;
  /** Straight-alpha, sRGB diffuse pixels. Roots are at each tile's lower V. */
  data: Uint8Array;
  /** Linear tangent-space fiber normals, with opaque alpha. */
  normalData: Uint8Array;
  /** Linear RG fiber direction in the card side/along frame; B strength, A coverage. */
  tangentData?: Uint8Array;
  /** Linear R outward depth, normalized per tile; A coverage. */
  depthData?: Uint8Array;
  /** Linear R root-to-tip, G stable fiber ID, B/A coverage. */
  attributeData?: Uint8Array;
  /** UV rectangles include neither neighboring tiles nor the transparent gutter. */
  tiles: { u0: number; v0: number; u1: number; v1: number }[];
}

const VARIANTS = 8;
const clamp = (x: number, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const smooth = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};

function atlasSettings(options: HairCardAtlasOptions) {
  const size = options.textureSize ?? 1024;
  const seed = options.seed ?? 1;
  const density = options.density ?? 1;
  const rootFade = options.rootFade ?? .015;
  if (
    !Number.isInteger(size) || size < 128 || size > 1024 ||
    (size & (size - 1)) !== 0
  ) {
    throw new RangeError("textureSize must be a power of two from 128 to 1024");
  }
  if (!Number.isSafeInteger(seed)) {
    throw new RangeError("Hair card seed must be a safe integer");
  }
  if (!Number.isFinite(density) || density < .1 || density > 2) {
    throw new RangeError("Hair card density must be in [.1,2]");
  }
  if (!Number.isFinite(rootFade) || rootFade < 0 || rootFade > .2) {
    throw new RangeError("Hair card rootFade must be in [0,.2]");
  }
  return { size, seed, density, rootFade };
}

/**
 * Generate eight fine-fiber textures without a canvas or DOM. Each tile has a
 * soft root, a dense irregular core, isolated edge fibers and staggered tips.
 * RGB stays unassociated with alpha, preventing dark texture-filtering fringes.
 */
export function createHairCardAtlas(
  options: HairCardAtlasOptions = {},
): HairCardAtlas {
  const { size, seed, density, rootFade } = atlasSettings(options);
  const width = size, height = size * 2;
  const data = new Uint8Array(width * height * 4);
  const normalData = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = data[i + 1] = data[i + 2] = 230;
    normalData[i] = normalData[i + 1] = 128;
    normalData[i + 2] = normalData[i + 3] = 255;
  }
  const tileWidth = width / 4, tileHeight = height / 2;
  const gutter = Math.max(2, Math.round(width / 256));
  const innerWidth = tileWidth - gutter * 2 - 1;
  const innerHeight = tileHeight - gutter * 2 - 1;
  const tiles: HairCardAtlas["tiles"] = [];
  for (let variant = 0; variant < VARIANTS; variant++) {
    const rng = mulberry32(seed ^ Math.imul(variant + 1, 0x9E3779B1));
    const ox = (variant % 4) * tileWidth + gutter;
    const oy = Math.floor(variant / 4) * tileHeight + gutter;
    tiles.push({
      u0: (ox + .5) / width,
      v0: (oy + .5) / height,
      u1: (ox + innerWidth + .5) / width,
      v1: (oy + innerHeight + .5) / height,
    });
    // Density changes fiber count, rather than filling a rectangle under them.
    const count = Math.max(
      8,
      Math.round(innerWidth * (.59 + rng() * .08) * density),
    );
    const drift = (rng() - .5) * .09;
    const bend = (rng() - .5) * .06;
    const phase = rng() * Math.PI * 2;
    for (let fiber = 0; fiber < count; fiber++) {
      const rootX = .035 + ((fiber + .15 + rng() * .7) / count) * .93;
      const edge = Math.abs(rootX - .5) * 2;
      const start = rng() * rootFade * .45;
      // Each fiber reaches full coverage at a different distance. A shared
      // transition would stamp a straight seam across every overlapping card.
      const rootEnd = rootFade * .58 + start * (.42 / .45);
      const end = .66 + Math.pow(rng(), .35) * .33;
      const sway = (rng() - .5) * .023;
      const wave = .002 + rng() * .005;
      const fiberPhase = rng() * Math.PI * 2;
      const brightness = .71 + rng() * .29;
      const opacity = (.78 + rng() * .22) * (1 - .16 * edge * edge);
      // Width scales with resolution, retaining the same density in small atlases.
      const radius = (innerWidth / 247) * (.58 + rng() * .58);
      const firstY = Math.ceil(start * innerHeight);
      const lastY = Math.floor(end * innerHeight);
      for (let y = firstY; y <= lastY; y++) {
        const t = y / innerHeight;
        const s = (t - start) / (end - start);
        const core = 1 - .06 * Math.sin(t * Math.PI);
        const center = .5 + (rootX - .5) * core + drift * t +
          bend * Math.sin(Math.PI * t) +
          sway * Math.sin(Math.PI * s) +
          wave * Math.sin(s * Math.PI * 2.2 + fiberPhase) *
            Math.sin(Math.PI * s) +
          .003 * Math.sin(t * Math.PI * 4 + phase);
        const x = ox + clamp(center, .015, .985) * innerWidth;
        const taper = 1 - .85 * smooth(.68, 1, s);
        const r = radius * taper;
        const fade = (rootFade > 0 ? smooth(start, rootEnd, t) : 1) *
          (1 - smooth(end - .055, end, t));
        // Sparse edges stay wispy, even where many layers cover the core.
        const edgeFade = 1 - .32 * smooth(.75, 1, edge);
        const shade = brightness * (1 - .055 * Math.sin(s * 12 + fiberPhase));
        const left = Math.max(ox, Math.floor(x - r - .5));
        const right = Math.min(ox + innerWidth, Math.ceil(x + r + .5));
        for (let px = left; px <= right; px++) {
          const dx = px - x;
          const a = clamp(r + .5 - Math.abs(dx)) * fade * opacity * edgeFade;
          if (a <= 0) continue;
          const at = ((oy + y) * width + px) * 4;
          const oldAlpha = data[at + 3] / 255;
          const combined = a + oldAlpha * (1 - a);
          const oldWeight = oldAlpha * (1 - a);
          const color = (shade * 255 * a + data[at] * oldWeight) / combined;
          data[at] = data[at + 1] = data[at + 2] = Math.round(color);
          data[at + 3] = Math.round(combined * 255);
          const nx = clamp(dx / Math.max(r, .05), -1, 1) * .62;
          const nz = Math.sqrt(1 - nx * nx);
          normalData[at] = Math.round(
            ((nx * .5 + .5) * 255 * a + normalData[at] * oldWeight) /
              combined,
          );
          normalData[at + 2] = Math.round(
            ((nz * .5 + .5) * 255 * a + normalData[at + 2] * oldWeight) /
              combined,
          );
        }
      }
    }
  }
  return { width, height, data, normalData, tiles };
}

function texture(
  atlas: HairCardAtlas,
  pixels: Uint8Array,
  name: string,
  color = false,
): THREE.DataTexture {
  const result = new THREE.DataTexture(
    pixels,
    atlas.width,
    atlas.height,
    THREE.RGBAFormat,
    THREE.UnsignedByteType,
  );
  result.name = name;
  result.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  result.magFilter = THREE.LinearFilter;
  result.minFilter = THREE.LinearMipmapLinearFilter;
  result.generateMipmaps = true;
  result.anisotropy = 8;
  result.needsUpdate = true;
  return result;
}

export interface HairCardTextures {
  map: THREE.DataTexture;
  normalMap: THREE.DataTexture;
  anisotropyMap?: THREE.DataTexture;
  depthMap?: THREE.DataTexture;
  attributeMap?: THREE.DataTexture;
}

const textureCache = new WeakMap<HairCardAtlas, HairCardTextures>();

function validateAtlas(atlas: HairCardAtlas) {
  if (
    !Number.isInteger(atlas.width) || !Number.isInteger(atlas.height) ||
    atlas.width < 1 || atlas.height < 1 ||
    atlas.width > 4096 || atlas.height > 4096 ||
    !Array.isArray(atlas.tiles) || !atlas.tiles.length ||
    atlas.tiles.length > 20_000
  ) {
    throw new RangeError(
      "Hair card atlas needs 1–4096 pixel dimensions and 1–20000 tiles",
    );
  }
  const bytes = atlas.width * atlas.height * 4;
  for (
    const key of [
      "data",
      "normalData",
      "tangentData",
      "depthData",
      "attributeData",
    ] as const
  ) {
    const pixels = atlas[key];
    if (pixels === undefined && key !== "data" && key !== "normalData") {
      continue;
    }
    if (!(pixels instanceof Uint8Array) || pixels.length !== bytes) {
      throw new RangeError(
        `Hair card atlas ${key} must contain width * height * 4 bytes`,
      );
    }
  }
  for (const tile of atlas.tiles) {
    if (
      ![tile.u0, tile.v0, tile.u1, tile.v1].every(Number.isFinite) ||
      tile.u0 < 0 || tile.v0 < 0 || tile.u1 > 1 || tile.v1 > 1 ||
      tile.u1 <= tile.u0 || tile.v1 <= tile.v0
    ) {
      throw new RangeError(
        "Hair card atlas tiles must be nonempty UV rectangles in [0,1]",
      );
    }
  }
}

/** Share one set of GPU textures across all materials using the same atlas. */
export function hairCardTextures(atlas: HairCardAtlas): HairCardTextures {
  const cached = textureCache.get(atlas);
  if (cached) return cached;
  validateAtlas(atlas);
  const maps: HairCardTextures = {
    map: texture(atlas, atlas.data, "hair-fiber-alpha-atlas", true),
    normalMap: texture(atlas, atlas.normalData, "hair-fiber-normals"),
  };
  if (atlas.tangentData) {
    maps.anisotropyMap = texture(
      atlas,
      atlas.tangentData,
      "hair-fiber-direction",
    );
  }
  if (atlas.depthData) {
    maps.depthMap = texture(atlas, atlas.depthData, "hair-fiber-depth");
  }
  if (atlas.attributeData) {
    maps.attributeMap = texture(
      atlas,
      atlas.attributeData,
      "hair-fiber-attributes",
    );
  }
  textureCache.set(atlas, maps);
  return maps;
}

function validate(guides: HairCardGuide[], options: HairCardOptions) {
  if (options.atlas) {
    validateAtlas(options.atlas);
    if (options.seed !== undefined && !Number.isSafeInteger(options.seed)) {
      throw new RangeError("Hair card seed must be a safe integer");
    }
  } else atlasSettings(options);
  const variants = options.atlas?.tiles.length ?? VARIANTS;
  const camber = options.camber ?? 0;
  const widthSegments = options.widthSegments ?? (camber > 0 ? 4 : 1);
  if (!Number.isFinite(camber) || camber < 0 || camber > .5) {
    throw new RangeError("Hair card camber must be in [0,.5]");
  }
  if (
    !Number.isInteger(widthSegments) || widthSegments < 1 || widthSegments > 8
  ) {
    throw new RangeError(
      "Hair card widthSegments must be an integer from 1 to 8",
    );
  }
  if (camber > 0 && widthSegments < 2) {
    throw new RangeError("Curved hair cards need at least 2 widthSegments");
  }
  if (!Array.isArray(guides) || !guides.length || guides.length > 20_000) {
    throw new RangeError("hairCards needs 1–20000 guides");
  }
  for (
    const [key, value] of [
      ["roughness", options.roughness ?? .46],
      ["colorVariation", options.colorVariation ?? .12],
    ] as const
  ) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new RangeError(`${key} must be in [0,1]`);
    }
  }
  let vertices = 0, segments = 0;
  for (const guide of guides) {
    if (
      !Array.isArray(guide.points) || guide.points.length < 2 ||
      guide.points.length > 257
    ) throw new RangeError("Each hair card needs 2–257 centerline points");
    if (
      Array.isArray(guide.width) && guide.width.length !== guide.points.length
    ) {
      throw new RangeError("Hair card widths must match the point count");
    }
    if (guide.normals && guide.normals.length !== guide.points.length) {
      throw new RangeError("Hair card normals must match the point count");
    }
    if (guide.arcT !== undefined) {
      if (
        !Array.isArray(guide.arcT) ||
        guide.arcT.length !== guide.points.length ||
        guide.arcT.some((t, i) =>
          !Number.isFinite(t) || t < 0 || t > 1 ||
          (i > 0 && t <= guide.arcT![i - 1])
        )
      ) {
        throw new RangeError(
          "Hair card arcT must be strictly increasing coordinates in [0,1], one per point",
        );
      }
    }
    if (
      guide.shade !== undefined &&
      (!Number.isFinite(guide.shade) || guide.shade < 0 || guide.shade > 2)
    ) throw new RangeError("Hair card shade must be in [0,2]");
    if (
      guide.variant !== undefined &&
      (!Number.isInteger(guide.variant) || guide.variant < 0 ||
        guide.variant >= variants)
    ) {
      throw new RangeError(
        `Hair card variant must be an integer from 0 to ${variants - 1}`,
      );
    }
    let widest = 0;
    guide.points.forEach((p, i) => {
      if (p.length !== 3 || !p.every(Number.isFinite)) {
        throw new RangeError("Hair card positions must be finite XYZ tuples");
      }
      if (i && p.every((v, k) => v === guide.points[i - 1][k])) {
        throw new RangeError("Consecutive hair card points must be distinct");
      }
      const w = Array.isArray(guide.width) ? guide.width[i] : guide.width;
      if (!Number.isFinite(w) || w < 0) {
        throw new RangeError("Hair card widths must be finite and nonnegative");
      }
      widest = Math.max(widest, w);
      const n = guide.normals?.[i];
      if (n && (n.length !== 3 || !n.every(Number.isFinite))) {
        throw new RangeError("Hair card normals must be finite XYZ tuples");
      }
    });
    if (!widest) throw new RangeError("Each hair card needs a positive width");
    vertices += guide.points.length * (widthSegments + 1);
    segments += (guide.points.length - 1) * widthSegments;
  }
  if (vertices > 2_000_000) {
    throw new RangeError("Hair card mesh exceeds 2000000 vertices");
  }
  return { vertices, segments, camber, widthSegments };
}

/**
 * Build one standard glTF-compatible alpha-masked mesh. Normals describe each
 * card's facing direction, while anisotropy follows its root-to-tip direction.
 * This is static card geometry; it does not create native particle hair.
 */
export function hairCards(
  guides: HairCardGuide[],
  options: HairCardOptions = {},
): THREE.Group {
  const { vertices, segments, camber, widthSegments } = validate(
    guides,
    options,
  );
  const columns = widthSegments + 1;
  const atlas = options.atlas ?? createHairCardAtlas(options);
  const positions = new Float32Array(vertices * 3);
  const facingNormals = new Float32Array(vertices * 3);
  const longitudinal = new Float32Array(vertices * 3);
  const tangents = new Float32Array(vertices * 4);
  const colors = new Float32Array(vertices * 3);
  const uvs = new Float32Array(vertices * 2);
  const indices = vertices > 65535
    ? new Uint32Array(segments * 6)
    : new Uint16Array(segments * 6);
  const base = new THREE.Color(options.color ?? "#463126");
  const tip = new THREE.Color(options.tipColor ?? base);
  const rng = mulberry32((options.seed ?? 1) ^ 0xA341316C);
  const tint = new THREE.Color();
  let cursor = 0, indexCursor = 0;
  for (const guide of guides) {
    const points = guide.points.map((p) => new THREE.Vector3(...p));
    const distances = [0];
    for (let i = 1; i < points.length; i++) {
      distances.push(distances[i - 1] + points[i].distanceTo(points[i - 1]));
    }
    const total = distances.at(-1)!;
    const variant = guide.variant ?? Math.floor(rng() * atlas.tiles.length);
    const tile = atlas.tiles[variant];
    const shade = (guide.shade ?? 1) *
      (1 + (rng() * 2 - 1) * (options.colorVariation ?? .12));
    let previousNormal: THREE.Vector3 | undefined;
    const start = cursor;
    for (let i = 0; i < points.length; i++) {
      const direction = points[Math.min(i + 1, points.length - 1)].clone()
        .sub(points[Math.max(i - 1, 0)]);
      if (direction.lengthSq() < 1e-20) {
        direction.copy(points[i]).sub(points[Math.max(0, i - 1)]);
      }
      direction.normalize();
      const normal = guide.normals
        ? new THREE.Vector3(...guide.normals[i])
        : points[i].clone().sub(new THREE.Vector3(0, .78, 0));
      normal.addScaledVector(direction, -normal.dot(direction));
      if (normal.lengthSq() < 1e-16 && previousNormal) {
        normal.copy(previousNormal).addScaledVector(
          direction,
          -previousNormal.dot(direction),
        );
      }
      if (normal.lengthSq() < 1e-16) {
        normal.set(0, 0, 1);
        if (Math.abs(direction.z) > .9) normal.set(1, 0, 0);
        normal.addScaledVector(direction, -normal.dot(direction));
      }
      normal.normalize();
      previousNormal = normal.clone();
      const side = normal.clone().cross(direction).normalize();
      const w = Array.isArray(guide.width) ? guide.width[i] : guide.width;
      const t = guide.arcT?.[i] ?? distances[i] / total;
      tint.copy(base).lerp(tip, smooth(.15, 1, t)).multiplyScalar(shade);
      for (let column = 0; column < columns; column++) {
        const across = column / widthSegments;
        const u = across * 2 - 1;
        points[i].clone()
          .addScaledVector(side, w * .5 * u)
          .addScaledVector(normal, -camber * w * u * u)
          .toArray(positions, cursor * 3);
        normal.toArray(facingNormals, cursor * 3);
        direction.toArray(longitudinal, cursor * 3);
        // The smooth cross-section derivative prevents the highlight from
        // breaking at each polygon strip, including at the outermost edges.
        const widthTangent = side.clone().addScaledVector(
          normal,
          -4 * camber * u,
        )
          .normalize();
        tangents.set(
          [widthTangent.x, widthTangent.y, widthTangent.z, -1],
          cursor * 4,
        );
        tint.toArray(colors, cursor * 3);
        uvs.set(
          [
            THREE.MathUtils.lerp(tile.u0, tile.u1, across),
            THREE.MathUtils.lerp(tile.v0, tile.v1, t),
          ],
          cursor * 2,
        );
        cursor++;
      }
      if (i) {
        const previousWidth = Array.isArray(guide.width)
          ? guide.width[i - 1]
          : guide.width;
        for (let column = 0; column < widthSegments; column++) {
          const a = start + (i - 1) * columns + column;
          const b = a + 1, c = a + columns, d = c + 1;
          if (previousWidth > 0) {
            indices.set([a, c, b], indexCursor);
            indexCursor += 3;
          }
          if (w > 0) {
            indices.set([b, c, d], indexCursor);
            indexCursor += 3;
          }
        }
      }
    }
    if (camber > 0) {
      const previous = new THREE.Vector3(), next = new THREE.Vector3();
      const along = new THREE.Vector3(), across = new THREE.Vector3();
      const normal = new THREE.Vector3();
      for (let row = 0; row < points.length; row++) {
        for (let column = 0; column < columns; column++) {
          const at = start + row * columns + column;
          previous.fromArray(
            positions,
            (start + Math.max(0, row - 1) * columns + column) * 3,
          );
          next.fromArray(
            positions,
            (start + Math.min(points.length - 1, row + 1) * columns + column) *
              3,
          );
          along.subVectors(next, previous);
          if (along.lengthSq() < 1e-16) along.fromArray(longitudinal, at * 3);
          across.fromArray(tangents, at * 4);
          normal.crossVectors(along, across);
          if (normal.lengthSq() < 1e-16) {
            normal.fromArray(facingNormals, at * 3);
          }
          normal.normalize();
          normal.toArray(facingNormals, at * 3);
          along.normalize().toArray(longitudinal, at * 3);
        }
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(
    new THREE.BufferAttribute(indices.subarray(0, indexCursor), 1),
  );
  geometry.computeVertexNormals();
  const normals = geometry.getAttribute("normal");
  const normal = new THREE.Vector3(), side = new THREE.Vector3();
  const direction = new THREE.Vector3();
  for (let i = 0; i < vertices; i++) {
    if (camber > 0) normal.fromArray(facingNormals, i * 3);
    else normal.fromBufferAttribute(normals, i);
    if (normal.lengthSq() < 1e-16) normal.fromArray(facingNormals, i * 3);
    normal.normalize();
    normals.setXYZ(i, normal.x, normal.y, normal.z);
    side.fromArray(tangents, i * 4);
    side.addScaledVector(normal, -side.dot(normal)).normalize();
    direction.fromArray(longitudinal, i * 3);
    const handedness = normal.clone().cross(side).dot(direction) < 0 ? -1 : 1;
    tangents.set([side.x, side.y, side.z, handedness], i * 4);
  }
  geometry.setAttribute("tangent", new THREE.BufferAttribute(tangents, 4));
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  const maps = hairCardTextures(atlas);
  const material = options.material ?? new THREE.MeshPhysicalMaterial({
    name: "alpha-masked-hair",
    color: "#ffffff",
    vertexColors: true,
    map: maps.map,
    normalMap: maps.normalMap,
    normalScale: new THREE.Vector2(.24, .24),
    metalness: 0,
    roughness: options.roughness ?? .46,
    anisotropy: .85,
    // UV.u crosses a card; UV.v, the bitangent, follows its fibers.
    anisotropyMap: maps.anisotropyMap ?? null,
    anisotropyRotation: maps.anisotropyMap ? 0 : Math.PI / 2,
    specularIntensity: .6,
    sheen: .18,
    sheenRoughness: .6,
    sheenColor: new THREE.Color(options.tipColor ?? options.color ?? "#8c6c4b"),
    side: THREE.DoubleSide,
    alphaTest: .3,
    alphaToCoverage: true,
    transparent: false,
    depthWrite: true,
  });
  if (options.material) {
    if ("map" in material) material.map = maps.map;
    if ("normalMap" in material) material.normalMap = maps.normalMap;
    if ("anisotropyMap" in material && maps.anisotropyMap) {
      material.anisotropyMap = maps.anisotropyMap;
      if ("anisotropyRotation" in material) material.anisotropyRotation = 0;
    }
    material.needsUpdate = true;
  }
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = `${options.name ?? "hair-cards"}-mesh`;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  const group = new THREE.Group();
  group.name = options.name ?? "hair-cards";
  group.userData.threejsHairCards = {
    version: 1,
    seed: options.seed ?? 1,
    guideCount: guides.length,
    atlasVariants: atlas.tiles.length,
    ...(options.atlas
      ? { atlasWidth: atlas.width, atlasHeight: atlas.height, baked: true }
      : {}),
  };
  group.add(mesh);
  return group;
}
