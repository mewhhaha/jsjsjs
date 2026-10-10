/** Preview-only Beer-Lambert attenuation from complete source-fiber volumes. */
import * as THREE from "three";
import {
  buildAmbientGroomVisibility,
  buildDirectionalGroomShadow,
  type GroomVolume,
} from "./groom-volume-data.ts";

export const GROOM_VOLUME_SYMBOL = Symbol.for("js3.groom.volume");
const CARRIER_SYMBOL = Symbol.for("js3.groom.volumeCarrier");
const MATERIAL_OWNER = Symbol.for("js3.groom.volumeMaterialOwner");

/** An empty representation still needs its shared source volume after cloning. */
class GroomVolumeCarrier extends THREE.Object3D {
  constructor(volume?: GroomVolume) {
    super();
    this.name = "groom-volume-data";
    this.visible = false;
    Object.defineProperty(this, CARRIER_SYMBOL, {
      value: volume,
      writable: true,
    });
  }

  override copy(source: THREE.Object3D, recursive = true): this {
    super.copy(source, recursive);
    symbols(this)[CARRIER_SYMBOL] = symbols(source)[CARRIER_SYMBOL];
    return this;
  }
}

function symbols(value: object): Record<symbol, GroomVolume | undefined> {
  return value as Record<symbol, GroomVolume | undefined>;
}

/**
 * Keep runtime grids outside serializable extras. Object3D clones share mesh
 * geometries and copy the small marker, so their own transformed root can
 * recover the source grid without a process-global registry.
 */
export function registerGroomVolume<T extends THREE.Object3D>(
  root: T,
  volume: GroomVolume,
): T {
  if (!volume || volume.version !== 1) {
    throw new TypeError("Expected a version 1 GroomVolume");
  }
  Object.defineProperty(root, GROOM_VOLUME_SYMBOL, {
    value: volume,
    configurable: true,
  });
  root.userData.threejsGroomVolume = true;
  let carried = false;
  root.traverse((node) => {
    if (symbols(node)[CARRIER_SYMBOL]) carried = true;
    const geometry = (node as THREE.Mesh).geometry;
    if (!geometry) return;
    const existing = symbols(geometry)[GROOM_VOLUME_SYMBOL];
    if (existing && existing !== volume) {
      throw new Error("A groom cannot reuse geometry from a different volume");
    }
    Object.defineProperty(geometry, GROOM_VOLUME_SYMBOL, {
      value: volume,
      configurable: true,
    });
    carried = true;
  });
  if (!carried) root.add(new GroomVolumeCarrier(volume));
  return root;
}

function registeredVolume(node: THREE.Object3D): GroomVolume | undefined {
  const direct = symbols(node)[GROOM_VOLUME_SYMBOL];
  if (direct || node.userData.threejsGroomVolume !== true) return direct;
  let recovered: GroomVolume | undefined;
  node.traverse((child) => {
    const geometry = (child as THREE.Mesh).geometry;
    const volume = geometry
      ? symbols(geometry)[GROOM_VOLUME_SYMBOL]
      : symbols(child)[CARRIER_SYMBOL];
    if (!volume) return;
    if (recovered && recovered !== volume) {
      throw new Error("A cloned groom contains different source volumes");
    }
    recovered = volume;
  });
  // glTF preserves the small marker but intentionally omits runtime volumes.
  // Imported assets use ordinary material/shadow behavior until registered
  // again from an editable source. Shared in-memory clones recover above.
  return recovered;
}

// Three's VSM pass also draws receiveShadow meshes, even when castShadow=false.
// A discard-only depth material keeps ordinary head/object shadows available to
// the groom without adding opaque card depths on top of its volume extinction.
// This is a subclass because WebGLShadowMap clones custom depth materials for
// alpha maps; Material.clone() does not copy assigned onBeforeCompile callbacks.
class GroomVolumeDepthMaterial extends THREE.MeshDepthMaterial {
  constructor() {
    super({ depthPacking: THREE.RGBADepthPacking });
    this.name = "groom-volume-excluded-opaque-depth";
  }

