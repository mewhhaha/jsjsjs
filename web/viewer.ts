import * as THREE from "three";
import { createNavigation } from "./navigation.ts";
import { AnimationControls } from "./animation-controls.ts";
import { animationClips } from "../src/animation.ts";
import { GLTFExporter } from "three/addons/exporters/GLTFExporter.js";
import { OBJExporter } from "three/addons/exporters/OBJExporter.js";
import type { BuildState } from "../src/server.ts";
import type {
  GroomExportGroup,
  ModelInspection,
  ModelView,
  ViewerAPI,
} from "./api.ts";
import { captureImposter } from "./imposter.ts";
import { matchGroomShadowCoverage } from "../src/hair/hair-shading.ts";
import { GroomVolumeShadows } from "../src/hair/groom-volume-shadows.ts";
import {
  collectGroomAssets,
  encodeGroomAssetFile,
  GROOM_ASSET_FILES,
} from "../src/hair/groom-assets.ts";

const canvas = document.querySelector("canvas")!;

let model: THREE.Object3D | null = null;
const groomVolumeShadows = new GroomVolumeShadows();
let requestedRevision = 0;
let eventSequence = 0;
const scene = new THREE.Scene();
scene.background = new THREE.Color("#202522");
const camera = new THREE.PerspectiveCamera(38, 1, 0.01, 10000);
const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
const gl = renderer.getContext();
const rendererInfo = gl.getExtension("WEBGL_debug_renderer_info");
const device = rendererInfo
  ? String(gl.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL))
  : "unknown";
