/** A gathered updo with a swept fringe, graded roots, and fine escaping ends. */
import * as THREE from "three";
import { strandRandom } from "../../src/strand-data.ts";
import {
  createGroom,
  type GroomGuide,
  type GroomLayer,
  type GuideGroom,
} from "../../src/groom-data.ts";
import { buildGroom, type GroomRenderOptions } from "../../src/groom.ts";
import { hairline, scalpPoint } from "./shared.ts";
import { addBunFolds, type BunFoldOptions } from "./bun-folds.ts";

type V = THREE.Vector3;
type XYZ = [number, number, number];
const TAU = Math.PI * 2;
const v = (x: number, y: number, z: number): V => new THREE.Vector3(x, y, z);
const tuple = (p: V): XYZ => [p.x, p.y, p.z];
const direction = (p: V): V =>
  v(p.x / .472, (p.y - .78) / .636, p.z / .413).normalize();
const normal = (p: V): V =>
  v(p.x / .472 ** 2, (p.y - .78) / .636 ** 2, p.z / .413 ** 2).normalize();
const smooth = (a: number, b: number, x: number): number =>
  THREE.MathUtils.smoothstep(x, a, b);

/** Separate wig in the shared anatomical head frame. All volume is hair. */
export function buildMessyBunGroom(): GuideGroom {
  const rng = strandRandom(33071);
  const guides: GroomGuide[] = [];
  let section = "interior";
  const counts = new Map<string, number>();

  function add(
    points: V[],
    width: number,
    options: BunFoldOptions & { rootWidth?: number } = {},
  ): void {
    const index = counts.get(section) ?? 0;
    counts.set(section, index + 1);
    const tip = options.tip ?? .035;
    const root = options.rootWidth ?? .45;
    guides.push({
      id: `${section}-${index}`,
      layer: section,
      region: section,
      points: points.map(tuple),
      width: points.map((_, i) => {
        const t = i / (points.length - 1);
        return width * THREE.MathUtils.lerp(root, 1, smooth(0, .16, t)) *
          (1 - (1 - tip) * smooth(.68, 1, t));
      }),
      normals: (options.normals ?? points.map(normal)).map(tuple),
    });
  }

  const tie = v(-.055, 1.06, -.390);
  const target = direction(tie);
  const boundary = (phi: number): number =>
    hairline(phi) - .045 - .105 * Math.exp(-((Math.cos(phi) / .43) ** 2)) +
    .027 * Math.sin(phi * 3 + .7) + .015 * Math.sin(phi * 7 + .4) +
    .006 * Math.sin(phi * 19 - .5);

  // Broad flow changes are shared by neighboring guides. Fine variation sits
  // inside those locks, instead of producing unrelated ripples on every card.
  function gathered(
    theta: number,
    phi: number,
    elevation: number,
    looseness = 0,
  ): V[] {
    const start = direction(scalpPoint(theta, phi));
    const patch = .5 + .32 * Math.sin(phi * 4.1 + .7) +
      .18 * Math.sin(phi * 8.3 - .6);
    return Array.from({ length: 33 }, (_, j) => {
      const t = j / 32;
      const n = start.clone().lerp(target, t).normalize();
      const a = Math.atan2(n.x, n.z) +
        (.055 * Math.sin(phi * 2.4 + .8) + .026 * Math.sin(phi * 6.2)) *
          Math.sin(Math.PI * t);
      const lift = -.0007 + .006 * smooth(0, .06, t) +
        (.019 + .016 * patch + elevation) * Math.sin(Math.PI * t) ** .85 +
        looseness * Math.sin(Math.PI * t) ** 2;
      const p = scalpPoint(
        Math.acos(THREE.MathUtils.clamp(n.y, -1, 1)),
        a,
        lift,
      );
      p.x += .007 * Math.sin(phi * 3.7 + t * 4.7) * Math.sin(Math.PI * t);
      return p.lerp(
        tie.clone().add(v(.031 * Math.sin(phi), .024 * Math.cos(phi), -.006)),
        smooth(.84, 1, t),
      );
    });
  }

  // The denser root band bridges the fine hairline into the interior. Roots
  // remain inset and staggered, while deeper fibers support the crown rather
  // than concentrating all of the underlayer far behind the visible hairline.
  for (let i = 0; i < 480; i++) {
    const phi = (i + rng()) / 480 * TAU;
    const root = rng();
    const theta = i % 8 < 5
      ? boundary(phi) - .08 - .12 * root ** .8
      : (boundary(phi) - .18) * (.12 + .88 * Math.sqrt(root));
    add(gathered(theta, phi, -.012), .014 + rng() * .008, {
      tip: .25,
      rootWidth: .85,
    });
  }

  // Unequal flow families put a loose bend above the right temple and a lower
  // return on the opposite side. Each family shares a primary gesture; shorter
  // overlapping locks interrupt its long grooves without adding surface noise.
  const families = [
    { end: .66, sweep: -.08, turn: .10, roll: .024, crest: .40 },
    { end: 1.40, sweep: .30, turn: -.13, roll: .047, crest: .48 },
    { end: 2.30, sweep: .19, turn: .09, roll: .032, crest: .60 },
    { end: 3.18, sweep: -.10, turn: .18, roll: .021, crest: .53 },
    { end: 4.08, sweep: -.23, turn: -.13, roll: .035, crest: .42 },
    { end: 5.04, sweep: -.15, turn: .12, roll: .026, crest: .64 },
    { end: 5.70, sweep: .12, turn: -.08, roll: .043, crest: .44 },
    { end: TAU, sweep: .07, turn: .14, roll: .028, crest: .56 },
  ];
  function crownLock(
    theta: number,
    phi: number,
    variation: number,
    secondary: boolean,
  ): V[] {
    const familyIndex = Math.max(
      0,
      families.findIndex((item) => phi < item.end),
    );
    const next = families[familyIndex];
    const previous =
      families[(familyIndex + families.length - 1) % families.length];
    const startAngle = familyIndex ? previous.end : 0;
    const blend = smooth(startAngle, next.end, phi);
    const family = {
      sweep: THREE.MathUtils.lerp(previous.sweep, next.sweep, blend),
      turn: THREE.MathUtils.lerp(previous.turn, next.turn, blend),
      roll: THREE.MathUtils.lerp(previous.roll, next.roll, blend),
      crest: THREE.MathUtils.lerp(previous.crest, next.crest, blend),
    };
    const start = direction(scalpPoint(theta, phi));
    const duration = secondary ? .54 + .27 * variation : 1;
    const crest = family.crest + (secondary ? -.13 : 0);
    return Array.from({ length: 37 }, (_, j) => {
      const t = j / 36, u = t * duration;
      const n = start.clone().lerp(target, u).normalize();
      const arc = Math.sin(Math.PI * u);
      const a = Math.atan2(n.x, n.z) +
        family.sweep * arc + family.turn * Math.sin(TAU * u) * arc +
        (secondary ? .055 : -.018) * arc;
      const polar = Math.acos(THREE.MathUtils.clamp(n.y, -1, 1)) +
        .042 * Math.sin(TAU * u + family.sweep) * arc;
      // A broad off-center rise gives each lock volume. Its short overlap
      // returns below the outer surface at both ends, avoiding a cut seam.
      const lobe = Math.exp(-(((t - crest) / .30) ** 2)) *
        Math.sin(Math.PI * t);
      const lift = -.0005 + .005 * smooth(0, .05, t) +
        (family.roll + .009 + variation * .004) * lobe +
        .013 * Math.sin(Math.PI * t);
      const p = scalpPoint(
        polar,
        a,
        secondary ? lift - .010 * smooth(.75, 1, t) : lift,
      );
      return secondary ? p : p.lerp(
        tie.clone().add(v(.028 * Math.sin(phi), .027 * Math.cos(phi), -.009)),
        smooth(.85, 1, t),
      );
    });
  }
  for (let i = 0; i < 770; i++) {
    // Four placement draws retain the existing fringe and hairline placement.
    const phi = (i + rng() * .85) / 770 * TAU;
    const root = rng(), variation = rng(), width = rng();
    const secondary = i % 7 < 2;
    section = secondary ? "crown-overlap" : "crown";
    const theta = secondary
      ? boundary(phi) * (.43 + .36 * root)
      : boundary(phi) - .042 - .12 * root ** .72;
    add(
      crownLock(theta, phi, variation, secondary),
      secondary ? .005 + width * .004 : .0045 + width * .0035,
      { tip: secondary ? .015 : .19, rootWidth: secondary ? .58 : .92 },
    );
  }

  // A progressively lighter perimeter gives individual roots room to emerge.
  // The same flow then grows into the denser crown; there is no fitted cap.
  section = "hairline";
  for (let i = 0; i < 440; i++) {
    const phi = (i + rng() * .9) / 440 * TAU;
    // Most full-length roots sit inside the edge; fine short hairs carry the
    // sparse transition onto skin instead of a row of equally heavy roots.
    const inward = -.006 + .075 * Math.sqrt(rng());
    const theta = boundary(phi) - inward;
    add(gathered(theta, phi, .001 + rng() * .006), .003 + rng() * .0035, {
      tip: .12,
      rootWidth: .90,
    });
  }

  // One asymmetric sweep crosses the forehead. Neighboring families have
  // different ends, exposing skin between fine tapered locks rather than
  // outlining a uniform curtain at eyebrow height.
  section = "fringe";
  const fringe = [
    { root: .70, phi: -.97, end: 1.77, bend: -.12, span: .10, count: 43 },
    { root: .73, phi: -.69, end: 1.66, bend: -.17, span: .15, count: 54 },
    { root: .70, phi: -.42, end: 1.58, bend: -.20, span: .16, count: 58 },
    { root: .65, phi: -.04, end: 1.57, bend: -.12, span: .18, count: 65 },
    { root: .69, phi: .23, end: 1.47, bend: -.02, span: .12, count: 40 },
    { root: .82, phi: .66, end: 1.41, bend: .18, span: .17, count: 54 },
    { root: .85, phi: .92, end: 1.58, bend: .24, span: .14, count: 40 },
  ];
  for (let family = 0; family < fringe.length; family++) {
    const lock = fringe[family];
    for (let i = 0; i < lock.count; i++) {
      const across = (i + rng() * .7) / lock.count * 2 - 1;
      const start = .34 + rng() * .19;
      const end = lock.end - .05 * Math.abs(across) + (rng() - .5) * .075;
      const lift = .037 + rng() * .019 + .014 * Math.cos(across * Math.PI);
      const points = Array.from({ length: 33 }, (_, j) => {
        const t = j / 32;
        const theta = THREE.MathUtils.lerp(start, end, t);
        const phi = THREE.MathUtils.lerp(lock.root, lock.phi, t ** 1.12) +
          lock.bend * Math.sin(Math.PI * t) +
          across * lock.span * (.72 + .28 * Math.sin(Math.PI * t));
        const p = scalpPoint(
          theta,
          phi,
          .005 + lift * Math.sin(Math.PI * t) +
            (.014 + .008 * Math.sin(i * 2.2)) * smooth(.62, 1, t),
        );
        p.x += .016 * Math.sin(family * 1.9 + .3) * smooth(.66, 1, t);
        return p;
      });
      add(points, .004 + rng() * .0045, { tip: .016, rootWidth: .32 });
    }
  }

  section = "bun";
  addBunFolds(add);

  // Sub-clumps share a centerline but occupy an irregular filled section.
  function bundle(
    controls: V[],
    count: number,
    spread: number,
    depth: number,
    width: number,
  ): void {
    const center = new THREE.CatmullRomCurve3(controls).getPoints(36);
    for (let i = 0; i < count; i++) {
      const angle = rng() * TAU, radial = Math.sqrt(rng());
      const across = Math.cos(angle) * radial * spread;
      const outward = Math.sin(angle) * radial * depth;
      const phase = rng() * TAU;
      const length = .81 + rng() * .19;
      const points: V[] = [], normals: V[] = [];
      for (let j = 0; j < center.length; j++) {
        const t = j / (center.length - 1);
        const u = t * length * (center.length - 1);
        const index = Math.min(center.length - 2, Math.floor(u));
        const p = center[index].clone().lerp(center[index + 1], u - index);
        const tangent = center[index + 1].clone().sub(center[index])
          .normalize();
        const n = normal(p).addScaledVector(tangent, -normal(p).dot(tangent));
        if (n.lengthSq() < 1e-8) n.set(0, 0, 1);
        n.normalize();
        const side = n.clone().cross(tangent).normalize();
        const envelope = .2 + .8 * Math.sin(Math.PI * t) ** .8;
        p.addScaledVector(side, across * envelope)
          .addScaledVector(
            n,
            outward * envelope +
              .0015 * Math.sin(8 * t + phase) * Math.sin(Math.PI * t),
          );
        points.push(p);
        normals.push(n);
      }
      add(points, width * (.65 + rng() * .5), {
        normals,
        tip: .006,
        rootWidth: .20,
      });
    }
  }

  section = "gather";
  const knot = v(-.075, 1.13, -.465);
  for (let i = 0; i < 70; i++) {
    const phi = Math.PI + (rng() - .5) * 1.1;
    const root = scalpPoint(.77 + rng() * .31, phi, .010);
    const offset = (rng() - .5) * .085;
    const family = i % 3;
    const turn = family === 0 ? -.05 : family === 1 ? .035 : .065;
    const curve = new THREE.CatmullRomCurve3([
      root,
      tie.clone().add(v(offset + turn, .052 - family * .014, .012)),
      knot.clone().add(v(offset + turn * .5, .050 - family * .025, -.010)),
      knot.clone().add(v(offset * .7 - turn, -.014, -.072 + family * .02)),
    ]);
    add(curve.getPoints(32), .005 + rng() * .005, { tip: .09 });
  }

  // Only a few face-framing wisps escape the swept fringe. Ends separate in
  // length and curl direction, and taper before the jaw instead of forming
  // identical thick ribbons on both cheeks.
  section = "temples";
  for (const sign of [-1, 1]) {
    for (let lock = 0; lock < 2; lock++) {
      const x = sign * (.35 + lock * .027);
      const end = sign < 0 ? .50 + lock * .14 : .64 + lock * .15;
      bundle(
        [
          scalpPoint(1.13 + lock * .11, sign * (.91 + lock * .14), .004),
          v(x + sign * .035, .91, .365 - lock * .025),
          v(x + sign * .065, .73, .39 - lock * .025),
          v(x + sign * .024, end, .365 - lock * .030),
          v(x - sign * .005, end - .025, .375 - lock * .032),
        ],
        lock ? 10 : 19,
        .010,
        .0035,
        .0045,
      );
    }
  }

  // These short hairs actually start on the nape. Sparse, uneven curls break
  // the neck perimeter without dangling from the bun attachment.
  section = "nape";
  for (let lock = 0; lock < 7; lock++) {
    const phi = Math.PI + (lock - 3) * .14;
    const theta = boundary(phi) - .10 - rng() * .045;
    const root = scalpPoint(theta, phi, .002);
    const end = .46 + rng() * .08;
    bundle(
      [
        root,
        root.clone().add(v(.013 * Math.sin(lock), -.055, -.011)),
        v(root.x + .02 * Math.sin(lock * 1.6), end + .045, root.z - .008),
        v(root.x + .018 * Math.cos(lock), end, root.z + .020),
      ],
      lock % 3 === 0 ? 12 : 7,
      .006,
      .002,
      .0035,
    );
  }

  section = "baby";
  for (let i = 0; i < 300; i++) {
    const phi = rng() * TAU;
    const root = rng(), extent = rng(), height = rng();
    const fine = i % 5 < 3;
    const theta = boundary(phi) + (fine ? .017 : -.030) -
      (fine ? .075 : .065) * Math.sqrt(root);
    const length = fine
      ? .014 + .036 * extent ** 1.3
      : .040 + .088 * extent ** 1.25;
    const lift = fine ? .0007 + .0018 * height : .0025 + .003 * height;
    const points = Array.from({ length: 15 }, (_, j) => {
      const t = j / 14;
      return scalpPoint(
        theta - length * t,
        phi + (fine ? .026 : .065) * Math.sin(phi + .4) * t,
        -.0002 + .0004 * smooth(0, .25, t) + lift * Math.sin(Math.PI * t),
      );
    });
    add(points, fine ? .0025 + .0013 * height : .0035 + .002 * extent, {
      tip: .03,
      rootWidth: .95,
    });
    // Keep the editable baby-N IDs while giving the outer hairs less pigment
    // and a finer physical radius. Their roots begin slightly below the skin.
    if (fine) guides[guides.length - 1].layer = "baby-fine";
  }

  section = "flyaway";
  for (let i = 0; i < 76; i++) {
    const phi = rng() * TAU;
    const theta = .27 + rng() * .8;
    const length = .12 + rng() * .20;
    const height = .025 + rng() * .035;
    const points = Array.from({ length: 21 }, (_, j) => {
      const t = j / 20;
      return scalpPoint(
        theta + length * t,
        phi + .17 * t,
        .009 + height * Math.sin(Math.PI * t),
      );
    });
    add(points, .0008, { tip: .03 });
  }

  const settings: Record<string, Partial<GroomLayer>> = {
    interior: { children: 40, radius: .00024, clump: .10, frizz: .0002 },
    crown: {
      children: 16,
      radius: .00019,
      clump: .18,
      depth: .34,
      lengthVariation: .045,
    },
    "crown-overlap": {
      children: 18,
      radius: .00019,
      clump: .28,
      depth: .35,
      lengthVariation: .10,
    },
    hairline: {
      children: 8,
      radius: .00016,
      clump: .12,
      lengthVariation: .05,
    },
    fringe: {
      children: 24,
      radius: .00019,
      clump: .25,
      lengthVariation: .07,
      frizz: .0004,
    },
    bun: { children: 40, clump: .18, lengthVariation: .045 },
    gather: { children: 26, clump: .26, depth: .36 },
    temples: { children: 18, clump: .38, lengthVariation: .22 },
    nape: { children: 10, clump: .35, lengthVariation: .24 },
    baby: {
      kind: "flyaway",
      children: 5,
      radius: .000115,
      lengthVariation: .22,
      color: "#513727",
      tipColor: "#76533b",
      frizz: 0,
    },
    "baby-fine": {
      kind: "flyaway",
      children: 3,
      radius: .000075,
      lengthVariation: .28,
      color: "#725440",
      tipColor: "#89664b",
      roughness: .58,
      frizz: 0,
    },
    flyaway: { kind: "flyaway", children: 1, radius: .00018, frizz: 0 },
  };
  return createGroom({
    version: 1,
    seed: 33071,
    name: "wig-messy-bun",
    guides,
    layers: [...new Set(guides.map((guide) => guide.layer))].map((id) => ({
      id,
      kind: "hair" as const,
      children: 24,
      radius: .00022,
      tipRadius: .00001,
      clump: .20,
      lengthVariation: .035,
      frizz: .00045,
      flyaways: 0,
      color: "#43271b",
      tipColor: "#76503a",
      roughness: .48,
      ...settings[id],
    })),
  });
}

export function buildMessyBun(options: GroomRenderOptions = {}): THREE.Group {
  return buildGroom(buildMessyBunGroom(), options);
}
