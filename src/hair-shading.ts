import * as THREE from "three";

/**
 * Portable physical material with a fiber-specific direct-light preview.
 *
 * The preview follows Karis, "Physically Based Hair Shading in Unreal" (2016),
 * slides 18, 20, 25, 28, 29 and 32: Gaussian longitudinal lobes, R/TT/TRT
 * azimuthal approximations, Fresnel and color-parameterized absorption.
 * These are single-fiber approximations, not a complete
 * Marschner BSDF: no medulla, caustic glints or multiple scattering.
 * Source-volume light attenuation is supplied separately by GroomVolumeShadows.
 *
 * https://blog.selfshadow.com/publications/s2016-shading-course/karis/s2016_pbs_epic_hair.pdf
 */
export interface GroomHairMaterialOptions {
  name?: string;
  /** Multiplies the diffuse map and vertex color; white is useful for grooms. */
  color?: THREE.ColorRepresentation;
  map?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  /** RG: signed direction in the UV tangent frame, B: anisotropy strength. */
  tangentMap?: THREE.Texture | null;
  /** R: normalized outward depth within a baked clump. Not a shadow map. */
  depthMap?: THREE.Texture | null;
  /** Optional artistic attenuation of buried texels, 0–1; default 0. */
  depthOcclusion?: number;
  /** Longitudinal roughness, 0–1. Preview clamps to .12 to limit aliasing. */
  roughness?: number;
  /** Root-to-tip UV axis when no tangent map is supplied. Default "v". */
  tangentAxis?: "u" | "v";
  /** Cuticle scale tilt in degrees, 0–10. Default 2. */
  cuticleTiltDegrees?: number;
  /** Refractive index, 1.01–2; default 1.55. */
  ior?: number;
  /** Multiplier of pigment absorption, 0–8; default 1. */
  absorptionScale?: number;
  normalScale?: number;
  vertexColors?: boolean;
  alphaTest?: number;
  alphaToCoverage?: boolean;
}

export type GroomHairMaterial = THREE.MeshPhysicalMaterial & {
  /** Own property so the viewer's normal texture disposal finds this map. */
  groomDepthMap: THREE.Texture | null;
};

const matchedShadowMeshes = new WeakSet<THREE.Mesh>();
const coverageMaterials = new WeakSet<THREE.Material>();

const BAKED_COVERAGE = /* glsl */ `
// Source-baked alpha is measured area coverage, not an isocontour to sharpen.
#ifdef USE_ALPHATEST
  if (diffuseColor.a < alphaTest) discard;
#endif
if (diffuseColor.a <= 0.0) discard;
#ifdef ALPHA_TO_COVERAGE
  // Single-sample targets cannot represent fractional sample coverage. On
  // transparent MSAA clears, storing alpha while masking samples squares the
  // resolved alpha. Both use the ordinary MASK fallback with covered alpha 1.
  if (!groomCardCoverageMsaa) diffuseColor.a = 1.0;
#endif
`;

/**
 * Preserve a source-baked card's true alpha under MSAA. Ordinary cutout maps
 * retain Three's default behavior unless explicitly passed to this helper.
 * The authored alpha cutoff and portable glTF MASK material stay unchanged;
 * targets without MSAA and transparent clears use binary cutout. WebGL cannot
 * independently supply alpha-to-coverage and stored alpha-to-one, so transparent
 * imposters retain that fallback. Runtime hooks are not serialized.
 */
