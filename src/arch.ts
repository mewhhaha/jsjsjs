import * as THREE from "three";
import { box, extrude, group, type GroupOptions, material } from "./prelude.ts";

export interface ArchOptions extends GroupOptions {
  material?: THREE.Material | THREE.Material[];
  /** Clear horizontal space between the piers. Defaults to 2. */
  openingWidth?: number;
  /** Clear height from the floor to the inner crown. Defaults to 3. */
  openingHeight?: number;
  /** Front-to-back depth, centered on Z. Defaults to 0.4. */
  depth?: number;
  /** Uniform width of the piers and crown ring. Defaults to 0.25. */
  thickness?: number;
  /** Crown curve resolution; integer >= 4. Defaults to 24. */
  segments?: number;
}

function positive(value: number, name: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new RangeError(`${name} must be finite and positive`);
  }
  return value;
}

/**
 * Semicircular arch with an open passage and separate named piers and crown.
 * Centered on X/Z, standing on Y=0, with its front facing +Z.
 * openingHeight must be at least openingWidth / 2; equality omits the piers.
 */
export function arch(options: ArchOptions = {}): THREE.Group {
  const width = positive(options.openingWidth ?? 2, "openingWidth");
  const height = positive(options.openingHeight ?? 3, "openingHeight");
  const depth = positive(options.depth ?? 0.4, "depth");
  const thickness = positive(options.thickness ?? 0.25, "thickness");
  const segments = options.segments ?? 24;
  if (!Number.isInteger(segments) || segments < 4) {
    throw new RangeError("segments must be an integer >= 4");
  }
  const radius = width / 2;
  const springHeight = height - radius;
  if (springHeight < 0) {
    throw new RangeError("openingHeight must be >= openingWidth / 2");
  }
  const paint = options.material ?? material();
  const children: THREE.Object3D[] = [];
  if (springHeight > 0) {
    for (
      const [name, direction] of [
        ["left_pier", -1],
        ["right_pier", 1],
      ] as const
    ) {
      children.push(box([thickness, springHeight, depth], {
        name,
        position: [direction * (radius + thickness / 2), springHeight / 2, 0],
        material: paint,
      }));
    }
  }

  const profile = new THREE.Shape();
  profile.absarc(0, springHeight, radius + thickness, 0, Math.PI, false);
  profile.lineTo(-radius, springHeight);
  profile.absarc(0, springHeight, radius, Math.PI, 0, true);
  profile.closePath();
  children.push(extrude(profile, {
    name: "crown",
    depth,
    curveSegments: segments,
    position: [0, 0, -depth / 2],
    material: paint,
  }));
  return group(children, options);
}
