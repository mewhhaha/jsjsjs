/** Automatic detail switching; export a fixed level with renderGroom instead. */
import { buildGroomLODs, group } from "js3";
import { buildHead } from "./haircuts/head.ts";
import { buildMessyBunGroom } from "./haircuts/messy-bun.ts";

export default async () =>
  group([
    await buildHead(),
    buildGroomLODs(buildMessyBunGroom(), { distances: [0, 4, 8] }),
  ], {
    preview: {
      grid: false,
      background: "#252a30",
      direction: [.38, .055, 1],
      target: [0, .69, -.07],
      radius: 1.03,
      padding: 1.04,
      exposure: 1.12,
      lighting: { hemisphere: 1.6, key: 2, fill: .3, shadows: true },
    },
  });
