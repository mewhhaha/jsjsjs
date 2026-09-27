/** Compact folded hair, built entirely from layered card guides. */
import * as THREE from "three";
import { strandRandom } from "../../src/strand-data.ts";

type V = THREE.Vector3;
const TAU = Math.PI * 2;
const v = (x: number, y: number, z: number): V => new THREE.Vector3(x, y, z);
const center = v(-.075, 1.155, -.520);
const radii = v(.157, .148, .130);

export interface BunFoldOptions {
  normals?: V[];
  tip?: number;
  fibers?: number;
  loose?: boolean;
  shade?: number;
}

export type AddBunFold = (
  points: V[],
  width: number,
  options: BunFoldOptions,
) => void;

function outward(p: V): V {
  return p.clone().sub(center).divide(radii).divide(radii).normalize();
}

/** Smooth facing frames, including the buried returns where radial facing fails. */
function frames(points: V[]): { normal: V; side: V }[] {
  let previous = v(0, 0, -1);
  return points.map((p, i) => {
    const tangent = points[Math.min(i + 1, points.length - 1)].clone()
      .sub(points[Math.max(0, i - 1)]).normalize();
    const normal = outward(p);
    normal.addScaledVector(tangent, -normal.dot(tangent));
    if (normal.lengthSq() < .00001) {
      normal.copy(previous).addScaledVector(tangent, -previous.dot(tangent));
    }
    if (normal.lengthSq() < .00001) {
      normal.set(0, 1, 0).addScaledVector(tangent, -tangent.y);
    }
    normal.normalize();
    // Card sections keep their orientation when a fold returns into the core.
    if (i > 0 && normal.dot(previous) < 0) normal.negate();
    previous = normal.clone();
    return { normal, side: normal.clone().cross(tangent).normalize() };
  });
}

/**
 * Adds 432 guides in the anatomical head frame. The dense buried crossings
 * support three broad folded locks; none of the visible volume uses a solid cap.
 */
export function addBunFolds(add: AddBunFold, seed = 33073): void {
  const rng = strandRandom(seed);
  // Seat the knot against the gathered scalp instead of leaving a visible
  // gap between the back of the skull and the starts of the folded locks.
  const attachment = v(0, -.025, .055);
  const emit: AddBunFold = (points, width, options) =>
    add(points.map((point) => point.clone().add(attachment)), width, options);

  // Buried crossings occupy the volume. The exposed wrap follows one coherent
  // axis, so intersecting layers never make a sawtooth patch on its surface.
  const rotations = [
    new THREE.Euler(.25, .48, -.38),
    new THREE.Euler(1.12, -.25, .70),
    new THREE.Euler(-.65, .82, -.94),
  ];
  for (let family = 0; family < 3; family++) {
    for (let i = 0; i < 70; i++) {
      const buried = family === 0;
      const rank = buried ? i : (family - 1) * 70 + i;
      const latitude = buried
        ? -.89 + 1.78 * (rank + rng() * .8) / 70
        : -.97 + 1.94 * (rank + rng() * .8) / 140;
      const ring = Math.sqrt(1 - latitude * latitude);
      const depthNoise = rng();
      const depth = buried
        ? .35 + depthNoise * .44
        : .958 + .005 * depthNoise + .006 * Math.cos(latitude * 4.2);
      const phase = rng() * TAU;
      const rotation = rotations[buried ? i % 3 : 0];
      const segments = buried ? 36 : 48;
      const points: V[] = [];
      for (let j = 0; j <= segments; j++) {
        const t = j / segments;
        const angle = phase + t * TAU * (buried ? 1.025 : 1.28);
        // Staggered roots and tips sink well under their neighbors. The extra
        // partial turn gives full coverage before the textured tips thin out.
        const envelope = .67 + .33 *
            THREE.MathUtils.smoothstep(t, 0, .11) *
            (1 - THREE.MathUtils.smoothstep(t, .83, 1));
        const unit = v(
          ring * Math.cos(angle),
          ring * Math.sin(angle),
          latitude + (buried ? .02 : .003) * Math.sin(angle * 2 + .4),
        ).applyEuler(rotation);
        points.push(
          unit.multiply(radii).multiplyScalar(depth * envelope).add(center),
        );
      }
      emit(points, (buried ? .014 : .008) + rng() * .003, {
        normals: frames(points).map((frame) => frame.normal),
        tip: .28,
        fibers: !buried && i % 10 === 0 ? 1 : 0,
        shade: .93 + rng() * .025,
      });
    }
  }

  function fold(
    controls: V[],
    count: number,
    spread: number,
    thickness: number,
    width: number,
    raised = false,
  ): void {
    const path = new THREE.CatmullRomCurve3(controls).getPoints(36);
    const frame = frames(path);
    for (let i = 0; i < count; i++) {
      // A filled section, not a perimeter of tubes around an empty interior.
      const angle = rng() * TAU;
      const radius = Math.sqrt(rng());
      const lateral = Math.cos(angle) * radius * spread;
      const lift = Math.sin(angle) * radius * thickness;
      const phase = rng() * TAU;
      const points = path.map((p, j) => {
        const t = j / (path.length - 1);
        const envelope = .66 + .34 * Math.sin(Math.PI * t);
        return p.clone()
          .addScaledVector(frame[j].side, lateral * envelope)
          .addScaledVector(
            frame[j].normal,
            lift * envelope + .0018 * Math.sin(7 * t + phase) *
                Math.sin(Math.PI * t),
          );
      });
      emit(points, width * (.86 + rng() * .25), {
        normals: frame.map((item) => item.normal.clone()),
        tip: .18,
        fibers: raised ? 4 : 3,
        loose: i % (raised ? 9 : 27) === 0,
        shade: .97 + rng() * .05,
      });
    }
  }

  // Upper fold rolls over the filled center and buries its return at the base.
  fold(
    [
      v(-.12, 1.11, -.427),
      v(-.205, 1.225, -.510),
      v(-.115, 1.303, -.575),
      v(.045, 1.242, -.625),
      v(.042, 1.105, -.590),
      v(-.05, 1.075, -.465),
    ],
    70,
    .054,
    .028,
    .010,
  );

  // A low transverse lock crosses the back instead of circling a central hole.
  fold(
    [
      v(-.12, 1.115, -.430),
      v(-.221, 1.128, -.533),
      v(-.180, 1.185, -.655),
      v(-.070, 1.147, -.675),
      v(.058, 1.090, -.591),
      v(-.010, 1.067, -.448),
    ],
    70,
    .050,
    .027,
    .009,
  );

  // The diagonal return crosses both earlier folds and closes the side view.
  fold(
    [
      v(.006, 1.108, -.432),
      v(.080, 1.163, -.527),
      v(.027, 1.250, -.625),
      v(-.115, 1.248, -.665),
      v(-.214, 1.139, -.601),
      v(-.126, 1.052, -.472),
      v(-.040, 1.101, -.433),
    ],
    70,
    .048,
    .025,
    .010,
  );

  // One smaller released loop interrupts the compact outline without carrying
  // the main volume or leaving the whole bun suspended above its attachment.
  fold(
    [
      v(-.105, 1.195, -.475),
      v(-.040, 1.305, -.512),
      v(-.082, 1.330, -.589),
      v(-.197, 1.302, -.635),
      v(-.226, 1.181, -.559),
      v(-.125, 1.099, -.459),
    ],
    12,
    .012,
    .006,
    .003,
    true,
  );
}