export function preserveGroomCardCoverage<T extends THREE.Material>(
  material: T,
): T {
  if (coverageMaterials.has(material)) return material;
  coverageMaterials.add(material);
  const before = material.onBeforeCompile;
  const key = material.customProgramCacheKey;
  material.onBeforeCompile = function (shader, renderer) {
    before.call(this, shader, renderer);
    const hook = "#include <alphatest_fragment>";
    if (!shader.fragmentShader.includes(hook)) {
      throw new Error("Baked groom coverage requires Three's alpha-test hook");
    }
    // Three resets material uniform bindings on render-target changes. The
    // getter is evaluated on upload, so one material works in the main viewer,
    // imposter captures and both multisample/single-sample render targets.
    const attributes = renderer.getContextAttributes();
    const defaultMsaa = attributes.antialias === true;
    shader.uniforms.groomCardCoverageMsaa = {
      get value() {
        const target = renderer.getRenderTarget();
        const multisampled = target
          ? target.samples > 0 && renderer.capabilities.maxSamples > 0
          : defaultMsaa;
        const opaque = (!target && attributes.alpha === false) ||
          renderer.getClearAlpha() >= 1;
        return multisampled && opaque;
      },
    };
    shader.fragmentShader = "uniform bool groomCardCoverageMsaa;\n" +
      shader.fragmentShader.replace(hook, BAKED_COVERAGE);
  };
  material.customProgramCacheKey = function () {
    const originalKey = key === THREE.Material.prototype.customProgramCacheKey
      ? before.toString()
      : key.call(this);
    return `${originalKey}|groom-card-area-coverage-v1`;
  };
  material.needsUpdate = true;
  return material;
}

/**
 * Use the visible material's alpha cutoff for its shadow pass as well.
 * Three normally substitutes .5 when alphaToCoverage is enabled, which can
 * remove shadows from visible minified fibers with a lower authored cutoff.
 * Wraps existing callbacks and is safe to call repeatedly on the same mesh.
 */
export function matchGroomShadowCoverage<T extends THREE.Mesh>(mesh: T): T {
  // Object3D.clone preserves userData but drops render callbacks. The viewer
  // uses this marker to restore matching only on explicitly opted-in meshes.
  mesh.userData.threejsGroomShadowCoverage = true;
  if (matchedShadowMeshes.has(mesh)) return mesh;
  const beforeShadow = mesh.onBeforeShadow;
  mesh.onBeforeShadow = (...args) => {
    beforeShadow.apply(mesh, args);
    // @types/three currently calls this a scene Group; WebGLShadowMap passes
    // the BufferGeometry group ({start,count,materialIndex}) or null instead.
    const group = args[6] as unknown as { materialIndex?: number } | null;
    const material = Array.isArray(mesh.material)
      ? mesh.material[group?.materialIndex ?? 0]
      : mesh.material;
    args[5].alphaTest = material.alphaTest;
  };
  matchedShadowMeshes.add(mesh);
  return mesh;
}

const SOURCES = [
  "https://blog.selfshadow.com/publications/s2016-shading-course/karis/s2016_pbs_epic_hair.pdf",
];

function range(value: number, name: string, min: number, max: number): number {
  if (!Number.isFinite(value) || value < min || value > max) {
    throw new Error(`${name} must be finite and between ${min} and ${max}`);
  }
  return value;
}