  override onBeforeCompile(
    ...[shader]: Parameters<THREE.Material["onBeforeCompile"]>
  ): void {
    const entry = "void main() {";
    if (!shader.fragmentShader.includes(entry)) {
      throw new Error("Unsupported Three depth shader for groom volumes");
    }
    shader.fragmentShader = shader.fragmentShader.replace(
      entry,
      `${entry}\n discard;`,
    );
  }

  override customProgramCacheKey(): string {
    return "groom-volume-no-opaque-depth-v1";
  }
}

const VERTEX_DECLARATIONS = /* glsl */ `
varying vec3 vGroomVolumeWorldPosition;
`;

const WORLD_POSITION = /* glsl */ `
vec4 groomVolumeWorldPosition = vec4(transformed, 1.0);
#ifdef USE_BATCHING
  groomVolumeWorldPosition = batchingMatrix * groomVolumeWorldPosition;
#endif
#ifdef USE_INSTANCING
  groomVolumeWorldPosition = instanceMatrix * groomVolumeWorldPosition;
#endif
vGroomVolumeWorldPosition = (modelMatrix * groomVolumeWorldPosition).xyz;
`;

const FRAGMENT_DECLARATIONS = /* glsl */ `
varying vec3 vGroomVolumeWorldPosition;
uniform highp sampler3D groomVolumeMap0;
uniform highp sampler3D groomVolumeMap1;
uniform mat4 groomVolumeWorldToTexture0;
uniform mat4 groomVolumeWorldToTexture1;
uniform vec3 groomVolumeLightDirection0;
uniform vec3 groomVolumeLightDirection1;
uniform int groomVolumeLightCount;
uniform highp sampler3D groomVolumeAmbientPositive;
uniform highp sampler3D groomVolumeAmbientNegative;
uniform mat4 groomVolumeAmbientWorldToTexture;
uniform float groomVolumeAmbientAmount;

float groomVolumeTransmittance(highp sampler3D opticalDepth, mat4 worldToTexture) {
  vec3 uv = (worldToTexture * vec4(vGroomVolumeWorldPosition, 1.0)).xyz;
  // Texture Z increases away from the light. Receivers beyond the far side
  // still see the complete column; points upstream and outside its footprint
  // are unoccluded. The map stores cumulative optical depth, not binary depth.
  if (any(lessThan(uv.xy, vec2(0.0))) ||
      any(greaterThan(uv.xy, vec2(1.0))) || uv.z < 0.0) return 1.0;
  vec2 encoded = texture(opticalDepth, vec3(uv.xy, min(uv.z, 1.0))).rg;
  float tau = (encoded.r + 256.0 * encoded.g) * (16.0 / 257.0);
  return exp(-tau);
}

float groomDirectionalVolumeVisibility(vec3 viewDirection) {
  if (groomVolumeLightCount == 0) return 1.0;
  // Three sorts directional lights by shadow state. Match world direction,
  // not array index; built-in viewMatrix also works for imposter cameras.
  vec3 worldDirection = inverseTransformDirection(viewDirection, viewMatrix);
  float first = dot(worldDirection, groomVolumeLightDirection0);
  float second = dot(worldDirection, groomVolumeLightDirection1);
  if (groomVolumeLightCount > 1 && second > first && second > 0.9999) {
    return groomVolumeTransmittance(groomVolumeMap1, groomVolumeWorldToTexture1);
  }
  if (first > 0.9999) {
    return groomVolumeTransmittance(groomVolumeMap0, groomVolumeWorldToTexture0);
  }
  return 1.0;
}

float groomAmbientVolumeVisibility(vec3 viewNormal) {
  vec3 uv = (groomVolumeAmbientWorldToTexture * vec4(vGroomVolumeWorldPosition, 1.0)).xyz;
  // A finite local field avoids projecting six infinite axis-aligned shadows
  // across exposed skin. Padding reaches full visibility before the bounds.
  if (any(lessThan(uv, vec3(0.0))) || any(greaterThan(uv, vec3(1.0)))) return 1.0;
  vec3 worldNormal = inverseTransformDirection(viewNormal, viewMatrix);
  vec3 positive = texture(groomVolumeAmbientPositive, uv).rgb;
  vec3 negative = texture(groomVolumeAmbientNegative, uv).rgb;
  float visibility = (dot(max(worldNormal, vec3(0.0)), positive) +
    dot(max(-worldNormal, vec3(0.0)), negative)) / max(dot(abs(worldNormal), vec3(1.0)), 0.0001);
  return mix(1.0, visibility, groomVolumeAmbientAmount);
}
`;

