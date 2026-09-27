/** Change STYLE to inspect one interchangeable wig on the default head. */
import { buildHaircut, type HaircutStyle } from "./haircuts/catalog.ts";

// bald | buzz | crop | side-part | bob | waves | curls | ponytail | braids
const STYLE: HaircutStyle = "waves";

export default async function buildModel() {
  const model = await buildHaircut(STYLE);
  model.userData.preview = {
    grid: false,
    background: "#20282f",
    direction: [.3, .02, 1],
    target: [0, .48, 0],
    radius: 1.18,
    padding: 1.03,
    exposure: 1.12,
    lighting: { hemisphere: 1.4, key: 1.3, fill: 1.4, shadows: true },
  };
  return model;
}
