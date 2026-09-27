/** Four fitted, interchangeable game-character grooms. Units match shared.ts. */
import { type Strand, strands, THREE } from "js3";
import { hairline, makeCap, scalpPoint } from "./shared.ts";

type Path = THREE.Vector3[];
const TAU = Math.PI * 2;

function random(seed: number): () => number {
  return () => {
    seed = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    seed ^= seed + Math.imul(seed ^ (seed >>> 7), 61 | seed);
    return ((seed ^ (seed >>> 14)) >>> 0) / 4294967296;
  };
}

function normal(point: THREE.Vector3): THREE.Vector3 {
  return new THREE.Vector3(
    point.x / (.472 * .472),
    (point.y - .78) / (.636 * .636),
    point.z / (.413 * .413),
  ).normalize();
}

function wig(style: string, color: string): THREE.Group {
  const root = new THREE.Group();
  root.name = `wig-${style}`;
  root.userData.style = style;
  root.add(makeCap(color));
  return root;
}

function fiber(points: Path, radius: number, shade = 1): Strand {
  return {
    points: points.map((p) => p.toArray() as [number, number, number]),
    radii: points.map((_, i) => radius * (1 - .88 * i / (points.length - 1))),
    shade,
  };
}

function fibers(
  root: THREE.Group,
  data: Strand[],
  color: string,
  tipColor: string,
): void {
  root.add(strands({ version: 1, strands: data, guides: [], seed: 771 }, {
    name: `${root.name}-fibers`,
    color,
    tipColor,
    radialSegments: 3,
    colorVariation: 0,
  }));
}

/** Flattened, tapering locks give a closed silhouette beneath individual fibers. */
function lock(
  root: THREE.Group,
  path: Path,
  width: number,
  thickness: number,
  material: THREE.Material,
  details: Strand[],
  detailCount = 7,
): void {
  const positions: number[] = [];
  const indices: number[] = [];
  const across: THREE.Vector3[] = [];
  const out: THREE.Vector3[] = [];
  const sides = 8;
  for (let i = 0; i < path.length; i++) {
    const tangent = path[Math.min(i + 1, path.length - 1)].clone().sub(
      path[Math.max(0, i - 1)],
    ).normalize();
    const side = new THREE.Vector3().crossVectors(tangent, normal(path[i]));
    if (side.lengthSq() < .001) {
      side.crossVectors(tangent, new THREE.Vector3(1, 0, 0));
    }
    side.normalize();
    const lift = new THREE.Vector3().crossVectors(side, tangent).normalize();
    if (lift.dot(normal(path[i])) < 0) lift.negate();
    across.push(side);
    out.push(lift);
    const t = i / (path.length - 1);
    const taper = .06 +
      .94 * Math.pow(Math.sin(Math.PI * (.12 + .88 * t)), .55);
    for (let k = 0; k < sides; k++) {
      const angle = k / sides * TAU;
      const p = path[i].clone().addScaledVector(
        side,
        Math.cos(angle) * width * taper,
      )
        .addScaledVector(lift, Math.sin(angle) * thickness * taper);
      positions.push(p.x, p.y, p.z);
      if (i) {
        const a = (i - 1) * sides + k;
        const b = (i - 1) * sides + (k + 1) % sides;
        const c = i * sides + k;
        const d = i * sides + (k + 1) % sides;
        indices.push(a, c, b, b, c, d);
      }
    }
  }
  for (let k = 1; k < sides - 1; k++) {
    indices.push(0, k, k + 1);
    const base = (path.length - 1) * sides;
    indices.push(base, base + k + 1, base + k);
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "sculpted-lock";
  root.add(mesh);
  for (let j = 0; j < detailCount; j++) {
    const lateral = (j / Math.max(1, detailCount - 1) - .5) * 1.6;
    const points = path.map((p, i) => {
      const t = i / (path.length - 1);
      const taper = .06 +
        .94 * Math.pow(Math.sin(Math.PI * (.12 + .88 * t)), .55);
      return p.clone().addScaledVector(across[i], lateral * width * taper)
        .addScaledVector(
          out[i],
          thickness * Math.sqrt(1 - lateral * lateral) * taper + .0008,
        );
    });
    details.push(fiber(points, .00095, .82 + j % 4 * .09));
  }
}

function paint(color: string): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: .61 });
}

