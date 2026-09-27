/** Interchangeable, deterministic long hair grooms for the shared game bust. */
import * as THREE from "three";
import { type StrandData, strands } from "../../src/prelude.ts";
import { hairline, makeCap, scalpPoint } from "./shared.ts";

type V = THREE.Vector3;
const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const tuple = (p: V): [number, number, number] => [p.x, p.y, p.z];
const sample = (points: V[], n = 32): V[] =>
  new THREE.CatmullRomCurve3(points).getPoints(n);

/** Keep swept gathering guides outside the curved skull between control points. */
function scalpComb(points: V[]): V[] {
  return points.map((point) => {
    const p = point.clone(), y = p.y - .78;
    const radius = Math.hypot(p.x / .472, y / .636, p.z / .413);
    if (radius < 1.035) {
      const scale = 1.035 / radius;
      p.set(p.x * scale, .78 + y * scale, p.z * scale);
    }
    return p;
  });
}

/** Sculpted lock body plus editable, batched longitudinal fibers. */
class Wig {
  group = new THREE.Group();
  fibers: StrandData = { version: 1, strands: [], guides: [], seed: 41 };
  constructor(public color: string, name: string) {
    this.group.name = name;
    this.group.add(makeCap(color));
  }
  lock(
    points: V[],
    width: number,
    thickness: number,
    tip = .1,
    shade = 1,
    round = false,
  ) {
    const geometry = new THREE.BufferGeometry();
    const positions: number[] = [], indices: number[] = [], uv: number[] = [];
    const sides = 8;
    const frames: { side: V; out: V; width: number; thick: number }[] = [];
    points.forEach((p, i) => {
      const t = i / (points.length - 1);
      const tangent = points[Math.min(i + 1, points.length - 1)].clone()
        .sub(points[Math.max(0, i - 1)]).normalize();
      let outward = v(p.x, .12, p.z).normalize();
      if (Math.abs(outward.dot(tangent)) > .94) outward = v(0, 0, 1);
      const side = tangent.clone().cross(outward).normalize();
      outward = side.clone().cross(tangent).normalize();
      const taper = THREE.MathUtils.lerp(1, tip, Math.pow(t, 5));
      const w = width * taper, h = (round ? width : thickness) * taper;
      frames.push({ side, out: outward, width: w, thick: h });
      for (let j = 0; j <= sides; j++) {
        const angle = j / sides * Math.PI * 2;
        const q = p.clone().addScaledVector(side, Math.cos(angle) * w)
          .addScaledVector(outward, Math.sin(angle) * h);
        positions.push(q.x, q.y, q.z);
        uv.push(t, j / sides);
        if (i && j < sides) {
          const a = (i - 1) * (sides + 1) + j;
          const b = i * (sides + 1) + j;
          indices.push(a, b, a + 1, a + 1, b, b + 1);
        }
      }
    });
    for (const end of [0, points.length - 1]) {
      const center = positions.length / 3;
      positions.push(...tuple(points[end]));
      uv.push(end ? 1 : 0, .5);
      for (let j = 0; j < sides; j++) {
        const a = end * (sides + 1) + j;
        if (end) indices.push(center, a + 1, a);
        else indices.push(center, a, a + 1);
      }
    }
    geometry.setAttribute(
      "position",
      new THREE.Float32BufferAttribute(positions, 3),
    );
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshPhysicalMaterial({
        color: new THREE.Color(this.color).multiplyScalar(shade),
        roughness: .4,
        sheen: .3,
        sheenColor: new THREE.Color(this.color).multiplyScalar(1.4),
        specularIntensity: .45,
      }),
    );
    mesh.name = `sculpted-lock-${this.fibers.guides.length}`;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.fibers.guides.push(points.map(tuple));
    const count = round ? 10 : 9;
    for (let j = 0; j < count; j++) {
      const angle = round
        ? j / count * Math.PI * 2
        : .22 + j / (count - 1) * (Math.PI - .44);
      const fiber = points.map((p, i) => {
        const f = frames[i];
        return tuple(
          p.clone()
            .addScaledVector(f.side, Math.cos(angle) * f.width * 1.015)
            .addScaledVector(f.out, Math.sin(angle) * (f.thick + .0018)),
        );
      });
      this.fibers.strands.push({
        points: fiber,
        radii: points.map((_, i) => .0015 * (1 - .8 * i / (points.length - 1))),
        shade: .92 + (j % 4) * .05,
      });
    }
  }
  finish() {
    const detail = strands(this.fibers, {
      color: new THREE.Color(this.color).multiplyScalar(1.25),
      tipColor: new THREE.Color(this.color).multiplyScalar(1.5),
      radialSegments: 3,
      name: "editable-fine-fibers",
    });
    this.group.add(detail);
    return this.group;
  }
}

