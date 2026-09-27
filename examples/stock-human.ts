import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Stock MakeHuman mesh, UVs, and game_engine skeleton. See stock-human/CREDITS.md.
// Local joint rotations, in degrees, added to the imported rest pose.
// Use {} for the original A-pose. Bone names are in stock-human/manifest.json.
export const pose: Record<string, [number, number, number]> = {
  upperarm_l: [0, 0, 12],
  upperarm_r: [0, 0, -12],
};

export default async function buildModel(): Promise<THREE.Scene> {
  const gltf = await new GLTFLoader().loadAsync("/assets/stock-human/base.glb");
  const model = new THREE.Scene();
  model.name = "Stock_human";
  // Scene roots keep skinned meshes exportable without extra parent transforms.
  model.add(...gltf.scene.children);
  for (const [name, degrees] of Object.entries(pose)) {
    const bone = model.getObjectByName(name);
    if (!(bone instanceof THREE.Bone)) {
      throw new Error(`Unknown stock rig joint: ${name}`);
    }
    const offset = new THREE.Quaternion().setFromEuler(
      new THREE.Euler(
        ...degrees.map(THREE.MathUtils.degToRad) as [number, number, number],
      ),
    );
    bone.quaternion.multiply(offset);
  }
  model.userData.preview = { direction: [0.25, 0.08, 1], padding: 1.02 };
  model.updateMatrixWorld(true);
  return model;
}
