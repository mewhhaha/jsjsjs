import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

// Low-poly adult body; loose hair is a separately loaded and rigged asset.
export const showHair = true;
export const pose: Record<string, [number, number, number]> = {
  upperarm_l: [0, 0, 15],
  upperarm_r: [0, 0, -15],
};
// Optional static offsets, e.g. HairLeft_02: [15, 0, 0].
// Five independent chains have six bones each (_01.._06):
// HairLeft, HairLeftBack, HairBack, HairRightBack, HairRight.
// A runtime physics solver can drive these same local bone rotations.
export const hairPose: Record<string, [number, number, number]> = {};

export default async function buildModel(
  options: {
    hair?: boolean;
    hairAsset?: string;
    pose?: Record<string, [number, number, number]>;
    hairPose?: Record<string, [number, number, number]>;
  } = {},
): Promise<THREE.Scene> {
  const loader = new GLTFLoader();
  const body = await loader.loadAsync("/assets/female/character.glb");
  const model = new THREE.Scene();
  model.name = "Female_character";
  model.add(...body.scene.children);
  model.updateMatrixWorld(true);
  const includeHair = options.hair ?? showHair;
  if (includeHair) {
    const hair = await loader.loadAsync(
      options.hairAsset ?? "/assets/female-flowing-hair/flowing.glb",
    );
    model.add(...hair.scene.children);
    model.updateMatrixWorld(true);
    const head = model.getObjectByName("head");
    const anchor = model.getObjectByName("HairAnchor");
    if (!head || !anchor) {
      throw new Error("Missing head or hair attachment bone");
    }
    head.attach(anchor);
  }
  for (
    const [name, degrees] of Object.entries(
      includeHair
        ? { ...pose, ...hairPose, ...options.pose, ...options.hairPose }
        : { ...pose, ...options.pose },
    )
  ) {
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
    direction: [0.4, 0.1, 1],
    padding: 1.02,
    exposure: 1.0,
  };
  model.updateMatrixWorld(true);
  return model;
}
