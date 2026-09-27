/** A separate authored auburn updo with uneven fringe and a loose rear knot. */
import * as THREE from "three";
import { buildHead } from "./haircuts/head.ts";
import { buildMessyBun } from "./haircuts/messy-bun.ts";

export default async function buildModel() {
  const group = new THREE.Group();
  group.name = "auburn-fringe-and-loose-bun";
  group.add(await buildHead(), buildMessyBun());
  group.userData.preview = {
    grid: false,
    background: "#252a30",
    direction: [.38, .055, 1],
    target: [0, .69, -.07],
    radius: 1.03,
    padding: 1.04,
    exposure: 1.12,
    lighting: { hemisphere: 1.6, key: 2, fill: .3, shadows: true },
  };
  return group;
}
