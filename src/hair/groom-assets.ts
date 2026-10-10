/** Editable groom documents and lossless baked maps attached outside glTF extras. */
import * as THREE from "three";
import { type GuideGroom, serializeGroom } from "./groom-data.ts";
import type { BakedGroomCards } from "./groom-cards.ts";

export const GROOM_ASSET_SYMBOL = Symbol.for("js3.groom.assets");
export const GROOM_ASSET_FILES = [
  "groom.json",
  "manifest.json",
  "coverage.png",
  "normal.png",
  "tangent.png",
  "depth.png",
  "attributes.png",
] as const;
export type GroomAssetFilename = typeof GROOM_ASSET_FILES[number];

interface RegisteredGroomAssets {
  source: GuideGroom;
  baked: BakedGroomCards;
}

const CARRIER_SYMBOL = Symbol.for("js3.groom.assetCarrier");

/** Empty detail levels have no shared mesh resource to carry their export data. */
class GroomAssetCarrier extends THREE.Object3D {
  constructor(registered?: RegisteredGroomAssets) {
    super();
    this.name = "groom-export-data";
    this.visible = false;
    Object.defineProperty(this, CARRIER_SYMBOL, {
      value: registered,
      writable: true,
    });
  }

  override copy(source: THREE.Object3D, recursive = true): this {
    super.copy(source, recursive);
    (this as unknown as Record<symbol, RegisteredGroomAssets>)[CARRIER_SYMBOL] =
      (source as unknown as Record<symbol, RegisteredGroomAssets>)[
        CARRIER_SYMBOL
      ];
    return this;
  }
}

export interface CollectedGroomAssets extends RegisteredGroomAssets {
  name: string;
  directory: string;
  /** Every attachment, including its representation/LOD nodes, in scene order. */
  objects: { name: string; path: number[]; matrixWorld: number[] }[];
}

/** Register the shared source/bake once per render root; typed buffers stay off extras. */
export function registerGroomAssets<T extends THREE.Object3D>(
  root: T,
  source: GuideGroom,
  baked: BakedGroomCards,
): T {
  const registered = { source, baked };
  Object.defineProperty(root, GROOM_ASSET_SYMBOL, {
    value: registered,
    configurable: true,
    enumerable: false,
  });
  // Object3D.clone/copy preserve userData and share geometries. Keep the large
  // payload on those shared resources, then recover it at the marked groom
  // root so cloned transforms remain correct. No global registry outlives a model.
  root.userData.threejsGroomAssets = true;
  let hasCarrier = false;
  root.traverse((child) => {
    if (
      (child as unknown as Record<symbol, RegisteredGroomAssets>)[
        CARRIER_SYMBOL
      ]
    ) hasCarrier = true;
    const geometry = (child as THREE.Mesh).geometry;
    if (!geometry) return;
    hasCarrier = true;
    const existing =
      (geometry as unknown as Record<symbol, RegisteredGroomAssets>)[
        GROOM_ASSET_SYMBOL
      ];
    if (existing && existing.baked.atlas !== baked.atlas) {
      throw new Error(
        "A groom root cannot reuse geometry registered to a different atlas",
      );
    }
    Object.defineProperty(geometry, GROOM_ASSET_SYMBOL, {
      value: registered,
      configurable: true,
      enumerable: false,
    });
  });
  if (!hasCarrier) root.add(new GroomAssetCarrier(registered));
  return root;
}

function payload(node: THREE.Object3D): RegisteredGroomAssets | undefined {
  const direct = (node as unknown as Record<symbol, RegisteredGroomAssets>)[
    GROOM_ASSET_SYMBOL
  ];
  if (direct || node.userData.threejsGroomAssets !== true) return direct;
  let recovered: RegisteredGroomAssets | undefined;
  node.traverse((child) => {
    const geometry = (child as THREE.Mesh).geometry;
    const entry = geometry
      ? (geometry as unknown as Record<symbol, RegisteredGroomAssets>)[
        GROOM_ASSET_SYMBOL
      ]
      : (child as unknown as Record<symbol, RegisteredGroomAssets>)[
        CARRIER_SYMBOL
      ];
    if (!entry) return;
    if (recovered && recovered.baked.atlas !== entry.baked.atlas) {
      throw new Error(
        "A cloned groom root contains different registered atlases",
      );
    }
    recovered = entry;
  });
  if (!recovered) {
    throw new Error(
      "Groom asset geometry is missing; rebuild the groom before exporting its editable assets",
    );
  }
  return recovered;
}

