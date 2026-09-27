/** Layered card grooms with sparse, exportable silhouette fibers. */
import * as THREE from "three";
import { type HairCardGuide, hairCards } from "../../src/hair-cards.ts";
import { strands } from "../../src/strands.ts";
import { type StrandData } from "../../src/strand-data.ts";
import { hairline, scalpPoint } from "./shared.ts";

type V = THREE.Vector3;
type XYZ = [number, number, number];
const TAU = Math.PI * 2;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const tuple = (p: V): XYZ => [p.x, p.y, p.z];
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let n = Math.imul(seed ^ (seed >>> 15), seed | 1);
    n ^= n + Math.imul(n ^ (n >>> 7), n | 61);
    return ((n ^ (n >>> 14)) >>> 0) / 4294967296;
  };
}
function normal(p: V): V {
  return v(
    p.x / .472 ** 2,
    Math.max(.0, p.y - .78) / .636 ** 2,
    p.z / .413 ** 2,
  ).normalize();
}
function onScalp(n: V, lift: number): V {
  return scalpPoint(
    Math.acos(THREE.MathUtils.clamp(n.y, -1, 1)),
    Math.atan2(n.x, n.z),
    lift,
  );
}

interface Groom {
  cards: HairCardGuide[];
  fibers: StrandData;
  rng: () => number;
}
function create(seed: number): Groom {
  return {
    cards: [],
    fibers: { version: 1, seed, strands: [], guides: [] },
    rng: random(seed),
  };
}
/** Deliberately vary lengths and lateral offsets across cards, not just their color. */
function add(
  g: Groom,
  points: V[],
  width: number,
  loose = false,
  explicitNormals?: V[],
) {
  const rng = g.rng;
  const shade = .95 + rng() * .10;
  const normals = explicitNormals ?? points.map(normal);
  g.cards.push({
    points: points.map(tuple),
    normals: normals.map(tuple),
    width: points.map((_, i) => {
      const t = i / (points.length - 1);
      return width * (.74 + .26 * Math.sin(Math.PI * t)) * (1 - .58 * t ** 3);
    }),
    shade,
  });
  // Fine untextured fibers keep the silhouette legible in profile and Blender.
  if (loose || rng() < .18) {
    for (let child = 0; child < (loose ? 3 : 1); child++) {
      const side = (rng() - .5) * width;
      const drift = (loose ? .01 : .004) + rng() * (loose ? .018 : .008);
      const phase = rng() * TAU;
      const fiber = points.map((p, i) => {
        const t = i / (points.length - 1);
        const tangent = points[Math.min(i + 1, points.length - 1)].clone().sub(
          points[Math.max(0, i - 1)],
        ).normalize();
        const across = tangent.clone().cross(normals[i]).normalize();
        return tuple(
          p.clone().addScaledVector(
            across,
            side + drift * Math.sin(t * 7 + phase) * Math.sin(t * Math.PI),
          )
            .addScaledVector(normals[i], drift * Math.sin(t * Math.PI)),
        );
      });
      g.fibers.strands.push({
        points: fiber,
        radii: points.map((_, i) =>
          .00055 * (1 - .92 * (i / (points.length - 1)) ** 2)
        ),
        shade: .85 + rng() * .3,
      });
    }
  }
}
function finish(
  g: Groom,
  name: string,
  color: string,
  tipColor: string,
): THREE.Group {
  const result = new THREE.Group();
  result.name = name;
  result.add(
    hairCards(g.cards, {
      name: "layered-hair-cards",
      color,
      tipColor,
      seed: g.fibers.seed,
      roughness: .53,
      colorVariation: .08,
      rootFade: .006,
      density: 1,
    }),
  );
  if (g.fibers.strands.length) {
    result.add(strands(g.fibers, {
      name: "loose-silhouette-fibers",
      color,
      tipColor,
      radialSegments: 3,
      colorVariation: .22,
    }));
  }
  result.userData.groom = {
    cards: g.cards.length,
    looseStrands: g.fibers.strands.length,
    representation: "alpha hair cards + fibers",
  };
  return result;
}