// Compose with authored aoMap at Three's indirect-only modulation hook. Use
// Three's own roughness/view-dependent specular occlusion for environment IBL;
// direct diffuse/specular, emission and transmission are not multiplied.
const AMBIENT_OCCLUSION = /* glsl */ `
if (receiveShadow && groomVolumeAmbientAmount > 0.0) {
  float groomAmbientVisibility = groomAmbientVolumeVisibility(geometryNormal);
  reflectedLight.indirectDiffuse *= groomAmbientVisibility;
  #ifdef USE_CLEARCOAT
    clearcoatSpecularIndirect *= groomAmbientVisibility;
  #endif
  #ifdef USE_SHEEN
    sheenSpecularIndirect *= groomAmbientVisibility;
  #endif
  #if defined(USE_ENVMAP) && defined(STANDARD)
    float groomAmbientDotNV = saturate(dot(geometryNormal, geometryViewDir));
    reflectedLight.indirectSpecular *= computeSpecularOcclusion(
      groomAmbientDotNV, groomAmbientVisibility, material.roughness);
  #endif
}
`;

interface MaterialPatch {
  before: THREE.Material["onBeforeCompile"];
  key: THREE.Material["customProgramCacheKey"];
  wrapper: THREE.Material["onBeforeCompile"];
  keyWrapper: THREE.Material["customProgramCacheKey"];
}

interface MeshPatch {
  castShadow: boolean;
  depth: THREE.Mesh["customDepthMaterial"];
}

interface CachedShadow {
  key: string;
  texture: THREE.Data3DTexture;
  worldToTexture: THREE.Matrix4;
  direction: THREE.Vector3;
}

interface CachedAmbient {
  key: string;
  positive: THREE.Data3DTexture;
  negative: THREE.Data3DTexture;
  worldToTexture: THREE.Matrix4;
  resolution: number;
  distance: number;
}

export interface GroomVolumeShadowOptions {
  /** Default true. Disabled mode restores ordinary mesh shadow behavior. */
  enabled?: boolean;
  /** Directional cumulative map resolution. Default 96. */
  resolution?: number;
  /** Default true. False retains ordinary mesh casts while ambient stays available. */
  directional?: boolean;
  /** Local source-volume ambient occlusion amount from 0 to 1. Default 1. */
  ambientOcclusion?: number;
  /** Local six-direction ambient visibility grid resolution. Default 64. */
  ambientResolution?: number;
  /** Positive world-space influence distance; default 12% of source extent. */
  ambientDistance?: number;
}

export interface GroomVolumeShadowStatistics {
  instances: number;
  volumes: number;
  lights: number;
  /** Cumulative builds since this controller's creation. Camera changes reuse maps. */
  builds: number;
  /** Cumulative ambient builds; independent of camera and light changes. */
  ambientBuilds: number;
  ambientResolution: number;
  ambientDistance: number;
  textureBytes: number;
}

/**
 * A scene's two directional preview lights share world-space optical-depth
 * fields. Density is derived from the full source, independent of visible LOD.
 * A local six-direction field also occludes indirect surface lighting. Both
 * approximate extinction; neither models multiple scattering between hairs.
 * Use one controller for a scene whose materials are shared with its captures.
 */
