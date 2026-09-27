/** Change STYLE to "bob" for the second sculpted hairstyle. */
import {
  buildCartoonHaircut,
  type CartoonHairStyle,
} from "./haircuts/cartoon.ts";

const STYLE: CartoonHairStyle = "quiff";
export default () => buildCartoonHaircut(STYLE);