/** The part is a curve over the scalp; hair flows away to each temple and nape. */
function parted(style: "waves" | "bob" | "side-part" | "crop") {
  const seed = { waves: 803, bob: 910, "side-part": 602, crop: 501 }[style];
  const g = create(seed), rng = g.rng;
  const long = style === "waves", bob = style === "bob";
  const offset = style === "side-part" ? -.22 : style === "crop" ? -.1 : -.035;
  const count = long ? 1080 : bob ? 900 : 850;
  for (let i = 0; i < count; i++) {
    const sign = i % 2 ? 1 : -1;
    const z = -.98 + rng() * 1.86;
    const layer = Math.floor(rng() * 4);
    const phase = rng() * TAU;
    const length = long
      ? 1.10 + rng() * .43
      : bob
      ? .58 + rng() * .09
      : .08 + rng() * .22;
    const root = v(
      offset * Math.sqrt(Math.max(.01, 1 - z * z)),
      Math.sqrt(Math.max(.01, 1 - z * z)),
      z,
    ).normalize();
    const phi = sign * (.95 + (1 - z) * .5 * 2.18);
    const end = v(Math.sin(phi), -.03, Math.cos(phi)).normalize();
    // Outer cards start near the part; buried cards fill the body of the groom.
    const start = layer >= 2 ? rng() * .015 : rng() * .48;
    const stop = .90 + rng() * .10;
    const points: V[] = [];
    for (let j = 0; j <= 32; j++) {
      const t = start + (stop - start) * j / 32;
      const scalpT = Math.min(1, t / .58);
      const n = root.clone().lerp(end, scalpT).normalize();
      const lift = .005 + layer * .009 +
        (.045 + layer * .008) * Math.sin(scalpT * Math.PI * .9);
      const p = onScalp(n, lift);
      if (t > .58) {
        const u = (t - .58) / .42;
        p.y -= length * u;
        const wave = long
          ? .09 * Math.sin(u * 8 + phi * .6) * Math.sin(u * Math.PI * .8)
          : bob
          ? -.032 * u ** 3
          : -.065 * u;
        p.x += Math.sin(phi) * (wave + .013 * Math.sin(phase) * u);
        p.z += Math.cos(phi) * wave;
        if (!long && !bob) p.z -= .075 * u;
      }
      // Coherent low-frequency breakup keeps the highlights from becoming parallel ridges.
      p.addScaledVector(
        normal(p),
        .003 * Math.sin(t * 15 + phase) * Math.sin(t * Math.PI),
      );
      points.push(p);
    }
    const width = (layer === 3 ? .020 : .036) + rng() * .026;
    add(g, points, width, layer === 3 && i % 8 === 0);
  }
  // Fine face-framing locks: distinct guides with varied ends, kept outside the eyes.
  if (long || bob) {
    for (const sign of [-1, 1]) {
      for (let i = 0; i < 60; i++) {
        const r = rng(), x = sign * (.36 + r * .08);
        const guide = new THREE.CatmullRomCurve3([
          v(sign * (.025 + rng() * .08), 1.20 + rng() * .16, .34),
          v(sign * .27, 1.25, .41),
          v(x, .96, .43),
          v(x + sign * .045, .65, .40),
          v(x + sign * .06, .29, .43),
          v(x + sign * .025, long ? -.21 - r * .20 : .20, .40),
        ]);
        add(g, guide.getPoints(32), .015 + rng() * .02, i % 8 === 0);
      }
    }
  }
  // Sparse, short hairs soften the forehead boundary without a painted-on cap.
  for (let i = 0; i < 460; i++) {
    const phi = (rng() - .5) * 2.45;
    const theta = 1.035 + .39 * Math.abs(phi) / 1.23 + (rng() - .5) * .04;
    const length = .025 + rng() * .065;
    g.fibers.strands.push({
      points: Array.from({ length: 8 }, (_, j) => {
        const t = j / 7;
        return tuple(
          scalpPoint(
            theta + length * t,
            phi + Math.sign(phi) * .055 * t,
            .004 + .004 * Math.sin(t * Math.PI),
          ),
        );
      }),
      radii: Array.from({ length: 8 }, (_, j) => .00045 * (1 - .93 * j / 7)),
      shade: .85 + rng() * .3,
    });
  }
  const colors = {
    waves: ["#40241a", "#593524"],
    bob: ["#171316", "#3b2b2b"],
    "side-part": ["#211916", "#4c3728"],
    crop: ["#2d2219", "#59422f"],
  };
  const [base, tip] = colors[style];
  return finish(g, `wig-${style}`, base, tip);
}
export const buildWaves = () => parted("waves");
export const buildBob = () => parted("bob");
export const buildSidePart = () => parted("side-part");
export function buildCrop() {
  const result = parted("crop");
  const g = create(551), rng = g.rng;
  for (let i = 0; i < 480; i++) {
    const phi = -.98 + rng() * 1.76;
    const endTheta = 1.28 + .08 * Math.cos(phi) + rng() * .045;
    const start = v((rng() - .5) * .6, .9, -.25 + rng() * .45).normalize();
    const end = v(
      Math.sin(endTheta) * Math.sin(phi),
      Math.cos(endTheta),
      Math.sin(endTheta) * Math.cos(phi),
    );
    const startT = rng() * .34;
    const phase = rng() * TAU;
    const points = Array.from({ length: 25 }, (_, j) => {
      const t = startT + (1 - startT) * j / 24;
      const n = start.clone().lerp(end, t).normalize();
      return onScalp(
        n,
        .018 + (.035 + .008 * Math.sin(phase)) * Math.sin(t * Math.PI) +
          .008 * t,
      );
    });
    add(g, points, .025 + rng() * .022, i % 17 === 0);
  }
  result.add(finish(g, "forward-swept-fringe", "#2d2219", "#59422f"));
  return result;
}