export class GroomVolumeShadows {
  readonly statistics: GroomVolumeShadowStatistics = {
    instances: 0,
    volumes: 0,
    lights: 0,
    builds: 0,
    ambientBuilds: 0,
    ambientResolution: 0,
    ambientDistance: 0,
    textureBytes: 0,
  };
  #materials = new Map<THREE.Material, MaterialPatch>();
  #meshes = new Map<THREE.Mesh, MeshPatch>();
  #volumeIds = new WeakMap<GroomVolume, number>();
  #nextVolumeId = 1;
  #maps: CachedShadow[] = [];
  #ambient: CachedAmbient | undefined;
  #emptyTexture: THREE.Data3DTexture | undefined;
  #depthMaterial: GroomVolumeDepthMaterial | undefined;
  #uniforms = {
    groomVolumeMap0: { value: null as THREE.Data3DTexture | null },
    groomVolumeMap1: { value: null as THREE.Data3DTexture | null },
    groomVolumeWorldToTexture0: { value: new THREE.Matrix4() },
    groomVolumeWorldToTexture1: { value: new THREE.Matrix4() },
    groomVolumeLightDirection0: { value: new THREE.Vector3() },
    groomVolumeLightDirection1: { value: new THREE.Vector3() },
    groomVolumeLightCount: { value: 0 },
    groomVolumeAmbientPositive: { value: null as THREE.Data3DTexture | null },
    groomVolumeAmbientNegative: { value: null as THREE.Data3DTexture | null },
    groomVolumeAmbientWorldToTexture: { value: new THREE.Matrix4() },
    groomVolumeAmbientAmount: { value: 0 },
  };

  #id(volume: GroomVolume): number {
    let id = this.#volumeIds.get(volume);
    if (id === undefined) {
      id = this.#nextVolumeId++;
      this.#volumeIds.set(volume, id);
    }
    return id;
  }

  #texture(data: Uint8Array, resolution: number): THREE.Data3DTexture {
    const texture = new THREE.Data3DTexture(
      data,
      resolution,
      resolution,
      resolution,
    );
    texture.name = "groom-cumulative-optical-depth";
    texture.format = THREE.RGBAFormat;
    texture.type = THREE.UnsignedByteType;
    texture.minFilter = texture.magFilter = THREE.LinearFilter;
    texture.wrapS = texture.wrapT = texture.wrapR = THREE.ClampToEdgeWrapping;
    texture.colorSpace = THREE.NoColorSpace;
    texture.generateMipmaps = false;
    texture.unpackAlignment = 1;
    texture.needsUpdate = true;
    return texture;
  }

  #patchMaterial(material: THREE.Material): void {
    if (this.#materials.has(material)) return;
    if (!(material as THREE.MeshStandardMaterial).isMeshStandardMaterial) {
      return;
    }
    const owners = material as unknown as Record<
      symbol,
      GroomVolumeShadows | undefined
    >;
    if (owners[MATERIAL_OWNER] && owners[MATERIAL_OWNER] !== this) {
      throw new Error(
        "Shared materials require one GroomVolumeShadows controller",
      );
    }
    const before = material.onBeforeCompile,
      key = material.customProgramCacheKey;
    const uniforms = this.#uniforms;
    const wrapper: THREE.Material["onBeforeCompile"] = function (
      this: THREE.Material,
      shader,
      renderer,
    ) {
      before.call(this, shader, renderer);
      const vertex = "#include <worldpos_vertex>";
      if (!shader.vertexShader.includes(vertex)) {
        throw new Error(
          "Groom volume shading requires Three's world-position hook",
        );
      }
      shader.vertexShader = VERTEX_DECLARATIONS + shader.vertexShader.replace(
        vertex,
        `${vertex}\n${WORLD_POSITION}`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <common>",
        `#include <common>\n${FRAGMENT_DECLARATIONS}`,
      );
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <lights_fragment_begin>",
        THREE.ShaderChunk.lights_fragment_begin,
      );
      const light = "getDirectionalLightInfo( directionalLight, directLight );";
      if (!shader.fragmentShader.includes(light)) {
        throw new Error(
          "Groom volume shading requires Three's directional-light hook",
        );
      }
      shader.fragmentShader = shader.fragmentShader.replace(
        light,
        `${light}\n directLight.color *= receiveShadow ? groomDirectionalVolumeVisibility(directLight.direction) : 1.0;`,
      );
      const ambient = "#include <aomap_fragment>";
      if (!shader.fragmentShader.includes(ambient)) {
        throw new Error(
          "Groom volume shading requires Three's ambient-occlusion hook",
        );
      }
      shader.fragmentShader = shader.fragmentShader.replace(
        ambient,
        `${ambient}\n${AMBIENT_OCCLUSION}`,
      );
      Object.assign(shader.uniforms, uniforms);
    };
    const keyWrapper = function (this: THREE.Material) {
      const originalKey = key === THREE.Material.prototype.customProgramCacheKey
        ? before.toString()
        : key.call(this);
      return `${originalKey}|groom-volume-shadows-v2`;
    };
    this.#materials.set(material, { before, key, wrapper, keyWrapper });
    Object.defineProperty(material, MATERIAL_OWNER, {
      value: this,
      configurable: true,
    });
    material.onBeforeCompile = wrapper;
    material.customProgramCacheKey = keyWrapper;
    material.needsUpdate = true;
  }

  #restoreMaterial(material: THREE.Material, patch: MaterialPatch): void {
    if (material.onBeforeCompile === patch.wrapper) {
      material.onBeforeCompile = patch.before;
    }
    if (material.customProgramCacheKey === patch.keyWrapper) {
      material.customProgramCacheKey = patch.key;
    }
    delete (material as unknown as Record<symbol, unknown>)[MATERIAL_OWNER];
    material.needsUpdate = true;
    this.#materials.delete(material);
  }

  #restoreMesh(mesh: THREE.Mesh, patch: MeshPatch): void {
    mesh.castShadow = patch.castShadow;
    if (mesh.customDepthMaterial === this.#depthMaterial) {
      mesh.customDepthMaterial = patch.depth;
    }
    this.#meshes.delete(mesh);
  }

  /** Update once before rendering; unchanged transforms/lights reuse CPU and GPU maps. */
  update(
    root: THREE.Object3D,
    directionalLights: readonly THREE.DirectionalLight[],
    camera: THREE.Camera,
    options: GroomVolumeShadowOptions = {},
  ): GroomVolumeShadowStatistics {
    if (options.enabled === false) {
      this.dispose();
      return this.statistics;
    }
    if (
      directionalLights.length > 2 ||
      directionalLights.some((light) => !light.isDirectionalLight)
    ) {
      throw new RangeError(
        "Groom volume shadows support at most two directional lights",
      );
    }
    const resolution = options.resolution ?? 96;
    if (!Number.isInteger(resolution) || resolution < 16 || resolution > 192) {
      throw new RangeError(
        "Groom shadow resolution must be an integer from 16 to 192",
      );
    }
    const ambientOcclusion = options.ambientOcclusion ?? 1;
    if (
      !Number.isFinite(ambientOcclusion) || ambientOcclusion < 0 ||
      ambientOcclusion > 1
    ) {
      throw new RangeError("Groom ambient occlusion must be from 0 to 1");
    }
    const ambientResolution = options.ambientResolution ?? 64;
    if (
      !Number.isInteger(ambientResolution) || ambientResolution < 16 ||
      ambientResolution > 96
    ) {
      throw new RangeError(
        "Groom ambient resolution must be an integer from 16 to 96",
      );
    }
    if (
      options.ambientDistance !== undefined &&
      (!Number.isFinite(options.ambientDistance) ||
        options.ambientDistance <= 0)
    ) {
      throw new RangeError(
        "Groom ambient distance must be finite and positive",
      );
    }
    root.updateWorldMatrix(true, true);
    camera.updateWorldMatrix(true, false);
    root.traverseVisible((node) => {
      const lod = node as THREE.LOD;
      if (lod.isLOD && lod.autoUpdate) lod.update(camera);
    });
    const instances: { volume: GroomVolume; matrixWorld: number[] }[] = [];
    const instanceKeys = new Set<string>();
    const volumes = new Set<GroomVolume>();
    const groomMeshes = new Set<THREE.Mesh>();
    const materials = new Set<THREE.Material>();
    const visit = (node: THREE.Object3D, insideGroom = false) => {
      if (!node.visible) return;
      const volume = registeredVolume(node);
      if (volume) {
        const matrixWorld = [...node.matrixWorld.elements];
        const key = `${this.#id(volume)}:${matrixWorld.join(",")}`;
        if (!instanceKeys.has(key)) {
          instances.push({ volume, matrixWorld });
          instanceKeys.add(key);
          volumes.add(volume);
        }
      }
      const mesh = node as THREE.Mesh;
      if (mesh.isMesh) {
        if (insideGroom || volume) groomMeshes.add(mesh);
        for (
          const material of Array.isArray(mesh.material)
            ? mesh.material
            : [mesh.material]
        ) {
          if (material) materials.add(material);
        }
      }
      for (const child of node.children) {
        visit(child, insideGroom || Boolean(volume));
      }
    };
    visit(root);
    const lights = options.directional === false
      ? []
      : directionalLights.filter((light) =>
        light.visible && light.intensity > 0
      );
    if (!instances.length || (!lights.length && ambientOcclusion === 0)) {
      this.dispose();
      return this.statistics;
    }
    if (!this.#emptyTexture) {
      this.#emptyTexture = this.#texture(new Uint8Array([0, 0, 0, 255]), 1);
    }
    if (lights.length && !this.#depthMaterial) {
      this.#depthMaterial = new GroomVolumeDepthMaterial();
    }
    const sourceKey = [...instanceKeys].sort().join(";");
    if (ambientOcclusion > 0) {
      const key = `${ambientResolution}|${
        options.ambientDistance ?? "auto"
      }|${sourceKey}`;
      if (this.#ambient?.key !== key) {
        const field = buildAmbientGroomVisibility(instances, {
          resolution: ambientResolution,
          distance: options.ambientDistance,
        });
        const positive = this.#texture(field.positiveData, field.resolution);
        const negative = this.#texture(field.negativeData, field.resolution);
        positive.name = "groom-local-ambient-positive";
        negative.name = "groom-local-ambient-negative";
        this.#ambient?.positive.dispose();
        this.#ambient?.negative.dispose();
        this.#ambient = {
          key,
          positive,
          negative,
          worldToTexture: new THREE.Matrix4().fromArray(field.worldToTexture),
          resolution: field.resolution,
          distance: field.distance,
        };
        this.statistics.ambientBuilds++;
      }
    } else {
      this.#ambient?.positive.dispose();
      this.#ambient?.negative.dispose();
      this.#ambient = undefined;
    }
    this.#uniforms.groomVolumeAmbientPositive.value = this.#ambient?.positive ??
      this.#emptyTexture;
    this.#uniforms.groomVolumeAmbientNegative.value = this.#ambient?.negative ??
      this.#emptyTexture;
    this.#uniforms.groomVolumeAmbientWorldToTexture.value.copy(
      this.#ambient?.worldToTexture ?? new THREE.Matrix4(),
    );
    this.#uniforms.groomVolumeAmbientAmount.value = ambientOcclusion;
    for (let i = 0; i < lights.length; i++) {
      const light = lights[i];
      light.updateWorldMatrix(true, false);
      light.target.updateWorldMatrix(true, false);
      const direction = new THREE.Vector3().setFromMatrixPosition(
        light.matrixWorld,
      )
        .sub(
          new THREE.Vector3().setFromMatrixPosition(light.target.matrixWorld),
        );
      if (direction.lengthSq() < 1e-20) {
        throw new RangeError("Directional light needs a nonzero direction");
      }
      direction.normalize();
      const key = `${resolution}|${sourceKey}|${
        direction.toArray().map((n) => n.toFixed(8)).join(",")
      }`;
      if (this.#maps[i]?.key !== key) {
        const field = buildDirectionalGroomShadow(
          instances,
          direction.toArray(),
          { resolution },
        );
        const texture = this.#texture(field.data, field.resolution);
        this.#maps[i]?.texture.dispose();
        this.#maps[i] = {
          key,
          texture,
          worldToTexture: new THREE.Matrix4().fromArray(field.worldToTexture),
          direction,
        };
        this.statistics.builds++;
      }
    }
    while (this.#maps.length > lights.length) {
      this.#maps.pop()!.texture.dispose();
    }
    for (let i = 0; i < 2; i++) {
      const map = this.#maps[i];
      this.#uniforms[i === 0 ? "groomVolumeMap0" : "groomVolumeMap1"].value =
        map?.texture ?? this.#emptyTexture;
      this.#uniforms[
        i === 0 ? "groomVolumeWorldToTexture0" : "groomVolumeWorldToTexture1"
      ].value.copy(map?.worldToTexture ?? new THREE.Matrix4());
      this.#uniforms[
        i === 0 ? "groomVolumeLightDirection0" : "groomVolumeLightDirection1"
      ].value.copy(map?.direction ?? new THREE.Vector3());
    }
    this.#uniforms.groomVolumeLightCount.value = this.#maps.length;
    for (const [material, patch] of this.#materials) {
      if (!materials.has(material)) this.#restoreMaterial(material, patch);
    }
    for (const material of materials) this.#patchMaterial(material);
    for (const [mesh, patch] of this.#meshes) {
      if (!this.#maps.length || !groomMeshes.has(mesh)) {
        this.#restoreMesh(mesh, patch);
      }
    }
    for (const mesh of this.#maps.length ? groomMeshes : []) {
      if (!this.#meshes.has(mesh)) {
        this.#meshes.set(mesh, {
          castShadow: mesh.castShadow,
          depth: mesh.customDepthMaterial,
        });
      }
      mesh.castShadow = false;
      mesh.customDepthMaterial = this.#depthMaterial;
    }
    Object.assign(this.statistics, {
      instances: instances.length,
      volumes: volumes.size,
      lights: this.#maps.length,
      ambientResolution: this.#ambient?.resolution ?? 0,
      ambientDistance: this.#ambient?.distance ?? 0,
      textureBytes: this.#maps.reduce(
        (sum, map) => sum + (map.texture.image.data?.byteLength ?? 0),
        0,
      ) + (this.#ambient?.positive.image.data?.byteLength ?? 0) +
        (this.#ambient?.negative.image.data?.byteLength ?? 0),
    });
    return this.statistics;
  }

  /** Call after deliberate in-place edits to registered CPU volume buffers. */
  invalidate(): void {
    for (const map of this.#maps) map.key = "";
    if (this.#ambient) this.#ambient.key = "";
  }

  /** Release maps and restore prior material hooks, depth materials and cast flags. */
  dispose(): void {
    for (const [material, patch] of this.#materials) {
      this.#restoreMaterial(material, patch);
    }
    for (const [mesh, patch] of this.#meshes) this.#restoreMesh(mesh, patch);
    for (const map of this.#maps) map.texture.dispose();
    this.#maps = [];
    this.#ambient?.positive.dispose();
    this.#ambient?.negative.dispose();
    this.#ambient = undefined;
    this.#emptyTexture?.dispose();
    this.#emptyTexture = undefined;
    this.#depthMaterial?.dispose();
    this.#depthMaterial = undefined;
    this.#uniforms.groomVolumeMap0.value =
      this.#uniforms.groomVolumeMap1
        .value =
        null;
    this.#uniforms.groomVolumeLightCount.value = 0;
    this.#uniforms.groomVolumeAmbientPositive.value =
      this.#uniforms.groomVolumeAmbientNegative.value =
        null;
    this.#uniforms.groomVolumeAmbientAmount.value = 0;
    Object.assign(this.statistics, {
      instances: 0,
      volumes: 0,
      lights: 0,
      ambientResolution: 0,
      ambientDistance: 0,
      textureBytes: 0,
    });
  }
}
