/** Compile one editable guide groom into baked cards and strand representations. */
import * as THREE from "three";
import { fnv1a } from "../random.ts";
import {
  createGroom,
  type GeneratedGroom,
  generateGroomStrands,
  type GroomFiber,
  type GuideGroom,
} from "./groom-data.ts";
import { bakeGroomCards, type GroomCardBakeOptions } from "./groom-cards.ts";
import {
  type HairCardGuide,
  hairCards,
  hairCardTextures,
} from "./hair-cards.ts";
import {
  groomHairMaterial,
  matchGroomShadowCoverage,
  preserveGroomCardCoverage,
} from "./hair-shading.ts";
import { hairMaterial, strands } from "./strands.ts";
import { registerGroomAssets } from "./groom-assets.ts";
import { registerGroomVolume } from "./groom-volume-shadows.ts";
import {
  type GroomVolume,
  type GroomVolumeOptions,
  voxelizeGroom,
} from "./groom-volume-data.ts";

export type GroomDetail = "high" | "medium" | "low";
export type GroomRepresentation = "cards" | "strands" | "hybrid";
export interface GroomCompileOptions {
  /** Sampling for the source fibers and texture bake, independent of display LOD. */
  segments?: number;
  atlas?: GroomCardBakeOptions;
  /** Full-source density shared by all display LODs. Default 64³; false disables it. */
  volume?: GroomVolumeOptions | false;
}
export interface GroomRenderOptions {
  lod?: GroomDetail;
  representation?: GroomRepresentation;
  /** Hair-specific preview response or the portable standard material. */
  shading?: "hair" | "standard";
  /** Baked-card alpha cutoff, 0–1. Default .03 preserves thin filtered fibers. */
  alphaTest?: number;
  name?: string;
}
export interface GroomBuildOptions
  extends GroomCompileOptions, GroomRenderOptions {}
export interface CompiledGroom {
  generated: GeneratedGroom;
  baked: ReturnType<typeof bakeGroomCards>;
  volume?: GroomVolume;
}

/** Lower levels keep all card coverage; geometry and explicit fine hairs change. */
export const GROOM_LODS = {
  high: {
    cardSegments: 18,
    widthSegments: 2,
    strandSegments: 18,
    fiberFraction: .025,
  },
  medium: {
    cardSegments: 10,
    widthSegments: 1,
    strandSegments: 10,
    fiberFraction: .006,
  },
  low: {
    cardSegments: 5,
    widthSegments: 1,
    strandSegments: 6,
    fiberFraction: 0,
  },
} as const;

function hash(value: string): number {
  const h = fnv1a(value);
  return ((h ^ h >>> 16) >>> 0) / 4294967296;
}

/** Bake once, then call renderGroom repeatedly for consistent LOD exports. */
export function compileGroom(
  source: GuideGroom,
  options: GroomCompileOptions = {},
): CompiledGroom {
  const clean = createGroom(source);
  const generated = generateGroomStrands(clean, {
    segments: options.segments ?? 24,
  });
  const baked = bakeGroomCards(generated, options.atlas);
  const volume = options.volume === false
    ? undefined
    : voxelizeGroom(generated, options.volume);
  return { generated, baked, ...(volume ? { volume } : {}) };
}

