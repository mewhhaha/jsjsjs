/** CC0 MakeHuman portrait bust, fitted to the wigs' shared Y-up frame. */
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

export const HEAD = {
  center: [0, 0.78, 0] as const,
  radii: [0.46, 0.62, 0.4] as const,
  scalpRadii: [0.472, 0.636, 0.413] as const,
};

export interface HeadOptions {
  /** Multiplies the embedded freckled skin atlas; omit to retain its skin tone. */
  skin?: THREE.ColorRepresentation;
  /** Multiplies the embedded iris atlas. */
  eyeColor?: THREE.ColorRepresentation;
  browColor?: THREE.ColorRepresentation;
  /** Override when hosting the derived head asset outside examples/. */
  assetUrl?: string;
}

const sources = new Map<string, Promise<THREE.Group>>();

/**
 * Naturalistic face, ears, eyes and neck from the bundled MakeHuman base.
 * Geometry and textures are shared; each head owns its materials and transforms.
 * See assets/CREDITS.md for provenance and the reproducible preparation script.
 */
export async function buildHead(
  options: HeadOptions = {},
): Promise<THREE.Group> {
  const url = options.assetUrl ?? "/assets/haircuts/assets/head.glb";
  if (!sources.has(url)) {
    const pending = new GLTFLoader().loadAsync(url).then((gltf) => gltf.scene);
    sources.set(url, pending);
    pending.catch(() => sources.delete(url));
  }
  const root = (await sources.get(url)!).clone(true);
  root.name = "neutral human bust";
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const adjust = (original: THREE.Material): THREE.Material => {
      const material = original.clone();
      if (material instanceof THREE.MeshStandardMaterial) {
        if (material.name === "portrait_head_skin") {
          material.color.set(options.skin ?? "#e9eff3");
          material.roughness = 0.66;
        } else if (material.name === "portrait_eyes") {
          material.color.set(options.eyeColor ?? "#ffffff");
          material.roughness = 0.21;
        } else if (material.name === "portrait_eyebrows") {
          material.color.set(options.browColor ?? "#ffffff");
          material.roughness = 0.9;
        }
        if (/portrait_eye(brows|lashes)/.test(material.name)) {
          // Brows and lashes are small, isolated overlays. Blending preserves
          // their soft individual fibers better than a hard alpha cutout.
          material.alphaTest = 0.015;
          material.transparent = true;
          material.depthWrite = false;
          material.alphaToCoverage = false;
        }
        if (material.map) material.map.anisotropy = 8;
      }
      return material;
    };
    object.material = Array.isArray(object.material)
      ? object.material.map(adjust)
      : adjust(object.material);
  });
  root.userData.source = "MakeHuman / MPFB CC0 graphical assets";
  root.userData.preview = {
    background: "#182126",
    grid: false,
    direction: [0.25, 0.04, 1],
    target: [0, 0.45, 0],
    radius: 1.12,
    padding: 1.06,
    exposure: 0.95,
    lighting: { hemisphere: 0.85, key: 2.8, fill: 0.65 },
  };
  return root;
}

export default buildHead;
