import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Save to hot reload. Rotations are local joint offsets, in degrees.
export const pose: Record<string, [number, number, number]> = {
  upperarm_l: [0, 0, 12],
  upperarm_r: [0, 0, -12],
};
const wireframe = false;

export default async function buildModel(): Promise<THREE.Scene> {
  const { scene } = await new GLTFLoader().loadAsync(
    "/assets/lowpoly-human/character.glb",
  );
  const model = new THREE.Scene();
  model.name = "Lowpoly_human";
  model.add(...scene.children);
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (material instanceof THREE.MeshStandardMaterial) {
        material.wireframe = wireframe;
        for (
          const texture of [
            material.map,
            material.normalMap,
            material.roughnessMap,
          ]
        ) {
          if (texture) texture.anisotropy = 4;
        }
      }
    }
  });
  for (const [name, degrees] of Object.entries(pose)) {
    const bone = model.getObjectByName(name);
    if (!(bone instanceof THREE.Bone)) {
      throw new Error(`Unknown joint: ${name}`);
    }
    bone.quaternion.multiply(new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        ...degrees.map(THREE.MathUtils.degToRad) as [number, number, number],
      ),
    ));
  }
  model.userData.preview = {
    direction: [0.25, 0.08, 1],
    padding: 1.02,
    exposure: 0.85,
  };
  model.updateMatrixWorld(true);
  return model;
}
