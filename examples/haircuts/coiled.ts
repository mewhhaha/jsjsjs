/** Close-cropped, curly, and braided grooms made from layered fibers and cards. */
import * as THREE from "three";
import { type HairCardGuide, hairCards } from "../../src/hair-cards.ts";
import { type StrandData, strandRandom } from "../../src/strand-data.ts";
import { strands } from "../../src/strands.ts";
import { hairline, scalpPoint } from "./shared.ts";

type V = THREE.Vector3;
type XYZ = [number, number, number];
const TAU = Math.PI * 2;
const v = (x: number, y: number, z: number): V => new THREE.Vector3(x, y, z);
const tuple = (p: V): XYZ => [p.x, p.y, p.z];
const smooth = (t: number): number => t * t * (3 - 2 * t);
function normal(p: V): V {
  return v(p.x / .472 ** 2, (p.y - .78) / .636 ** 2, p.z / .413 ** 2)
    .normalize();
}
function onScalp(n: V, lift: number): V {
  return scalpPoint(
    Math.acos(THREE.MathUtils.clamp(n.y, -1, 1)),
    Math.atan2(n.x, n.z),
    lift,
  );
}
function scalpDirection(p: V): V {
  return v(p.x / .472, (p.y - .78) / .636, p.z / .413).normalize();
}
interface Groom {
  cards: HairCardGuide[];
  fibers: StrandData;
  random: () => number;
}
function create(seed: number): Groom {
  return {
    cards: [],
    fibers: { version: 1, seed, guides: [], strands: [] },
    random: strandRandom(seed),
  };
}
function card(
  g: Groom,
  points: V[],
  width: number,
  normals = points.map(normal),
  tipWidth = .35,
): void {
  g.cards.push({
    points: points.map(tuple),
    normals: normals.map(tuple),
    width: points.map((_, i) => {
      const t = i / (points.length - 1);
      return width * (.78 + .22 * Math.sin(t * Math.PI)) *
        (1 - (1 - tipWidth) * t ** 4);
    }),
    shade: .78 + g.random() * .40,
  });
}
function fiber(
  g: Groom,
  points: V[],
  radius: number,
  shade = .8 + g.random() * .4,
): void {
  g.fibers.strands.push({
    points: points.map(tuple),
    radii: points.map((_, i) =>
      radius * (1 - .95 * (i / (points.length - 1)) ** 1.5)
    ),
    shade,
  });
}
function finish(
  g: Groom,
  name: string,
  color: string,
  tipColor: string,
): THREE.Group {
  const result = new THREE.Group();
  result.name = name;
  if (g.cards.length) {
    result.add(hairCards(g.cards, {
      name: "layered-fiber-cards",
      color,
      tipColor,
      seed: g.fibers.seed,
      density: 1,
      roughness: .53,
      colorVariation: .2,
    }));
  }
  for (let offset = 0; offset < g.fibers.strands.length; offset += 10_000) {
    result.add(
      strands({
        ...g.fibers,
        strands: g.fibers.strands.slice(offset, offset + 10_000),
      }, {
        name: "individual-hairs",
        color,
        tipColor,
        radialSegments: 3,
        colorVariation: .2,
      }),
    );
  }
  result.userData.groom = {
    cards: g.cards.length,
    looseStrands: g.fibers.strands.length,
    representation: "alpha hair cards + fibers",
  };
  return result;
}

/** Fine clipped hairs follow the scalp and fade into short temple/nape stubble. */
export function buildBuzz(): THREE.Group {
  const g = create(4217), rng = g.random;
  for (let i = 0; i < 35_000; i++) {
    const phi = rng() * TAU;
    const limit = hairline(phi);
    const theta = Math.acos(1 - rng() * (1 - Math.cos(limit + .035)));
    const edge = Math.max(0, Math.min(1, (limit + .035 - theta) / .14));
    if (rng() > smooth(edge)) continue;
    const top = Math.max(0, 1 - theta / 1.4);
    const length = (.011 + .034 * top) * (.65 + rng() * .7) *
      (.30 + .70 * edge);
    const heading = .055 + rng() * .025;
    const points = Array.from({ length: 5 }, (_, j) => {
      const t = j / 4;
      return scalpPoint(
        theta + length * 1.3 * t,
        phi + heading * t,
        .003 + length * (.36 * t + .08 * Math.sin(Math.PI * t)),
      );
    });
    fiber(g, points, .00060 + rng() * .00040);
  }
  return finish(g, "wig-buzz", "#241e1a", "#4a3b2d");
}