/** A nape-gathered ponytail with combed-back roots and loose temple wisps. */
export function buildPonytail() {
  const g = create(1212), rng = g.rng;
  const tie = v(0, .98, -.50);
  for (let i = 0; i < 1800; i++) {
    const phi = rng() * TAU;
    const edge = hairline(phi) - .065;
    const theta = i % 3 === 0 ? edge - rng() * .065 : edge * Math.sqrt(rng());
    const start = scalpPoint(
      theta,
      phi,
      .006,
    );
    const toward = v(0, .98, -.50);
    const points: V[] = [];
    for (let j = 0; j <= 28; j++) {
      const t = j / 28;
      const n = start.clone().sub(v(0, .78, 0));
      n.set(n.x / .472, n.y / .636, n.z / .413).normalize();
      const end = toward.clone().sub(v(0, .78, 0));
      end.set(end.x / .472, end.y / .636, end.z / .413).normalize();
      const p = onScalp(
        n.lerp(end, t).normalize(),
        .008 + .022 * Math.sin(t * Math.PI),
      );
      p.lerp(tie, t ** 6);
      points.push(p);
    }
    add(g, points, .033 + rng() * .028, i % 50 === 0);
  }
  for (let i = 0; i < 390; i++) {
    const angle = rng() * TAU, r = Math.sqrt(rng()) * .085;
    const phase = rng() * TAU;
    const endY = -.36 + rng() * .24;
    const guide = new THREE.CatmullRomCurve3([
      tie.clone().add(v(Math.cos(angle) * r * .7, Math.sin(angle) * r * .7, 0)),
      v(Math.cos(angle) * r * 1.8, 1.01 + Math.sin(angle) * r, -.67),
      v(.08 + Math.cos(angle) * r * 1.5, .69, -.75 + Math.sin(angle) * r),
      v(.12 + Math.cos(angle) * r * 1.5, .24, -.72 + Math.sin(angle) * r),
      v(.04 + Math.cos(angle) * r * 1.3, endY, -.55 + Math.sin(angle) * r),
    ]);
    add(
      g,
      guide.getPoints(32),
      .02 + rng() * .027,
      i % 30 === 0,
      Array.from({ length: 33 }, () => v(Math.cos(phase), 0, Math.sin(phase))),
    );
  }
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 14; i++) {
      const r = rng();
      add(
        g,
        new THREE.CatmullRomCurve3([
          scalpPoint(1.17, sign * .65, .01),
          v(sign * (.35 + .015 * r), .98, .39),
          v(sign * (.43 + .02 * r), .72, .34),
          v(sign * (.4 + .04 * r), .36 + .15 * r, .38),
        ]).getPoints(24),
        .012 + rng() * .009,
        true,
      );
    }
  }
  const result = finish(g, "wig-ponytail", "#45251b", "#785035");
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(.075, .014, 8, 32),
    new THREE.MeshStandardMaterial({ color: "#171c22", roughness: .85 }),
  );
  band.position.copy(tie);
  result.add(band);
  return result;
}