const software = /swiftshader|llvmpipe|lavapipe|software/i.test(device);
const pixelRatio = Math.min(devicePixelRatio, software ? 1 : 2);
renderer.setPixelRatio(pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.4;
const controls = createNavigation(camera, canvas, {
  change: requestRender,
  start: moving,
  end: settled,
});
const hemisphere = new THREE.HemisphereLight("#e8f0db", "#47564e", 2.4);
scene.add(hemisphere);
const key = new THREE.DirectionalLight("#fff3d6", 3);
key.position.set(4, 7, 5);
scene.add(key, key.target);
const fill = new THREE.DirectionalLight("#b7cddd", 2);
fill.position.set(-5, 3, -4);
scene.add(fill, fill.target);
let grid = new THREE.GridHelper(12, 24, "#627060", "#39463d");
scene.add(grid);

function configureShadows(object: THREE.Object3D, bounds: THREE.Box3) {
  const enabled = object.userData.preview?.lighting?.shadows === true;
  renderer.shadowMap.enabled = enabled;
  renderer.shadowMap.type = enabled ? THREE.VSMShadowMap : THREE.PCFShadowMap;
  renderer.shadowMap.needsUpdate = enabled;
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  const radius = Math.max(sphere.radius, .01);
  // Transmitted hair responds to light from either side. An unshadowed fill
  // would shine through the head and incorrectly bleach all front-facing hair.
  for (
    const [light, position] of [
      [key, new THREE.Vector3(4, 7, 5)],
      [fill, new THREE.Vector3(-5, 3, -4)],
    ] as const
  ) {
    light.castShadow = enabled;
    const shadow = light.shadow, shadowCamera = shadow.camera;
    if (enabled) {
      const extent = radius * 1.06;
      // Keep usual light directions while following translated/scaled models.
      light.target.position.copy(sphere.center);
      light.position.copy(sphere.center).addScaledVector(
        position.normalize(),
        radius * 3,
      );
      shadow.mapSize.set(2048, 2048);
      shadowCamera.left = shadowCamera.bottom = -extent;
      shadowCamera.right = shadowCamera.top = extent;
      shadowCamera.near = radius * .5;
      shadowCamera.far = radius * 4.5;
      shadow.bias = -.00015;
      shadow.normalBias = radius * .006;
      shadow.radius = 5;
      shadow.blurSamples = 8;
      shadow.needsUpdate = true;
    } else {
      light.position.copy(position);
      light.target.position.set(0, 0, 0);
      shadow.map?.dispose();
      shadow.mapPass?.dispose();
      shadow.map = shadow.mapPass = null;
      shadow.mapSize.set(512, 512);
      shadowCamera.left = shadowCamera.bottom = -5;
      shadowCamera.right = shadowCamera.top = 5;
      shadowCamera.near = .5;
      shadowCamera.far = 500;
      shadow.bias = shadow.normalBias = 0;
      shadow.radius = 1;
      shadow.needsUpdate = false;
    }
    shadowCamera.updateProjectionMatrix();
    light.target.updateMatrixWorld(true);
    light.updateMatrixWorld(true);
  }
  if (enabled) {
    object.traverse((child) => {
      if ((child as THREE.Mesh).isMesh) {
        const mesh = child as THREE.Mesh;
        if (mesh.userData.threejsGroomShadowCoverage === true) {
          matchGroomShadowCoverage(mesh);
        }
        const materials = Array.isArray(mesh.material)
          ? mesh.material
          : [mesh.material];
        // Translucent overlays such as brows/lashes must not cast opaque sheets.
        const overlay = materials.every((paint) =>
          paint.transparent && !paint.depthWrite
        );
        const authored = mesh.userData.previewShadows;
        mesh.castShadow = typeof authored?.cast === "boolean"
          ? authored.cast
          : !overlay;
        mesh.receiveShadow = typeof authored?.receive === "boolean"
          ? authored.receive
          : !overlay;
      }
    });
  }
}

let pendingFrame = 0;
const animation = new AnimationControls(render);
function render() {
  if (pendingFrame) cancelAnimationFrame(pendingFrame);
  pendingFrame = 0;
  if (model) {
    const lighting = model.userData.preview?.lighting;
    groomVolumeShadows.update(model, [key, fill], camera, {
      enabled: lighting?.shadows === true,
      directional: lighting?.hairShadows !== false,
      resolution: lighting?.hairShadowResolution ?? 96,
      ambientOcclusion: lighting?.hairAmbientOcclusion ?? 1,
      ambientResolution: lighting?.hairAmbientResolution ?? 64,
      ambientDistance: lighting?.hairAmbientDistance,
    });
  }
  renderer.render(scene, camera);
}
function requestRender() {
  if (!pendingFrame) pendingFrame = requestAnimationFrame(render);
}
function resize() {
  const { width, height } = canvas.getBoundingClientRect();
  renderer.setSize(width, height, false);
  camera.aspect = width / Math.max(height, 1);
  camera.updateProjectionMatrix();
  render();
}
new ResizeObserver(resize).observe(canvas);
// Keep software fallback responsive while dragging; settle at full resolution.
let settleTimer: ReturnType<typeof setTimeout> | undefined;
function moving() {
  if (!software) return;
  clearTimeout(settleTimer);
  if (renderer.getPixelRatio() !== pixelRatio * 0.5) {
    renderer.setPixelRatio(pixelRatio * 0.5);
  }
  requestRender();
}
function settled() {
  if (!software) return;
  settleTimer = setTimeout(() => {
    if (renderer.getPixelRatio() !== pixelRatio) {
      renderer.setPixelRatio(pixelRatio);
    }
    requestRender();
  }, 120);
}

const viewDirections: Record<ModelView, [number, number, number]> = {
  iso: [1.2, 0.85, 1.5],
  front: [0, 0, 1],
  back: [0, 0, -1],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  // A tiny offset avoids the pole singularity with Y-up OrbitControls.
  top: [0, 1, 0.000001],
  bottom: [0, -1, 0.000001],
};

function setView(view: ModelView) {
  if (!Object.hasOwn(viewDirections, view)) {
    throw new Error(`Unknown model view: ${view}`);
  }
  fit(view);
}

function fit(view?: ModelView) {
  if (!model) return;
  const sphere = new THREE.Box3().setFromObject(model).getBoundingSphere(
    new THREE.Sphere(),
  );
  const preview = view ? undefined : model.userData.preview;
  const radius = Number.isFinite(preview?.radius) && preview.radius > 0
    ? preview.radius
    : Math.max(sphere.radius, 0.01);
  if (
    Array.isArray(preview?.target) && preview.target.length === 3 &&
    preview.target.every(Number.isFinite)
  ) {
    sphere.center.fromArray(preview.target);
  }
  const vertical = THREE.MathUtils.degToRad(camera.fov / 2);
  const horizontal = Math.atan(Math.tan(vertical) * camera.aspect);
  const direction = view
    ? new THREE.Vector3(...viewDirections[view])
    : Array.isArray(preview?.direction) && preview.direction.length === 3 &&
        preview.direction.every(Number.isFinite)
    ? new THREE.Vector3(...preview.direction as [number, number, number])
    : new THREE.Vector3(1.2, 0.85, 1.5);
  const padding = Number.isFinite(preview?.padding)
    ? Math.max(preview.padding, 1)
    : 1.2;
  const distance = radius / Math.sin(Math.min(vertical, horizontal)) * padding;
  controls.target.copy(sphere.center);
  camera.position.copy(sphere.center).add(
    direction.normalize().multiplyScalar(distance),
  );
  camera.near = Math.max(radius / 1000, 0.00001);
  camera.far = Math.max(distance * 100, 100);
  camera.updateProjectionMatrix();
  controls.update();
  render();
}

function inspect(): ModelInspection {
  if (!model) throw new Error("No model is ready to inspect.");
  model.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(model);
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const objects: ModelInspection["objects"] = [];
  const warnings = new Set<string>();
  const counts = {
    objects: 0,
    meshes: 0,
    instances: 0,
    geometries: 0,
    materials: 0,
    vertices: 0,
    triangles: 0,
  };
  const materialNames = new Map<THREE.Material, string>();
  model.traverse((child) => {
    const mesh = child as THREE.Mesh;
    const geometry = mesh.geometry;
    const objectMaterials =
      (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).filter(
        Boolean,
      );
    for (const material of objectMaterials) {
      materials.add(material);
      if (!materialNames.has(material)) {
        materialNames.set(
          material,
          material.name || `material_${materialNames.size + 1}`,
        );
      }
    }
    const vertices = geometry?.getAttribute("position")?.count ?? 0;
    const elements = geometry?.index?.count ?? vertices;
    const triangles = mesh.isMesh ? Math.floor(elements / 3) : 0;
    const instances = mesh.isMesh
      ? (mesh as THREE.InstancedMesh).isInstancedMesh
        ? (mesh as THREE.InstancedMesh).count
        : 1
      : 0;
    let visible = true;
    for (
      let ancestor: THREE.Object3D | null = child;
      ancestor;
      ancestor = ancestor.parent
    ) {
      visible &&= ancestor.visible;
      if (ancestor === model) break;
    }
    if (geometry) geometries.add(geometry);
    if (mesh.isMesh) {
      counts.meshes++;
      counts.instances += instances;
      counts.vertices += vertices * instances;
      counts.triangles += triangles * instances;
      if (!vertices) {
        warnings.add(`Mesh ${child.name || child.type} has no vertices.`);
      }
      if (elements % 3) {
        warnings.add(
          `Mesh ${child.name || child.type} has an incomplete triangle.`,
        );
      }
      if (instances > 1) {
        warnings.add(
          "Instanced meshes may not be preserved by every export format.",
        );
      }
      if (
        geometry &&
        (geometry.drawRange.start !== 0 ||
          Number.isFinite(geometry.drawRange.count))
      ) {
        warnings.add(
          "Vertex and triangle counts include full geometry, including portions outside draw ranges.",
        );
      }
    }
    if (!visible) {
      warnings.add(
        "The model contains hidden objects; export formats may handle visibility differently.",
      );
    }
    objects.push({
      name: child.name,
      type: child.type,
      visible,
      vertices,
      triangles,
      instances,
      materials: objectMaterials.map((material) =>
        materialNames.get(material)!
      ),
    });
  });
  counts.objects = objects.length;
  counts.geometries = geometries.size;
  counts.materials = materials.size;
  if (!counts.meshes) warnings.add("The model contains no triangle meshes.");
  return {
    animations: animation.state().clips,
    bounds: {
      min: bounds.min.toArray(),
      max: bounds.max.toArray(),
      size: bounds.getSize(new THREE.Vector3()).toArray(),
      center: bounds.getCenter(new THREE.Vector3()).toArray(),
    },
    counts,
    objects,
    materials: [...materials].map((material) => {
      const color = (material as THREE.MeshStandardMaterial).color;
      return {
        name: materialNames.get(material)!,
        type: material.type,
        color: color?.isColor ? `#${color.getHexString()}` : null,
        opacity: material.opacity,
        transparent: material.transparent,
      };
    }),
    warnings: [...warnings],
  };
}

function dispose(object: THREE.Object3D) {
  const resources = new Set<{ dispose(): void }>();
  object.traverse((child) => {
    const mesh = child as THREE.Mesh;
    if ((mesh as THREE.SkinnedMesh).isSkinnedMesh) {
      resources.add((mesh as THREE.SkinnedMesh).skeleton);
    }
    if (mesh.geometry) resources.add(mesh.geometry);
    const materials = Array.isArray(mesh.material)
      ? mesh.material
      : [mesh.material];
    for (const material of materials) {
      if (!material) continue;
      resources.add(material);
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture) resources.add(value);
      }
    }
  });
  for (const resource of resources) resource.dispose();
}