function resampleCard(guide: HairCardGuide, segments: number): HairCardGuide {
  const positions = guide.points.map((p) => new THREE.Vector3(...p));
  const distance = [0];
  for (let i = 1; i < positions.length; i++) {
    distance.push(distance[i - 1] + positions[i].distanceTo(positions[i - 1]));
  }
  const total = distance.at(-1)!;
  const points: [number, number, number][] = [];
  const normals: [number, number, number][] = [];
  const widths: number[] = [];
  const arcT: number[] = [];
  let index = 0;
  for (let i = 0; i <= segments; i++) {
    const d = total * i / segments;
    while (index < positions.length - 2 && distance[index + 1] < d) index++;
    const t = THREE.MathUtils.clamp(
      (d - distance[index]) / (distance[index + 1] - distance[index]),
      0,
      1,
    );
    points.push(
      positions[index].clone().lerp(positions[index + 1], t).toArray(),
    );
    if (guide.normals) {
      const n = new THREE.Vector3(...guide.normals[index])
        .lerp(new THREE.Vector3(...guide.normals[index + 1]), t);
      if (n.lengthSq() < 1e-12) n.fromArray(guide.normals[index]);
      normals.push(n.normalize().toArray());
    }
    widths.push(
      Array.isArray(guide.width)
        ? THREE.MathUtils.lerp(guide.width[index], guide.width[index + 1], t)
        : guide.width,
    );
    arcT.push(
      guide.arcT
        ? THREE.MathUtils.lerp(guide.arcT[index], guide.arcT[index + 1], t)
        : i / segments,
    );
  }
  return {
    ...guide,
    points,
    width: widths,
    arcT,
    ...(guide.normals ? { normals } : {}),
  };
}

function resampleFiber(fiber: GroomFiber, segments: number) {
  const samples = resampleCard({
    points: fiber.points.map((p) => [...p]),
    width: fiber.radii,
  }, segments);
  return {
    points: samples.points,
    radii: samples.width as number[],
    shade: fiber.shade,
  };
}

/** Build a single exportable detail level from the same fibers and baked atlas. */
export function renderGroom(
  compiled: CompiledGroom,
  options: GroomRenderOptions = {},
): THREE.Group {
  const detail = options.lod ?? "high";
  if (!Object.hasOwn(GROOM_LODS, detail)) {
    throw new RangeError("Groom lod must be high, medium or low");
  }
  const representation = options.representation ?? "hybrid";
  if (!["cards", "strands", "hybrid"].includes(representation)) {
    throw new RangeError(
      "Groom representation must be cards, strands or hybrid",
    );
  }
  const shading = options.shading ?? "hair";
  if (!["hair", "standard"].includes(shading)) {
    throw new RangeError("Groom shading must be hair or standard");
  }
  const alphaTest = options.alphaTest ?? .03;
  if (!Number.isFinite(alphaTest) || alphaTest < 0 || alphaTest > 1) {
    throw new RangeError("Groom alphaTest must be in [0,1]");
  }
  const settings = GROOM_LODS[detail];
  const { generated, baked } = compiled;
  const textures = hairCardTextures(baked.atlas);
  const group = new THREE.Group();
  group.name = options.name ?? generated.source.name ?? "guide-groom";
  let renderedStrands = 0, renderedCards = 0;
  for (const layer of generated.source.layers) {
    const color = layer.color ?? "#583523", tipColor = layer.tipColor ?? color;
    const roughness = layer.roughness ?? .5;
    if (
      representation !== "strands" &&
      !(representation === "hybrid" && layer.kind === "flyaway")
    ) {
      const guides = baked.guides.filter((guide) => guide.layer === layer.id)
        .map((guide) => resampleCard(guide, settings.cardSegments));
      if (guides.length) {
        const material = shading === "hair"
          ? groomHairMaterial({
            map: textures.map,
            normalMap: textures.normalMap,
            tangentMap: textures.anisotropyMap,
            depthMap: textures.depthMap,
            tangentAxis: "v",
            color: "#ffffff",
            roughness,
            alphaTest,
          })
          : undefined;
        const cards = hairCards(guides, {
          name: `${layer.id}-cards`,
          atlas: baked.atlas,
          material,
          color,
          tipColor,
          colorVariation: .025,
          roughness,
          camber: settings.widthSegments > 1 ? .10 : 0,
          widthSegments: settings.widthSegments,
        });
        cards.traverse((child) => {
          const mesh = child as THREE.Mesh;
          if (!mesh.isMesh) return;
          for (
            const paint of Array.isArray(mesh.material)
              ? mesh.material
              : [mesh.material]
          ) {
            paint.alphaTest = alphaTest;
            preserveGroomCardCoverage(paint);
          }
        });
        group.add(cards);
        renderedCards += guides.length;
      }
    }
    if (representation !== "cards") {
      const fraction = representation === "strands"
        ? detail === "high" ? 1 : detail === "medium" ? .4 : .12
        : layer.kind === "flyaway"
        ? detail === "low" ? .25 : 1
        : settings.fiberFraction;
      const selected = generated.strands.filter((fiber) =>
        fiber.layer === layer.id && hash(fiber.id) < fraction
      );
      // Keep every batch below both strands() allocation limits.
      const batchSize = Math.min(
        20_000,
        Math.floor(1_500_000 / ((settings.strandSegments + 1) * 4 + 2)),
      );
      for (let offset = 0; offset < selected.length; offset += batchSize) {
        const batch = selected.slice(offset, offset + batchSize);
        const ids = new Set(batch.map((fiber) => fiber.guideId));
        const material = shading === "hair"
          ? groomHairMaterial({ color: "#ffffff", roughness, tangentAxis: "u" })
          : hairMaterial({ roughness });
        const rendered = strands({
          version: 1,
          seed: generated.seed,
          guides: generated.source.guides.filter((guide) => ids.has(guide.id))
            .map((guide) => guide.points),
          strands: batch.map((fiber) =>
            resampleFiber(fiber, settings.strandSegments)
          ),
        }, {
          name: `${layer.id}-fibers-${offset / batchSize}`,
          color,
          tipColor,
          material,
          radialSegments: 3,
          colorVariation: .12,
        });
        rendered.userData.groomFiberIds = batch.map((fiber) => fiber.id);
        group.add(rendered);
        renderedStrands += batch.length;
      }
    }
  }
  let vertices = 0, triangles = 0;
  group.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if (!mesh.isMesh) return;
    matchGroomShadowCoverage(mesh);
    vertices += mesh.geometry.getAttribute("position").count;
    triangles += (mesh.geometry.index?.count ??
      mesh.geometry.getAttribute("position").count) / 3;
  });
  group.userData.threejsGroom = {
    version: 1,
    source: generated.source,
    lod: detail,
    representation,
    shading,
    alphaTest,
    statistics: {
      guides: generated.source.guides.length,
      sourceStrands: generated.strands.length,
      renderedCards,
      renderedStrands,
      vertices,
      triangles,
      atlas: baked.report,
      ...(compiled.volume
        ? {
          volume: {
            resolution: compiled.volume.resolution,
            ...compiled.volume.statistics,
          },
        }
        : {}),
    },
  };
  if (compiled.volume) registerGroomVolume(group, compiled.volume);
  return registerGroomAssets(group, generated.source, baked);
}

