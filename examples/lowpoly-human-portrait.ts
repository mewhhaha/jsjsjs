import buildHuman from "./lowpoly-human.ts";

// Same complete rig, with camera framing for checking the face materials.
export default async function buildModel() {
  const model = await buildHuman();
  model.userData.preview = {
    direction: [0.25, 0.02, 1],
    target: [0, 1.5, 0],
    radius: 0.3,
    padding: 1.02,
    exposure: 0.85,
  };
  return model;
}