function validateBake(source: GuideGroom, baked: BakedGroomCards): void {
  if (source?.version !== 1 || !Array.isArray(source.guides)) {
    throw new TypeError("Registered groom assets need a version 1 source");
  }
  const atlas = baked?.atlas;
  if (
    !atlas || !Number.isInteger(atlas.width) ||
    !Number.isInteger(atlas.height) ||
    atlas.width < 1 || atlas.height < 1 || atlas.width > 4096 ||
    atlas.height > 4096
  ) throw new RangeError("Registered groom atlas dimensions must be 1–4096");
  const bytes = atlas.width * atlas.height * 4;
  if (bytes * 5 > 512 * 1024 * 1024) {
    throw new RangeError("Groom maps exceed 512 MiB");
  }
  for (
    const map of [
      atlas.data,
      atlas.normalData,
      atlas.tangentData,
      atlas.depthData,
      atlas.attributeData,
    ]
  ) {
    if (!(map instanceof Uint8Array) || map.byteLength !== bytes) {
      throw new RangeError(
        "Registered groom assets need all five complete RGBA8 maps",
      );
    }
  }
  if (
    !Array.isArray(baked.tiles) || !Array.isArray(baked.guides) ||
    baked.tiles.length < 1 || baked.tiles.length > 20_000 ||
    baked.guides.length !== baked.tiles.length ||
    atlas.tiles.length !== baked.tiles.length
  ) throw new RangeError("Registered groom cards and tile metadata must match");
  const guideIds = new Set(source.guides.map((guide) => guide.id));
  const tiles = new Set<number>();
  for (const tile of baked.tiles) {
    if (
      !guideIds.has(tile.sourceGuideId) || !Number.isInteger(tile.variant) ||
      tile.variant < 0 || tile.variant >= atlas.tiles.length ||
      tiles.has(tile.variant) ||
      !Number.isFinite(tile.depthMin) || !Number.isFinite(tile.depthMax) ||
      tile.depthMin > tile.depthMax
    ) throw new RangeError("Registered groom tile metadata is invalid");
    tiles.add(tile.variant);
    const uv = atlas.tiles[tile.variant];
    if (
      ![uv.u0, uv.u1, uv.v0, uv.v1].every((n) =>
        Number.isFinite(n) && n >= 0 && n <= 1
      ) ||
      uv.u0 >= uv.u1 || uv.v0 >= uv.v1
    ) throw new RangeError("Registered groom tile UVs are invalid");
  }
}

/** Traverse hidden LOD levels too, writing one asset set per shared baked atlas. */
export function collectGroomAssets(
  root: THREE.Object3D,
): CollectedGroomAssets[] {
  root.updateWorldMatrix(true, true);
  const byAtlas = new Map<BakedGroomCards["atlas"], CollectedGroomAssets>();
  const visit = (node: THREE.Object3D, path: number[]) => {
    const registered = payload(node);
    if (registered) {
      const { source, baked } = registered;
      let entry = byAtlas.get(baked?.atlas);
      if (!entry) {
        validateBake(source, baked);
        if (byAtlas.size >= 64) {
          throw new RangeError(
            "One scene can export at most 64 groom asset sets",
          );
        }
        const name = source.name || node.name || "groom";
        const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "").slice(0, 48).replace(/-+$/g, "") || "groom";
        entry = {
          source,
          baked,
          name,
          directory: `grooms/${
            String(byAtlas.size + 1).padStart(3, "0")
          }-${slug}`,
          objects: [],
        };
        byAtlas.set(baked.atlas, entry);
      } else if (
        source !== entry.source &&
        serializeGroom(source) !== serializeGroom(entry.source)
      ) {
        throw new Error(
          "One shared groom atlas cannot be registered with different editable sources",
        );
      }
      entry.objects.push({
        name: node.name,
        path,
        matrixWorld: [...node.matrixWorld.elements],
      });
    }
    node.children.forEach((child, index) => visit(child, [...path, index]));
  };
  visit(root, []);
  return [...byAtlas.values()];
}