function exportOBJ() {
  if (!model) throw new Error("No model is ready to export.");
  model.updateMatrixWorld(true);
  // Export the authored model only: no viewer lighting or grid.
  return new OBJExporter().parse(model);
}
const glbChunkSize = 3 * 1024 * 1024;

async function createGLB(): Promise<Uint8Array> {
  const release = animation.freeze(true);
  try {
    return await createPinnedGLB();
  } finally {
    release();
  }
}

async function createPinnedGLB(): Promise<Uint8Array> {
  if (!model) throw new Error("No model is ready to export.");
  const snapshot = model;
  const sequence = eventSequence;
  model.updateMatrixWorld(true);
  const buffer = await new GLTFExporter().parseAsync(model, {
    binary: true,
    animations: animationClips(model),
  });
  if (snapshot !== model || sequence !== eventSequence) {
    throw new Error(
      "Model changed during GLB export; retry after the rebuild completes.",
    );
  }
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 20) {
    throw new Error("GLB exporter returned an empty or invalid binary buffer.");
  }
  const bytes = new Uint8Array(buffer);
  const header = new DataView(buffer);
  if (
    header.getUint32(0, true) !== 0x46546c67 ||
    header.getUint32(4, true) !== 2 ||
    header.getUint32(8, true) !== bytes.byteLength
  ) {
    throw new Error(
      "GLB exporter returned an invalid header or binary length.",
    );
  }
  let offset = 12;
  while (offset < bytes.byteLength) {
    if (offset + 8 > bytes.byteLength) {
      throw new Error("GLB exporter returned a truncated chunk header.");
    }
    const length = header.getUint32(offset, true);
    const type = header.getUint32(offset + 4, true);
    if (
      length % 4 !== 0 || offset + 8 + length > bytes.byteLength ||
      (offset === 12 && (type !== 0x4e4f534a || length === 0))
    ) throw new Error("GLB exporter returned an invalid chunk.");
    offset += 8 + length;
  }
  return bytes;
}