function shortSides(
  data: Strand[],
  seed: number,
  count: number,
  minTheta = .55,
): void {
  const rng = random(seed);
  for (let i = 0; i < count; i++) {
    const phi = rng() * TAU;
    const theta = minTheta + rng() * (hairline(phi) - minTheta - .07);
    data.push(fiber(
      Array.from({ length: 5 }, (_, j) => {
        const t = j / 4;
        return scalpPoint(
          theta + .08 * t,
          phi + .04 * t,
          .004 + .004 * Math.sin(Math.PI * t),
        );
      }),
      .00115,
      .7 + rng() * .5,
    ));
  }
}

/** Very close, even cut with a crisp natural hairline and directional stubble. */
export function buildBuzz(): THREE.Group {
  const root = wig("buzz", "#241f1d");
  const data: Strand[] = [];
  const rng = random(103);
  for (let i = 0; i < 2400; i++) {
    const phi = i * 2.399963229728653;
    const theta = Math.acos(1 - rng() * (1 - Math.cos(hairline(phi) - .035)));
    data.push(fiber(
      Array.from({ length: 4 }, (_, j) => {
        const t = j / 3;
        return scalpPoint(theta + .018 * t, phi + .015 * t, .002 + .010 * t);
      }),
      .0019,
      .68 + rng() * .6,
    ));
  }
  fibers(root, data, "#342c27", "#514235");
  return root;
}

/** A continuous shaped shell keeps the hairstyle opaque below fine strands. */
function fill(
  root: THREE.Group,
  color: string,
  lift: (theta: number, phi: number) => number,
): void {
  const mesh = root.children[0] as THREE.Mesh;
  (mesh.material as THREE.MeshStandardMaterial).color.set(color);
  const pos = mesh.geometry.getAttribute("position");
  const uv = mesh.geometry.getAttribute("uv");
  for (let i = 0; i < pos.count; i++) {
    const phi = uv.getX(i) * TAU;
    const theta = uv.getY(i) * hairline(phi);
    const p = scalpPoint(theta, phi, lift(theta, phi));
    pos.setXYZ(i, p.x, p.y, p.z);
  }
  mesh.geometry.computeVertexNormals();
}

/** Short textured crop: a low coherent mass combed forward into an irregular fringe. */
export function buildCrop(): THREE.Group {
  const root = wig("crop", "#35251b");
  const data: Strand[] = [];
  const rng = random(202);
  const material = paint("#423025");
  fill(root, "#35251b", (theta) => .006 + .025 * Math.max(0, 1 - theta / 1.3));
  shortSides(data, 203, 850, .85);
  for (let i = 0; i < 110; i++) {
    const phi = i * 2.399963229728653;
    const theta = .08 + Math.sqrt((i + .5) / 110) * 1.0;
    const start = scalpPoint(theta, phi);
    const path = Array.from({ length: 12 }, (_, j) => {
      const t = j / 11;
      const p = start.clone();
      p.x += .021 * t;
      p.z += .125 * t;
      const nx = p.x / .472, nz = p.z / .413;
      if (nx * nx + nz * nz > .88) {
        const scale = Math.sqrt(.88 / (nx * nx + nz * nz));
        p.x *= scale;
        p.z *= scale;
      }
      p.y = .78 +
        .636 *
          Math.sqrt(Math.max(.01, 1 - (p.x / .472) ** 2 - (p.z / .413) ** 2));
      return p.addScaledVector(normal(p), .032 + .012 * Math.sin(Math.PI * t));
    });
    lock(root, path, .042 + rng() * .008, .008, material, data, 5);
  }
  // Short fringe is a row of broad, overlapping tapered locks, not exposed scalp.
  for (let i = 0; i < 31; i++) {
    const phi = -.86 + i / 30 * 1.72;
    const end = 1.29 + .025 * Math.sin(i * 1.8);
    const path = Array.from({ length: 12 }, (_, j) => {
      const t = j / 11;
      return scalpPoint(
        .92 + (end - .92) * t,
        phi + .035 * t,
        .031 + .013 * Math.sin(Math.PI * t),
      );
    });
    lock(root, path, .023, .009, material, data, 6);
  }
  fibers(root, data, "#503a2a", "#644b37");
  return root;
}