/** Chin-length bob: a dense swept shell, blunt hem, and eyebrow-safe fringe. */
export function buildBob(): THREE.Group {
  const wig = new Wig("#211d28", "wig-bob");
  const count = 27;
  for (let i = 0; i < count; i++) {
    const phi = .87 + i / (count - 1) * (Math.PI * 2 - 1.74);
    const sx = Math.sin(phi), sz = Math.cos(phi);
    wig.lock(
      sample([
        scalpPoint(.2, phi, .016),
        scalpPoint(.72, phi, .035),
        scalpPoint(1.28, phi, .044),
        v(.51 * sx, .63, .455 * sz),
        v(.535 * sx, .32, .455 * sz),
        v(.495 * sx, .155, .425 * sz),
      ]),
      .067,
      .033,
      .82,
      .9 + (i % 5) * .042,
    );
  }
  for (let i = 0; i < 11; i++) {
    const phi = -.79 + i / 10 * 1.58;
    const end = scalpPoint(1.18, phi, .026);
    end.y = .995 + .025 * Math.abs(phi);
    wig.lock(
      sample([
        scalpPoint(.2, phi, .03),
        scalpPoint(.65, phi, .048),
        scalpPoint(1.03, phi, .045),
        end,
      ], 22),
      .042,
      .023,
      .75,
      .97 + (i % 3) * .035,
    );
  }
  return wig.finish();
}

/** Long center-parted waves, with broad repeated bends instead of random frizz. */
export function buildWaves(): THREE.Group {
  const wig = new Wig("#874126", "wig-waves");
  // Overlapping sweeps grow from the center part all the way to the hairline;
  // leaving this region to a plain cap would read as a solid forehead patch.
  for (const sign of [-1, 1]) {
    for (let i = 0; i < 9; i++) {
      const theta = .19 + i / 8 * .98;
      wig.lock(
        scalpComb(sample([
          scalpPoint(theta, sign * .018, .024),
          scalpPoint(Math.min(1.3, theta + .17), sign * .34, .04),
          scalpPoint(Math.max(1.18, theta + .23), sign * .68, .042),
          scalpPoint(1.49, sign * .96, .047),
          v(sign * .495, .64, .285),
          v(sign * .54, .34 - .014 * i, .28),
        ], 25)),
        .042,
        .023,
        .1,
        .96 + (i % 4) * .045,
      );
    }
  }
  for (let i = 0; i < 30; i++) {
    const phi = .66 + i / 29 * (Math.PI * 2 - 1.32);
    const sx = Math.sin(phi), sz = Math.cos(phi);
    const spread = .53 + .045 * Math.sin(i * 1.7);
    const points = [
      scalpPoint(.17, phi, .022),
      scalpPoint(.7, phi, .055),
      scalpPoint(1.2, phi, .065),
      v(spread * sx, .65, .465 * sz),
    ];
    for (let j = 1; j <= 8; j++) {
      const t = j / 8;
      const wave = .052 * Math.sin(t * Math.PI * 3 + i * .28);
      points.push(
        v(
          (spread + wave + .06 * t) * sx,
          .65 - t * (1.0 + .065 * Math.sin(i * 2.1)),
          (.465 + wave * .5) * sz + .038 * Math.sin(t * Math.PI * 2),
        ),
      );
    }
    wig.lock(sample(points, 46), .074, .037, .08, .84 + (i % 6) * .055);
  }
  // The front pair sweeps out from the part, keeping the central face exposed.
  for (const sign of [-1, 1]) {
    wig.lock(
      sample([
        v(sign * .012, 1.435, .025),
        v(sign * .22, 1.35, .31),
        v(sign * .395, 1.12, .34),
        v(sign * .49, .76, .34),
        v(sign * .50, .44, .32),
        v(sign * .61, .17, .35),
        v(sign * .53, -.15, .32),
      ], 44),
      .072,
      .027,
      .08,
      1.1,
    );
  }
  return wig.finish();
}