function encodeGLBChunk(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 32768));
  }
  const encoded = btoa(binary);
  if (encoded.length !== Math.ceil(bytes.byteLength / 3) * 4) {
    throw new Error("GLB base64 encoding returned an incomplete chunk.");
  }
  return encoded;
}

async function exportGLB() {
  const bytes = await createGLB();
  // V8 cannot represent the >512 MiB base64 string produced by a large GLB.
  if (bytes.byteLength > 384 * 1024 * 1024 - 64) {
    throw new Error(
      "GLB is too large for one base64 string; use js3 export or uploadGLB.",
    );
  }
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += glbChunkSize) {
    chunks.push(encodeGLBChunk(bytes.subarray(offset, offset + glbChunkSize)));
  }
  return chunks.join("");
}

/** POST one file to a CLI receiver; its response reports any rejection. */
async function upload(url: string, path: string, bytes: Uint8Array) {
  const target = new URL(url, location.href);
  target.searchParams.set("path", path);
  const response = await fetch(target, {
    method: "POST",
    headers: { "content-type": "application/octet-stream" },
    body: bytes as Uint8Array<ArrayBuffer>,
  });
  const message = await response.text();
  if (!response.ok) {
    throw new Error(
      `Upload of ${path} failed (${response.status}): ${message}`,
    );
  }
}

async function uploadGLB(url: string) {
  await upload(url, "model.glb", await createGLB());
}

async function uploadGrooms(url: string): Promise<GroomExportGroup[]> {
  if (!model || !api.ready || api.error) {
    throw new Error("No model is ready to export.");
  }
  const snapshot = model;
  const sequence = eventSequence;
  const assets = collectGroomAssets(model);
  for (const asset of assets) {
    for (const filename of GROOM_ASSET_FILES) {
      const bytes = await encodeGroomAssetFile(asset, filename);
      if (snapshot !== model || sequence !== eventSequence || !api.ready) {
        throw new Error(
          "Model changed during groom export; retry after the rebuild completes.",
        );
      }
      await upload(url, `${asset.directory}/${filename}`, bytes);
    }
  }
  return assets.map((asset) => ({
    name: asset.name,
    directory: asset.directory,
    files: {
      source: `${asset.directory}/groom.json`,
      manifest: `${asset.directory}/manifest.json`,
      coverage: `${asset.directory}/coverage.png`,
      normal: `${asset.directory}/normal.png`,
      tangent: `${asset.directory}/tangent.png`,
      depth: `${asset.directory}/depth.png`,
      attributes: `${asset.directory}/attributes.png`,
    },
  }));
}