function upperPoint(x: number, z: number, lift: number): THREE.Vector3 {
  const p = new THREE.Vector3(
    x,
    .78 +
      .636 * Math.sqrt(Math.max(.015, 1 - (x / .472) ** 2 - (z / .413) ** 2)),
    z,
  );
  return p.addScaledVector(normal(p), lift);
}

/** A visible left part separates the short side from broad overlapping swept locks. */
export function buildSidePart(): THREE.Group {
  const root = wig("side-part", "#35251c");
  const data: Strand[] = [];
  const material = paint("#3c2a20");
  fill(root, "#35251c", (theta, phi) => {
    const top = Math.max(0, 1 - theta / 1.55);
    return .007 + .073 * top * (.85 + .15 * Math.sin(phi));
  });
  shortSides(data, 310, 1000, 1.0);
  for (let row = 0; row < 37; row++) {
    const z = -.37 + row / 36 * .744;
    for (const direction of [1, -1]) {
      const path = Array.from({ length: 17 }, (_, j) => {
        const t = j / 16;
        const startX = -.145 + (direction === 1 ? .014 : -.015);
        const endX = direction === 1 ? .438 : -.435;
        const x = THREE.MathUtils.lerp(startX, endX, t);
        const zz = z * (1 - .68 * t) - .035 * Math.sin(Math.PI * t);
        return upperPoint(
          x,
          zz,
          .016 + (direction === 1 ? .083 : .035) * Math.sin(Math.PI * t) +
            .012 * t,
        );
      });
      lock(root, path, .027, direction === 1 ? .016 : .012, material, data, 7);
    }
  }
  // Front bands follow the brow-facing surface instead of bridging over it.
  // This fills the full swept fringe while leaving a narrow visible part.
  for (let row = 0; row < 29; row++) {
    const startTheta = .11 + row / 28 * 1.12;
    for (const direction of [1, -1]) {
      const path = Array.from({ length: 16 }, (_, j) => {
        const t = j / 15;
        const phi = -.34 + (direction === 1 ? .025 : -.026) +
          direction * 1.75 * t;
        const theta = startTheta + .37 * t;
        return scalpPoint(
          theta,
          phi,
          .018 + (direction === 1 ? .082 : .038) * Math.sin(Math.PI * t),
        );
      });
      lock(root, path, .026, .011, material, data, 5);
    }
  }
  fibers(root, data, "#523a2a", "#6a4f3a");
  return root;
}

/** Dense coiled crop: overlapping plush clumps carry small visible curl ridges. */
export function buildCurls(): THREE.Group {
  const root = wig("curls", "#31231c");
  const data: Strand[] = [];
  const rng = random(411);
  const material = paint("#3a2a21");
  fill(
    root,
    "#31231c",
    (theta, phi) => .025 + .020 * Math.max(0, 1 - theta / hairline(phi)),
  );
  for (let i = 0; i < 330; i++) {
    const phi = i * 2.399963229728653;
    const theta = Math.acos(
      1 - ((i + .5) / 330) * (1 - Math.cos(hairline(phi) - .025)),
    );
    const origin = scalpPoint(theta, phi, .040);
    const n = normal(origin);
    const a = new THREE.Vector3(Math.cos(phi), 0, -Math.sin(phi));
    const b = new THREE.Vector3().crossVectors(n, a).normalize();
    const curlRadius = .024 + rng() * .010;
    const phase = rng() * TAU;
    const path = Array.from({ length: 18 }, (_, j) => {
      const t = j / 17;
      const angle = phase + t * TAU * 1.1;
      return origin.clone().addScaledVector(
        n,
        .019 + .016 * Math.sin(Math.PI * t),
      )
        .addScaledVector(a, Math.cos(angle) * curlRadius)
        .addScaledVector(b, Math.sin(angle) * curlRadius);
    });
    lock(root, path, .022, .020, material, data, 1);
  }
  fibers(root, data, "#634633", "#74543c");
  return root;
}
