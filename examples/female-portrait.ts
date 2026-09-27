import buildFemale from "./female.ts";
import { applyPortraitMaterials } from "./female-portrait-materials.ts";
import { Vector3 } from "three";

export default async function buildModel() {
  const model = await buildFemale({
    hairAsset: "/assets/female-portrait/hair.glb",
    pose: {
      spine_01: [0, -9, 4],
      spine_02: [0, -10, -7],
      spine_03: [0, 0, -3],
      neck_01: [3, -5, 4],
      head: [12, 45, 11],
      clavicle_r: [0, 0, 5],
      upperarm_r: [10, 0, 45],
      lowerarm_r: [0, 0, 35],
      hand_r: [0, 0, -5],
      index_01_r: [25, 0, 0],
      index_02_r: [20, 0, 0],
      middle_01_r: [32, 0, 0],
      middle_02_r: [26, 0, 0],
      ring_01_r: [38, 0, 0],
      ring_02_r: [30, 0, 0],
      pinky_01_r: [44, 0, 0],
      pinky_02_r: [34, 0, 0],
      thumb_01_r: [18, 0, 0],
      thumb_02_r: [20, 0, 0],
      clavicle_l: [0, 0, -4],
      upperarm_l: [8, 0, -35],
      lowerarm_l: [0, 0, 0],
    },
  });
  await applyPortraitMaterials(model);
  const head = model.getObjectByName("head")!;
  const center = head.getWorldPosition(new Vector3());
  center.y -= .18;
  model.userData.preview = {
    direction: [0.48, 0.02, 1],
    target: center.toArray(),
    radius: 0.42,
    padding: 1.02,
    exposure: .92,
    background: "#101715",
    grid: false,
    lighting: { hemisphere: .85, key: 3.2, fill: .65 },
  };
  return model;
}
