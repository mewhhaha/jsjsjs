import * as THREE from "three";
import { buildHead, type HeadOptions } from "./head.ts";
import { buildBraids, buildBuzz, buildCurls } from "./coiled.ts";
import {
  buildBob,
  buildCrop,
  buildPonytail,
  buildSidePart,
  buildWaves,
} from "./realistic.ts";

export const HAIRCUTS = [
  { id: "bald", label: "BASE HEAD", build: () => new THREE.Group() },
  { id: "buzz", label: "BUZZ CUT", build: buildBuzz },
  { id: "crop", label: "TEXTURED CROP", build: buildCrop },
  { id: "side-part", label: "SIDE PART", build: buildSidePart },
  { id: "bob", label: "PARTED BOB", build: buildBob },
  { id: "waves", label: "LONG WAVES", build: buildWaves },
  { id: "curls", label: "CURLY CROP", build: buildCurls },
  { id: "ponytail", label: "GATHERED PONYTAIL", build: buildPonytail },
  { id: "braids", label: "TWIN BRAIDS", build: buildBraids },
] as const;

export type HaircutStyle = typeof HAIRCUTS[number]["id"];

/** The bald reference returns an empty group; every other entry is a detached wig. */
export function buildWig(style: HaircutStyle): THREE.Group {
  const entry = HAIRCUTS.find((entry) => entry.id === style);
  if (!entry) throw new Error(`Unknown haircut: ${style}`);
  const wig = entry.build();
  wig.name = `wig-${style}`;
  wig.userData.haircut = style;
  return wig;
}

/** All wigs share the base head's local frame and can be removed or exchanged. */
export async function buildHaircut(
  style: HaircutStyle,
  options: HeadOptions = {},
): Promise<THREE.Group> {
  const result = new THREE.Group();
  const head = await buildHead(options);
  head.name = "base-head";
  const wig = buildWig(style);
  result.add(head, wig);
  result.name = `haircut-${style}`;
  result.userData.haircut = style;
  return result;
}