// Each RE_Direct call receives light radiance after Three applies visibility,
// distance attenuation, spot masks and shadow maps. Replacing this hook rather
// than adding emissive light keeps the hair response under those same controls.
const DIRECT_SHADER = /* glsl */ `
uniform float groomCuticleTilt;
uniform float groomAbsorptionScale;
uniform float groomDepthOcclusion;
#ifdef GROOM_DEPTH_MAP
  uniform sampler2D groomDepthMap;
  uniform mat3 groomDepthMapTransform;
#endif

float groomGaussian(float x, float width) {
  return exp(-0.5 * x * x / (width * width)) / (2.50662827463 * width);
}

float groomFresnel(float cosine, float eta) {
  float f0 = (eta - 1.0) / (eta + 1.0);
  f0 *= f0;
  float grazing = 1.0 - clamp(cosine, 0.0, 1.0);
  return f0 + (1.0 - f0) * pow(grazing, 5.0);
}

vec3 groomAbsorption(vec3 reflectance) {
  // Karis's C^path is Beer-Lambert expressed using artist-facing color:
  // exp(-(-log(C)) * path). Its fitted path lengths below must be used with
  // this parameterization, not PBRT's multiple-scattering reflectance fit.
  return -log(clamp(reflectance, vec3(0.0001), vec3(1.0))) * groomAbsorptionScale;
}

float groomBakedVisibility() {
  #ifdef GROOM_DEPTH_MAP
    vec2 uv = (groomDepthMapTransform * vec3(vUv, 1.0)).xy;
    float depth = texture2D(groomDepthMap, uv).r;
    return mix(1.0, clamp(depth, 0.0, 1.0), groomDepthOcclusion);
  #else
    return 1.0;
  #endif
}

void RE_Direct_GroomHair(const in IncidentLight directLight,
  const in vec3 geometryPosition, const in vec3 geometryNormal,
  const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal,
  const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
  if (!directLight.visible) return;
  // Anisotropy uses the actual tangent texture and Three's transformed TBN.
  // Undo the double-sided face flip: root-to-tip orientation must be stable.
  vec3 axis = normalize(material.anisotropyT);
  #ifdef DOUBLE_SIDED
    axis *= gl_FrontFacing ? 1.0 : -1.0;
  #endif
  vec3 light = directLight.direction;
  vec3 view = geometryViewDir;
  float sinI = clamp(dot(axis, light), -0.9999, 0.9999);
  float sinO = clamp(dot(axis, view), -0.9999, 0.9999);
  float cosI = sqrt(max(0.0001, 1.0 - sinI * sinI));
  float cosO = sqrt(max(0.0001, 1.0 - sinO * sinO));
  float cosPhi = clamp((dot(light, view) - sinI * sinO) / (cosI * cosO), -1.0, 1.0);
  float cosHalfPhi = sqrt(max(0.0, 0.5 + 0.5 * cosPhi));
  float thetaD = 0.5 * (asin(sinI) - asin(sinO));
  float cosD = max(0.05, cos(thetaD));
  float sinD = sin(thetaD);
  float eta = material.ior;
  float etaPrime = sqrt(max(0.0001, eta * eta - sinD * sinD)) / cosD;
  float beta = clamp(material.roughness, 0.12, 1.0);
  float width = beta * beta;
  float longitudinal = sinI + sinO;
  vec3 sigma = groomAbsorption(material.diffuseColor);

  // R: uncolored dielectric reflection; Karis slides 18 and 20.
  float mr = groomGaussian(longitudinal + 2.0 * groomCuticleTilt, width);
  float nr = 0.25 * cosHalfPhi;
  float fr = groomFresnel(sqrt(max(0.0, 0.5 + 0.5 * dot(light, view))), eta);
  vec3 r = vec3(mr * nr * fr);

  // TT: a single transit through the pigmented fiber; slides 25 and 29.
  float h = clamp(cosHalfPhi * (1.0 + (0.6 - 0.8 * cosPhi) / etaPrime), 0.0, 0.9999);
  float ft = groomFresnel(cosD * sqrt(max(0.0, 1.0 - h * h)), eta);
  // Karis slide 28: C^(0.5*cos(gamma_t)/cos(theta_d)).
  float distanceTT = 0.5 * sqrt(max(0.0, 1.0 - h * h / (etaPrime * etaPrime))) / cosD;
  vec3 transmittanceTT = exp(-sigma * distanceTT);
  float mt = groomGaussian(longitudinal - groomCuticleTilt, width * 0.5);
  float nt = exp(-3.65 * cosPhi - 3.98);
  vec3 tt = mt * nt * (1.0 - ft) * (1.0 - ft) * transmittanceTT;

  // TRT: internal reflection and two transits; the broad single-lobe
  // approximation uses h=sqrt(3)/2 and C^(0.8/cos(theta_d)) (slide 32).
  float fi = groomFresnel(cosD * 0.5, eta);
  float distanceTRT = 0.8 / cosD;
  vec3 transmittanceTRT = exp(-sigma * distanceTRT);
  float mi = groomGaussian(longitudinal - 4.0 * groomCuticleTilt, width * 2.0);
  float ni = exp(17.0 * cosPhi - 16.78);
  vec3 trt = mi * ni * (1.0 - fi) * (1.0 - fi) * fi * transmittanceTRT;

  // This cylindrical response already integrates the fiber cross-section;
  // multiplying by a card's dot(N,L) would remove all transmitted backlight.
  reflectedLight.directSpecular += directLight.color * (r + tt + trt) * groomBakedVisibility();
}

#undef RE_Direct
#define RE_Direct RE_Direct_GroomHair
`;

