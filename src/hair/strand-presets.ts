/** Convenient starting grooms; use hair() for fully custom strand systems. */
import * as THREE from "three";
import { hair, type HairOptions } from "./strands.ts";

/** Same explicit roots/groom/render controls as hair(); all preset values can be overridden. */
export type FurOptions = HairOptions;
export type GrassOptions = HairOptions;

/** Short dense fur. Dimensions are in the same units as the emitter surface. */
export function fur(
  surface: Parameters<typeof hair>[0],
  options: FurOptions = {},
): THREE.Group {
  return hair(surface, {
    roots: { count: 12000, seed: 1, ...options.roots },
    groom: {
      length: 0.065,
      lengthVariation: 0.25,
      radius: 0.003,
      tipRadius: 0,
      direction: [0, -0.3, 0.1],
      bend: [0, -0.015, 0],
      frizz: { amplitude: 0.0015, frequency: 3 },
      segments: 8,
      ...options.groom,
    },
    render: {
      mode: "tubes",
      radialSegments: 4,
      color: "#715b48",
      tipColor: "#9f8669",
      colorVariation: 0.16,
      name: "fur",
      ...options.render,
    },
  });
}

/** Tapered grass blades. The emitter normals set growth direction; use an upward-facing surface. */
export function grass(
  surface: Parameters<typeof hair>[0],
  options: GrassOptions = {},
): THREE.Group {
  return hair(surface, {
    roots: { count: 1200, seed: 1, ...options.roots },
    groom: {
      length: 0.35,
      lengthVariation: 0.4,
      radius: 0.012,
      tipRadius: 0,
      bend: [0.08, 0, 0.025],
      segments: 8,
      ...options.groom,
    },
    render: {
      mode: "ribbons",
      ribbonPlanes: 2,
      color: "#326324",
      tipColor: "#90b748",
      colorVariation: 0.25,
      name: "grass",
      ...options.render,
    },
  });
}