/** Loose irregular curls with several clump scales and soft overlapping ends. */
export function buildCurls(): THREE.Group {
  const g = create(4302), rng = g.random;
  // Buried scalp-following cards fill the space below the lifted curls. They
  // retain the same individual-fiber alpha pattern instead of forming a shell.
  for (let i = 0; i < 1800; i++) {
    const phi = rng() * TAU;
    const limit = hairline(phi);
    const theta = Math.acos(1 - rng() * (1 - Math.cos(limit - .05)));
    const points = Array.from({ length: 15 }, (_, j) => {
      const t = j / 14;
      return scalpPoint(
        Math.min(limit + .03, theta + .30 * t),
        phi + .08 * Math.sin(Math.PI * t),
        .012 + .012 * Math.sin(Math.PI * t),
      );
    });
    card(g, points, .028 + rng() * .021, undefined, .32);
  }
  for (let i = 0; i < 2500; i++) {
    const phi = rng() * TAU;
    const limit = hairline(phi);
    const theta = Math.acos(1 - rng() * (1 - Math.cos(limit - .025)));
    const layer = Math.floor(rng() * 4);
    const origin = scalpPoint(theta, phi, .004 + layer * .008);
    const n = normal(origin);
    let along = v(.12, -.20, 1).addScaledVector(n, -v(.12, -.20, 1).dot(n));
    if (along.lengthSq() < .03) {
      along = v(0, -1, 0).addScaledVector(n, n.y);
    }
    along.normalize();
    const side = along.clone().cross(n).normalize();
    const phase = rng() * TAU;
    const radius = .018 + rng() * .029;
    const turns = .20 + rng() * .35;
    const length = .12 + rng() * .16;
    const points: V[] = [];
    const normals: V[] = [];
    for (let j = 0; j <= 30; j++) {
      const t = j / 30;
      const angle = phase + t * TAU * turns;
      const envelope = smooth(Math.min(1, t * 5));
      const outward = .014 * t + (.015 + layer * .012) * Math.sin(Math.PI * t);
      const p = origin.clone().addScaledVector(along, length * t)
        .addScaledVector(
          side,
          radius * (Math.sin(angle) - Math.sin(phase)) * envelope,
        )
        .addScaledVector(
          n,
          outward + radius * (1 - Math.cos(angle - phase)) * envelope,
        );
      const r = scalpDirection(p);
      const min = onScalp(r, .003);
      if (p.distanceTo(v(0, .78, 0)) < min.distanceTo(v(0, .78, 0))) {
        p.copy(min);
      }
      points.push(p);
      // Vary card orientation around each open curl so it keeps depth in profile.
      normals.push(
        n.clone().addScaledVector(side, .40 * Math.sin(angle)).normalize(),
      );
    }
    // Individual curves describe the open curls. Broad twisting cards at the
    // outer silhouette become visible ribbons, even with a fine strand atlas.
    for (let child = 0; child < 8; child++) {
      const across = (rng() - .5) * .025;
      const lift = rng() * .009;
      const cutoff = 23 + Math.floor(rng() * 8);
      fiber(
        g,
        points.slice(0, cutoff + 1).map((p, j) => {
          const t = j / cutoff;
          return p.clone().addScaledVector(side, across * (1 - .35 * t))
            .addScaledVector(
              normals[j],
              lift + .0025 * Math.sin(t * 9 + phase),
            );
        }),
        .00055 + rng() * .00035,
      );
    }
    if (i % 3 === 0) {
      const flyaway = i % 18 === 0;
      const offset = (rng() - .5) * .035;
      fiber(
        g,
        points.map((p, j) => {
          const t = j / (points.length - 1);
          return p.clone().addScaledVector(side, offset * Math.sin(Math.PI * t))
            .addScaledVector(
              n,
              (flyaway ? .027 : .006) * Math.sin(Math.PI * t),
            );
        }),
        flyaway ? .00050 : .00068,
      );
    }
  }
  return finish(g, "wig-curls", "#241911", "#60422b");
}

