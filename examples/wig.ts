/** A detached wig for reuse/export; change STYLE to any non-bald catalog entry. */
import { buildWig, type HaircutStyle } from "./haircuts/catalog.ts";

const STYLE: Exclude<HaircutStyle, "bald"> = "waves";

export default function buildModel() {
  const wig = buildWig(STYLE);
  wig.userData.preview = {
    grid: false,
    background: "#20282f",
    direction: [.3, .08, 1],
    padding: 1.1,
    exposure: 1.1,
  };
  return wig;
}
