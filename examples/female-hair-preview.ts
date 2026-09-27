import buildFemale from "./female.ts";
import { Vector3 } from "three";

// Same complete character, framed from behind to inspect the separate hair rig.
export default async function buildModel() {
  const model = await buildFemale();
  const center = model.getObjectByName("head")!.getWorldPosition(new Vector3());
  center.y -= .09;
  model.userData.preview = {
    direction: [0.8, 0.1, -1],
    target: center.toArray(),
    radius: 0.35,
    padding: 1.02,
    exposure: 1.0,
  };
  return model;
}
