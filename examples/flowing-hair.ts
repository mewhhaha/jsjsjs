import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as THREE from "three";

// Separate asset in the same rest-world coordinates as the female body.
export default async function buildModel() {
  const { scene } = await new GLTFLoader().loadAsync(
    "/assets/female-flowing-hair/flowing.glb",
  );
  const model = new THREE.Scene();
  model.name = "Flowing_hair";
  model.add(...scene.children);
  model.userData.preview = {
    direction: [.8, .1, -1],
    padding: 1.04,
    exposure: 1.0,
  };
  return model;
}
