import * as THREE from "three";
import { clone } from "three/addons/utils/SkeletonUtils.js";
import { matchGroomShadowCoverage } from "../src/hair-shading.ts";
import {
  type ImposterManifest,
  type ImposterOptions,
  makeImposterLayout,
  resolveImposterOptions,
} from "./imposter-layout.ts";

/** Clone the root's complete world transform without changing the authored model. */
function snapshot(model: THREE.Object3D): THREE.Object3D {
  model.updateWorldMatrix(true, true);
  const result = clone(model);
  // Mesh.copy omits these runtime shadow overrides. In particular, groom
  // volume shadows suppress binary card writes into the opaque VSM pass.
  function preserveShadowMaterials(
    source: THREE.Object3D,
    target: THREE.Object3D,
  ) {
    if ((source as THREE.Mesh).isMesh && (target as THREE.Mesh).isMesh) {
      const from = source as THREE.Mesh, to = target as THREE.Mesh;
      to.customDepthMaterial = from.customDepthMaterial;
      to.customDistanceMaterial = from.customDistanceMaterial;
    }
    source.children.forEach((child, index) => {
      preserveShadowMaterials(child, target.children[index]);
    });
  }
  preserveShadowMaterials(model, result);
  result.matrixAutoUpdate = false;
  result.matrix.copy(model.matrixWorld);
  result.matrixWorld.copy(model.matrixWorld);
  result.updateMatrixWorld(true);
  return result;
}

function snapshotLight(light: THREE.Light): THREE.Light {
  const result = snapshot(light) as THREE.Light;
  if (
    light instanceof THREE.DirectionalLight || light instanceof THREE.SpotLight
  ) {
    const target = snapshot(light.target);
    (result as THREE.DirectionalLight | THREE.SpotLight).target = target;
  }
  return result;
}

/** Only resources created by cloning; shared geometry/materials remain owned by the model. */
function disposeSnapshot(model: THREE.Object3D) {
  const skeletons = new Set<THREE.Skeleton>();
  model.traverse((object) => {
    if (object instanceof THREE.SkinnedMesh) skeletons.add(object.skeleton);
    if (object instanceof THREE.InstancedMesh) object.dispose();
  });
  for (const skeleton of skeletons) skeleton.dispose();
}

/** Capture an orthographic, transparent, lit color atlas without changing the viewer. */
export async function captureImposter(
  model: THREE.Object3D,
  lights: readonly THREE.Light[],
  settings: {
    toneMapping: THREE.ToneMapping;
    exposure: number;
    outputColorSpace: string;
  },
  options: ImposterOptions,
  assertCurrent: () => void,
): Promise<{ png: string; manifest: ImposterManifest }> {
  assertCurrent();
  const resolved = resolveImposterOptions(options);
  model.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(model);
  if (
    bounds.isEmpty() ||
    ![...bounds.min.toArray(), ...bounds.max.toArray()].every(Number.isFinite)
  ) {
    throw new Error(
      "An imposter requires a model with finite, nonempty bounds.",
    );
  }
  const sphere = bounds.getBoundingSphere(new THREE.Sphere());
  sphere.radius = Math.max(sphere.radius, 0.0001);
  const manifest = makeImposterLayout(
    resolved,
    sphere.center.toArray(),
    sphere.radius,
  );
  const atlas = document.createElement("canvas");
  atlas.width = manifest.atlas.width;
  atlas.height = manifest.atlas.height;
  const context = atlas.getContext("2d", { alpha: true });
  if (!context) {
    throw new Error("Could not allocate a 2D canvas for the imposter atlas.");
  }
  context.clearRect(0, 0, atlas.width, atlas.height);

  const scene = new THREE.Scene();
  let copy: THREE.Object3D | undefined;
  let renderer: THREE.WebGLRenderer | undefined;
  try {
    copy = snapshot(model);
    copy.traverse((object) => {
      if (
        (object as THREE.Mesh).isMesh &&
        object.userData.threejsGroomShadowCoverage
      ) {
        matchGroomShadowCoverage(object as THREE.Mesh);
      }
    });
    scene.add(copy);
    for (const light of lights) {
      const lightCopy = snapshotLight(light);
      scene.add(lightCopy);
      if (
        lightCopy instanceof THREE.DirectionalLight ||
        lightCopy instanceof THREE.SpotLight
      ) scene.add(lightCopy.target);
    }
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        preserveDrawingBuffer: true,
        powerPreference: "high-performance",
      });
    } catch (error) {
      throw new Error(
        "Could not create a WebGL renderer for imposter capture.",
        { cause: error },
      );
    }
    const gl = renderer.getContext();
    const maximum = Math.min(
      renderer.capabilities.maxTextureSize,
      gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      ...gl.getParameter(gl.MAX_VIEWPORT_DIMS),
    );
    const contentSize = resolved.tileSize - resolved.gutter * 2;
    if (contentSize > maximum) {
      throw new Error(
        `Imposter tile content ${contentSize}px exceeds the WebGL limit of ${maximum}px.`,
      );
    }
    renderer.setPixelRatio(1);
    renderer.setSize(contentSize, contentSize, false);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = settings.toneMapping;
    renderer.toneMappingExposure = settings.exposure;
    renderer.outputColorSpace = settings.outputColorSpace;
    renderer.shadowMap.enabled =
      model.userData.preview?.lighting?.shadows === true;
    renderer.shadowMap.type = THREE.VSMShadowMap;
    const halfExtent = sphere.radius * resolved.padding;
    const camera = new THREE.OrthographicCamera(
      -halfExtent,
      halfExtent,
      halfExtent,
      -halfExtent,
      sphere.radius / 1000,
      sphere.radius * 6,
    );
    for (const [index, frame] of manifest.tiles.entries()) {
      assertCurrent();
      camera.position.copy(sphere.center).addScaledVector(
        new THREE.Vector3(...frame.direction),
        sphere.radius * 3,
      );
      camera.up.fromArray(frame.up);
      camera.lookAt(sphere.center);
      camera.updateMatrixWorld(true);
      if (index === 0) {
        await renderer.compileAsync(scene, camera);
        assertCurrent();
      }
      renderer.render(scene, camera);
      if (gl.isContextLost()) {
        throw new Error(
          "WebGL context was lost during imposter capture; try fewer or smaller tiles.",
        );
      }
      context.drawImage(
        renderer.domElement,
        frame.contentRect.x,
        frame.contentRect.y,
      );
      if ((index + 1) % resolved.grid === 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        assertCurrent();
      }
    }
    assertCurrent();
    const dataURL = atlas.toDataURL("image/png");
    if (!dataURL.startsWith("data:image/png;base64,")) {
      throw new Error(
        "The browser could not encode the imposter atlas; try fewer or smaller tiles.",
      );
    }
    return { png: dataURL.slice("data:image/png;base64,".length), manifest };
  } finally {
    if (copy) disposeSnapshot(copy);
    renderer?.dispose();
    renderer?.forceContextLoss();
    atlas.width = 0;
    atlas.height = 0;
  }
}