/** High gathered ponytail with a fitted combed scalp and a visible tie. */
export function buildPonytail(): THREE.Group {
  const wig = new Wig("#492521", "wig-ponytail");
  const tie = v(0, 1.21, -.43);
  for (let i = 0; i < 34; i++) {
    const phi = i / 34 * Math.PI * 2;
    const root = scalpPoint(hairline(phi) - .035, phi, .013);
    const mid = scalpPoint(.67, phi, .023);
    wig.lock(
      scalpComb(sample([root, mid, scalpPoint(.36, Math.PI, .034), tie], 24)),
      .021,
      .013,
      .35,
      .92 + (i % 4) * .045,
    );
  }
  const band = new THREE.Mesh(
    new THREE.TorusGeometry(.087, .025, 8, 20),
    new THREE.MeshStandardMaterial({ color: "#202f3c", roughness: .65 }),
  );
  band.position.copy(tie);
  band.name = "ponytail-tie";
  wig.group.add(band);
  for (let i = 0; i < 13; i++) {
    const angle = i / 13 * Math.PI * 2;
    const r = i === 12 ? 0 : .061;
    const dx = Math.cos(angle) * r, dz = Math.sin(angle) * r;
    wig.lock(
      sample([
        tie.clone().add(v(dx * .6, 0, dz * .6)),
        v(dx * 1.6, 1.45 + dz, -.60),
        v(dx * 1.8, 1.29, -.79 + dz),
        v(.035 + dx * 1.65, .85, -.86 + dz),
        v(.13 + dx * 1.5, .36, -.80 + dz),
        v(.19 + dx, -.12 - .055 * Math.cos(angle), -.62 + dz),
      ], 40),
      .039,
      .032,
      .08,
      .85 + (i % 5) * .07,
      true,
    );
  }
  return wig.finish();
}

/** Paired three-lock plaits: the strands weave over/under along each shoulder. */
export function buildBraids(): THREE.Group {
  const wig = new Wig("#94703b", "wig-braids");
  for (const sign of [-1, 1]) {
    const start = v(sign * .475, .59, -.07);
    for (let i = 0; i < 13; i++) {
      const phi = sign * (.22 + i / 12 * (Math.PI - .22));
      wig.lock(
        scalpComb(sample([
          scalpPoint(.17, phi, .02),
          scalpPoint(.7, phi, .04),
          scalpPoint(1.22, phi, .035),
          start.clone().add(v(0, .08, 0)),
          start,
        ], 26)),
        .032,
        .02,
        .3,
        .9 + (i % 4) * .055,
      );
    }
    for (let lock = 0; lock < 3; lock++) {
      const phase = lock * Math.PI * 2 / 3;
      const points: V[] = [];
      for (let j = 0; j <= 90; j++) {
        const t = j / 90;
        const a = t * Math.PI * 2 * 3.15 + phase;
        const envelope = Math.min(1, .45 + t * 8) * (1 - .28 * t);
        points.push(v(
          sign * (.48 + .065 * Math.sin(t * Math.PI)) +
            .061 * Math.sin(a) * envelope,
          .59 - t * 1.0,
          -.07 + .36 * Math.sin(t * Math.PI / 2) +
            .052 * Math.sin(2 * a) * envelope,
        ));
      }
      wig.lock(points, .033, .033, .5, .91 + lock * .105, true);
    }
    const end = v(sign * .48, -.41, .29);
    const band = new THREE.Mesh(
      new THREE.CylinderGeometry(.06, .058, .04, 16),
      new THREE.MeshStandardMaterial({ color: "#394650", roughness: .7 }),
    );
    band.position.copy(end);
    band.name = `braid-tie-${sign}`;
    wig.group.add(band);
    for (let i = 0; i < 5; i++) {
      const angle = i / 5 * Math.PI * 2;
      wig.lock(
        sample([
          end.clone().add(v(Math.cos(angle) * .028, 0, Math.sin(angle) * .028)),
          end.clone().add(
            v(Math.cos(angle) * .04, -.10, Math.sin(angle) * .035),
          ),
          end.clone().add(
            v(Math.cos(angle) * .018, -.18, Math.sin(angle) * .022),
          ),
        ], 12),
        .016,
        .014,
        .06,
        1.02,
        true,
      );
    }
  }
  return wig.finish();
}