export function buildGroom(
  source: GuideGroom,
  options: GroomBuildOptions = {},
): THREE.Group {
  return renderGroom(compileGroom(source, options), options);
}

/** Live distance switching. Use renderGroom for an explicit single-level export. */
export function buildGroomLODs(
  source: GuideGroom,
  options: Omit<GroomBuildOptions, "lod"> & {
    distances?: [number, number, number];
  } = {},
): THREE.LOD {
  const compiled = compileGroom(source, options);
  const root = new THREE.LOD();
  root.name = options.name ?? source.name ?? "groom-lods";
  const radius = new THREE.Box3().setFromPoints(
    source.guides.flatMap((guide) =>
      guide.points.map((p) => new THREE.Vector3(...p))
    ),
  ).getBoundingSphere(new THREE.Sphere()).radius;
  const distances = options.distances ?? [0, radius * 6, radius * 12];
  if (
    distances.length !== 3 || distances[0] !== 0 ||
    !distances.every(Number.isFinite) ||
    !(distances[1] > 0 && distances[2] > distances[1])
  ) {
    throw new RangeError(
      "Groom distances must be [0, near, far] with 0 < near < far",
    );
  }
  (["high", "medium", "low"] as const).forEach((lod, i) => {
    const level = renderGroom(compiled, { ...options, lod });
    // Store the editable source once on the LOD parent.
    delete level.userData.threejsGroom.source;
    level.visible = i === 0;
    root.addLevel(level, distances[i], .12);
  });
  root.userData.threejsGroomSource = compiled.generated.source;
  return registerGroomAssets(root, compiled.generated.source, compiled.baked);
}