const api: ViewerAPI = {
  ready: false,
  revision: 0,
  error: null,
  exportOBJ,
  exportGLB,
  uploadGLB,
  uploadGrooms,
  inspect,
  setView,
  fit,
  render,
  animationState: () => animation.state(),
  playAnimation: (clip, options) => animation.play(clip, options),
  pauseAnimation: () => animation.pause(),
  sampleAnimation: (clip, time, options) => animation.seek(clip, time, options),
  resetAnimation: () => animation.reset(),
  async captureImposter(options = {}) {
    if (!model || !api.ready || api.error) {
      throw new Error("No model is ready to capture.");
    }
    const snapshot = model;
    const sequence = eventSequence;
    const release = animation.freeze();
    try {
      return await captureImposter(
        snapshot,
        [hemisphere, key, fill],
        {
          toneMapping: renderer.toneMapping,
          exposure: renderer.toneMappingExposure,
          outputColorSpace: renderer.outputColorSpace,
        },
        options,
        () => {
          if (snapshot !== model || sequence !== eventSequence || !api.ready) {
            throw new Error(
              "Model changed during imposter capture; retry after the rebuild completes.",
            );
          }
        },
      );
    } finally {
      release();
    }
  },
};
window.modelViewer = api;

function reportError(error: unknown) {
  if (animation.state().playing) animation.pause();
  api.ready = false;
  api.error = error instanceof Error
    ? error.stack ?? error.message
    : String(error);
  console.error(api.error);
}

async function load(state: BuildState) {
  if (state.error) {
    eventSequence++;
    reportError(state.error);
    return;
  }
  if (!state.revision || state.revision === requestedRevision) return;
  requestedRevision = state.revision;
  if (animation.state().playing) animation.pause();
  const sequence = ++eventSequence;
  api.ready = false;
  api.error = null;
  let next: THREE.Object3D | undefined;
  try {
    const module = await import(`/model.js?v=${state.revision}`);
    if (typeof module.default !== "function") {
      throw new Error(
        "Model files must export default function buildModel() returning a Three.js Object3D (or Promise<Object3D>).",
      );
    }
    next = await module.default();
    if (!next?.isObject3D) {
      throw new Error(
        "buildModel() must return a Three.js Object3D, Mesh, Group, or Scene.",
      );
    }
    if (sequence !== eventSequence) {
      dispose(next);
      return;
    }
    const bounds = new THREE.Box3().setFromObject(next);
    if (
      bounds.isEmpty() || ![...bounds.min, ...bounds.max].every(Number.isFinite)
    ) {
      throw new Error("The model has no finite geometry to display.");
    }
    animation.load(next);
    const first = !model;
    if (model) {
      groomVolumeShadows.dispose();
      scene.remove(model);
      dispose(model);
    }
    model = next;
    const exposure = model.userData.preview?.exposure;
    renderer.toneMappingExposure = Number.isFinite(exposure) && exposure > 0
      ? exposure
      : 1.4;
    const preview = model.userData.preview;
    const intensity = (value: unknown, fallback: number) =>
      typeof value === "number" && Number.isFinite(value) && value >= 0
        ? value
        : fallback;
    hemisphere.intensity = intensity(preview?.lighting?.hemisphere, 2.4);
    key.intensity = intensity(preview?.lighting?.key, 3);
    fill.intensity = intensity(preview?.lighting?.fill, 2);
    scene.background = new THREE.Color(preview?.background ?? "#202522");
    scene.add(model);
    configureShadows(model, bounds);
    const extent = Math.max(...bounds.getSize(new THREE.Vector3()).toArray());
    const visible = grid.visible;
    scene.remove(grid);
    dispose(grid);
    grid = new THREE.GridHelper(extent * 3, 24, "#627060", "#39463d");
    grid.position.set(
      bounds.getCenter(new THREE.Vector3()).x,
      bounds.min.y - extent * 0.002,
      bounds.getCenter(new THREE.Vector3()).z,
    );
    grid.visible = typeof preview?.grid === "boolean" ? preview.grid : visible;
    scene.add(grid);
    if (first) {
      resize();
      fit();
    } else render();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => {
        render();
        resolve();
      })
    );
    if (sequence !== eventSequence) return;
    api.revision = state.revision;
    api.ready = true;
    api.error = null;
  } catch (error) {
    if (next?.isObject3D && next !== model) dispose(next);
    if (sequence === eventSequence) reportError(error);
  }
}

const events = new EventSource("/events");
events.onmessage = (event) => {
  void load(JSON.parse(event.data));
};
addEventListener("keydown", (event) => {
  if (
    (event.target as HTMLElement)?.closest(
      "input, select, button, textarea, [contenteditable]",
    )
  ) return;
  if (event.key.toLowerCase() === "f") fit();
});
addEventListener("error", (event) => reportError(event.error ?? event.message));
addEventListener("unhandledrejection", (event) => reportError(event.reason));