/** Three independently interwoven fiber bundles form each relaxed plait. */
export function buildBraids(): THREE.Group {
  const g = create(4409), rng = g.random;
  const anchors = [-1, 1].map((sign) => v(sign * .49, .55, -.08));
  for (const sign of [-1, 1]) {
    const anchor = anchors[sign < 0 ? 0 : 1];
    const target = scalpDirection(anchor);
    // A narrow irregular middle part separates two independently combed fields.
    for (let i = 0; i < 1050; i++) {
      const phi = i < 600 ? sign * (.018 + rng() * (Math.PI - .036)) : sign *
        ((i % 2 ? Math.PI : 0) + (i % 2 ? -1 : 1) * (.008 + rng() * .012));
      const theta = Math.acos(1 - rng() * (1 - Math.cos(hairline(phi) - .02)));
      const start = scalpDirection(scalpPoint(theta, phi));
      const layer = rng();
      const points = Array.from({ length: 30 }, (_, j) => {
        const t = j / 29;
        const direction = start.clone().lerp(target, smooth(t)).normalize();
        const p = onScalp(
          direction,
          .004 + layer * .014 + .018 * Math.sin(Math.PI * t),
        );
        return p.lerp(anchor.clone().add(v(0, 0, (layer - .5) * .035)), t ** 8);
      });
      card(g, points, .028 + rng() * .026, undefined, .54);
      if (i % 15 === 0) {
        fiber(
          g,
          points.map((p, j) =>
            p.clone().addScaledVector(
              normal(p),
              .010 * Math.sin(j / 29 * Math.PI),
            )
          ),
          .00055,
        );
      }
    }
    for (let bundle = 0; bundle < 3; bundle++) {
      const phase = bundle * TAU / 3;
      for (let child = 0; child < 95; child++) {
        const a = rng() * TAU;
        const r = Math.sqrt(rng()) * .026;
        const dx = Math.cos(a) * r, dz = Math.sin(a) * r;
        const length = 1.09 + rng() * .025;
        const points: V[] = [];
        const normals: V[] = [];
        for (let j = 0; j <= 52; j++) {
          const t = j / 52;
          const twist = t * TAU * 3.4 + phase;
          const envelope = (.44 + .56 * smooth(Math.min(1, t * 8))) *
            (1 - .25 * t);
          const q = v(
            sign * (.49 + .055 * Math.sin(Math.PI * t)) +
              (.055 * Math.sin(twist) + dx) * envelope,
            .55 - length * t,
            -.08 + .35 * smooth(t) +
              (.043 * Math.sin(2 * twist) + dz) * envelope,
          );
          points.push(q);
          normals.push(v(Math.cos(a), .04, Math.sin(a)));
        }
        card(g, points, .011 + rng() * .007, normals, .6);
        if (child % 3 === 0) {
          fiber(
            g,
            points.map((p, j) => p.clone().addScaledVector(normals[j], .004)),
            .00056,
          );
        }
      }
    }
    // Loose fiber ends emerge below each tie rather than finishing in a solid plug.
    const tip = v(sign * .49, -.385, .27);
    for (let i = 0; i < 85; i++) {
      const a = rng() * TAU, spread = Math.sqrt(rng()) * .048;
      const end = .14 + rng() * .12;
      const guide = new THREE.CatmullRomCurve3([
        tip.clone().add(
          v(Math.cos(a) * spread * .65, .02, Math.sin(a) * spread * .65),
        ),
        tip.clone().add(v(Math.cos(a) * spread, -.07, Math.sin(a) * spread)),
        tip.clone().add(
          v(Math.cos(a) * spread * 1.2, -end, Math.sin(a) * spread * .5),
        ),
      ]);
      const points = guide.getPoints(16);
      const n = v(Math.cos(a), 0, Math.sin(a));
      card(g, points, .007 + rng() * .01, points.map(() => n), .07);
      if (i % 4 === 0) fiber(g, points, .00052);
    }
    // Sparse long wisps soften the transition around the ears.
    for (let i = 0; i < 15; i++) {
      const r = rng();
      const points = new THREE.CatmullRomCurve3([
        scalpPoint(1.10 + r * .12, sign * .75, .012),
        v(sign * (.34 + r * .035), .93, .38),
        v(sign * (.42 + r * .025), .65, .32),
        v(sign * (.39 + r * .05), .42 + r * .11, .36),
      ]).getPoints(23);
      card(g, points, .008 + rng() * .008, undefined, .12);
      fiber(g, points, .00045);
    }
  }
  const result = finish(g, "wig-braids", "#4c3923", "#967347");
  for (const sign of [-1, 1]) {
    const tie = new THREE.Mesh(
      new THREE.CylinderGeometry(.052, .050, .027, 24),
      new THREE.MeshStandardMaterial({ color: "#252426", roughness: .85 }),
    );
    tie.name = `braid-tie-${sign < 0 ? "right" : "left"}`;
    tie.position.set(sign * .49, -.379, .27);
    result.add(tie);
  }
  return result;
}
