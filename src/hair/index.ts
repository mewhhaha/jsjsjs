/** Public hair API. Helpers shared only inside js3 stay importable from their own modules. */
export * from "./strands.ts";
export * from "./strand-presets.ts";
export * from "./groom-cards.ts";
export * from "./groom-volume-data.ts";
export * from "./stylized-hair.ts";
export {
  groom,
  type GroomOptions,
  type RootSamplingOptions,
  sampleRoots,
  type Strand,
  type StrandData,
  type StrandGuide,
  type StrandRoot,
} from "./strand-data.ts";
export {
  type HairCardAtlas,
  type HairCardAtlasOptions,
  type HairCardGuide,
  type HairCardOptions,
  hairCards,
} from "./hair-cards.ts";
export {
  createGroom,
  type GeneratedGroom,
  type GenerateGroomOptions,
  generateGroomStrands,
  type GroomFiber,
  type GroomGuide,
  type GroomLayer,
  type GroomRootBinding,
  type GuideGroom,
  parseGroom,
  serializeGroom,
} from "./groom-data.ts";
export {
  buildGroom,
  buildGroomLODs,
  type CompiledGroom,
  compileGroom,
  type GroomBuildOptions,
  type GroomCompileOptions,
  type GroomDetail,
  type GroomRenderOptions,
  type GroomRepresentation,
  renderGroom,
} from "./groom.ts";
export {
  type GroomVolumeShadowOptions,
  GroomVolumeShadows,
  type GroomVolumeShadowStatistics,
  registerGroomVolume,
} from "./groom-volume-shadows.ts";
export {
  type GroomHairMaterial,
  groomHairMaterial,
  type GroomHairMaterialOptions,
  preserveGroomCardCoverage,
} from "./hair-shading.ts";
