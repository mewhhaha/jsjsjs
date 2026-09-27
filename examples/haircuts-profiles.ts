/** Matching side views of all eight wigs and the neutral fitting head. */
import { haircutGallery } from "./haircuts.ts";

export default function buildModel() {
  return haircutGallery(Math.PI / 2 - .12);
}