/**
 * Hair-specific WebGL preview with an anisotropic glTF material fallback.
 * Directional, point and spot lights use R/TT/TRT. Environment, hemisphere and
 * rectangular area lights retain Three's standard physical approximation.
 * The onBeforeCompile preview is not serialized by GLTFExporter or Material.clone().
 */
export function groomHairMaterial(
  options: GroomHairMaterialOptions = {},
): GroomHairMaterial {
  const roughness = range(options.roughness ?? .42, "roughness", 0, 1);
  const tilt = range(
    options.cuticleTiltDegrees ?? 2,
    "cuticleTiltDegrees",
    0,
    10,
  ) * Math.PI / 180;
  const absorption = range(
    options.absorptionScale ?? 1,
    "absorptionScale",
    0,
    8,
  );
  const depthOcclusion = range(
    options.depthOcclusion ?? 0,
    "depthOcclusion",
    0,
    1,
  );
  const normalScale = range(options.normalScale ?? .2, "normalScale", 0, 2);
  const alphaTest = range(
    options.alphaTest ?? (options.map ? .3 : 0),
    "alphaTest",
    0,
    1,
  );
  const ior = range(options.ior ?? 1.55, "ior", 1.01, 2);
  if (
    options.tangentAxis !== undefined &&
    !["u", "v"].includes(options.tangentAxis)
  ) {
    throw new Error('tangentAxis must be "u" or "v"');
  }
  const material = new THREE.MeshPhysicalMaterial({
    name: options.name ?? "groom-hair",
    color: options.color ?? "#ffffff",
    map: options.map ?? null,
    normalMap: options.normalMap ?? null,
    normalScale: new THREE.Vector2(normalScale, normalScale),
    anisotropyMap: options.tangentMap ?? null,
    anisotropy: .9,
    anisotropyRotation: options.tangentMap || options.tangentAxis === "u"
      ? 0
      : Math.PI / 2,
    roughness,
    metalness: 0,
    ior,
    specularIntensity: 1,
    vertexColors: options.vertexColors ?? true,
    side: THREE.DoubleSide,
    transparent: false,
    depthWrite: true,
    alphaTest,
    alphaToCoverage: options.alphaToCoverage ?? true,
  }) as GroomHairMaterial;
  material.groomDepthMap = options.depthMap ?? null;
  const hasDepth = material.groomDepthMap !== null;
  material.userData.threejsGroomShading = {
    version: 2,
    preview:
      "Karis 2016 R/TT/TRT and color-parameterized absorption approximation",
    export: "standard anisotropic glTF physical material; no custom hair BSDF",
    tangentAxis: options.tangentAxis ?? "v",
    cuticleTiltDegrees: options.cuticleTiltDegrees ?? 2,
    absorptionScale: absorption,
    depthOcclusion,
    sources: SOURCES,
  };
  if (hasDepth) material.defines = { ...material.defines, GROOM_DEPTH_MAP: "" };
  material.onBeforeCompile = (shader) => {
    const include = "#include <lights_physical_pars_fragment>";
    if (!shader.fragmentShader.includes(include)) {
      throw new Error(
        "Hair shading requires Three's physical lighting shader hook",
      );
    }
    shader.uniforms.groomCuticleTilt = { value: tilt };
    shader.uniforms.groomAbsorptionScale = { value: absorption };
    shader.uniforms.groomDepthOcclusion = { value: depthOcclusion };
    if (material.groomDepthMap) {
      if (material.groomDepthMap.matrixAutoUpdate) {
        material.groomDepthMap.updateMatrix();
      }
      shader.uniforms.groomDepthMap = { value: material.groomDepthMap };
      shader.uniforms.groomDepthMapTransform = {
        value: material.groomDepthMap.matrix,
      };
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      include,
      `${include}\n${DIRECT_SHADER}`,
    );
  };
  material.customProgramCacheKey = () =>
    `groom-hair-v2-depth-${Number(hasDepth)}`;
  return material;
}
