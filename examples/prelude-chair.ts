import { group, material, roundedBox } from "js3";

export default function buildModel() {
  const wood = material({ name: "oak", color: "#ae7949", roughness: 0.7 });
  const fabric = material({
    name: "sage fabric",
    color: "#788b6b",
    roughness: 0.95,
  });
  const legs = [-0.85, 0.85].flatMap((x) =>
    [-0.75, 0.75].map((z) =>
      roundedBox([0.16, 1.7, 0.16], 0.025, {
        name: `leg_${x}_${z}`,
        material: wood,
        position: [x, 0.85, z],
      })
    )
  );
  return group([
    ...legs,
    roundedBox([2.1, 0.2, 1.9], 0.06, {
      name: "seat frame",
      material: wood,
      position: [0, 1.7, 0],
    }),
    roundedBox([1.95, 0.22, 1.75], 0.1, {
      name: "seat cushion",
      material: fabric,
      position: [0, 1.9, 0],
    }),
    roundedBox([2, 1.45, 0.18], 0.06, {
      name: "back",
      material: wood,
      position: [0, 2.5, -0.85],
      rotation: [-8, 0, 0],
    }),
  ], { name: "chair", preview: { grid: false } });
}
