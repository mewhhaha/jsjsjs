import {
  bevel,
  box,
  cylinder,
  group,
  material,
  offsetProfile,
  subtract,
} from "js3";

/** Async factories can use robust solid operations and profile offsets. */
export default async function buildModel() {
  const metal = material({ color: "#489ca3", metalness: .45, roughness: .3 });
  const plate = await subtract(box([3, .35, 2]), [
    cylinder(.35, 1, { position: [-.8, 0, 0] }),
    cylinder(.35, 1, { position: [.8, 0, 0] }),
  ], { material: metal, name: "drilled-plate", position: [0, .175, 0] });
  const [outline] = await offsetProfile([[-1, -.5], [1, -.5], [1, .5], [
    -1,
    .5,
  ]], .1);
  const profile = bevel(outline, {
    depth: .25,
    amount: .06,
    material: metal,
    position: [0, 1, 0],
    name: "beveled-profile",
  });
  return group([plate, profile], {
    name: "solid-modeling",
    preview: { grid: false },
  });
}