/** Channel encodings and tile coordinates required to reuse the exported PNGs. */
export function groomAssetManifest(asset: CollectedGroomAssets) {
  const { baked } = asset;
  return {
    version: 1,
    format: "threejs-groom-assets",
    name: asset.name,
    source: "groom.json",
    atlas: {
      width: baked.atlas.width,
      height: baked.atlas.height,
      components: "RGBA8",
      alpha: "straight",
      pngRowOrder:
        "first PNG row is texture v=0; import without vertical flipping",
      textureFlipY: false,
    },
    maps: {
      coverage: { file: "coverage.png", ...baked.maps.diffuse },
      normal: { file: "normal.png", ...baked.maps.normal },
      tangent: { file: "tangent.png", ...baked.maps.direction },
      depth: { file: "depth.png", ...baked.maps.depth },
      attributes: { file: "attributes.png", ...baked.maps.attributes },
    },
    tiles: baked.tiles.map((tile) => ({
      ...tile,
      uv: { ...baked.atlas.tiles[tile.variant] },
    })),
    cards: baked.guides,
    report: baked.report,
    objects: asset.objects,
    transforms:
      "column-major 4x4 matrices from groom local coordinates to scene world coordinates",
  };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, n) => {
  for (let i = 0; i < 8; i++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});

function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const chunk = new Uint8Array(data.byteLength + 12);
  const view = new DataView(chunk.buffer);
  view.setUint32(0, data.byteLength);
  for (let i = 0; i < 4; i++) chunk[4 + i] = type.charCodeAt(i);
  chunk.set(data, 8);
  let crc = 0xffffffff;
  for (let i = 4; i < chunk.length - 4; i++) {
    crc = crcTable[(crc ^ chunk[i]) & 255] ^ (crc >>> 8);
  }
  view.setUint32(chunk.length - 4, (crc ^ 0xffffffff) >>> 0);
  return chunk;
}

/** Encode straight RGBA exactly, including RGB under fully transparent texels. */
export async function encodeGroomPNG(
  width: number,
  height: number,
  pixels: Uint8Array,
  srgb = false,
): Promise<Uint8Array> {
  if (
    !Number.isInteger(width) || !Number.isInteger(height) ||
    width < 1 || height < 1 || width > 4096 || height > 4096 ||
    !(pixels instanceof Uint8Array) || pixels.byteLength !== width * height * 4
  ) {
    throw new RangeError(
      "Groom PNG needs complete RGBA8 pixels at dimensions 1–4096",
    );
  }
  const stride = width * 4;
  const rows = new Uint8Array((stride + 1) * height);
  for (let row = 0; row < height; row++) {
    rows.set(
      pixels.subarray(row * stride, (row + 1) * stride),
      row * (stride + 1) + 1,
    );
  }
  const compressed = new Uint8Array(
    await new Response(
      new Blob([rows]).stream().pipeThrough(new CompressionStream("deflate")),
    ).arrayBuffer(),
  );
  const header = new Uint8Array(13);
  const view = new DataView(header.buffer);
  view.setUint32(0, width);
  view.setUint32(4, height);
  header[8] = 8;
  header[9] = 6;
  const chunks = [
    new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
  ];
  if (srgb) chunks.push(pngChunk("sRGB", new Uint8Array([0])));
  chunks.push(pngChunk("IDAT", compressed), pngChunk("IEND", new Uint8Array()));
  const output = new Uint8Array(
    chunks.reduce((sum, chunk) => sum + chunk.length, 0),
  );
  let at = 0;
  for (const chunk of chunks) {
    output.set(chunk, at);
    at += chunk.length;
  }
  return output;
}

/** Prepare one file at a time so a scene never needs all compressed maps resident. */
export async function encodeGroomAssetFile(
  asset: CollectedGroomAssets,
  filename: GroomAssetFilename,
): Promise<Uint8Array> {
  if (filename === "groom.json") {
    return new TextEncoder().encode(serializeGroom(asset.source) + "\n");
  }
  if (filename === "manifest.json") {
    return new TextEncoder().encode(
      JSON.stringify(groomAssetManifest(asset), null, 2) + "\n",
    );
  }
  const atlas = asset.baked.atlas;
  const maps = {
    "coverage.png": atlas.data,
    "normal.png": atlas.normalData,
    "tangent.png": atlas.tangentData,
    "depth.png": atlas.depthData,
    "attributes.png": atlas.attributeData,
  };
  if (!(filename in maps)) throw new RangeError("Unknown groom asset filename");
  return await encodeGroomPNG(
    atlas.width,
    atlas.height,
    maps[filename]!,
    filename === "coverage.png",
  );
}
