/** Two deliberately sculpted wigs: a swept quiff and a rounded, layered bob. */
import * as THREE from "three";
import { hairLock, type HairLockPoint } from "../../src/stylized-hair.ts";
import { buildHead } from "./head.ts";
import { hairline, makeCap, scalpPoint } from "./shared.ts";

export type CartoonHairStyle = "quiff" | "bob";
const TAU = Math.PI * 2;
const tuple = (p: THREE.Vector3): HairLockPoint => [p.x, p.y, p.z];
const normal = (p: THREE.Vector3): HairLockPoint =>
  tuple(
    new THREE.Vector3(p.x / .472 ** 2, (p.y - .78) / .636 ** 2, p.z / .413 ** 2)
      .normalize(),
  );

/** Detached wig, fitted to the same anatomical head as the strand examples. */
export function buildCartoonWig(
  style: CartoonHairStyle = "quiff",
): THREE.Group {
  if (style !== "quiff" && style !== "bob") {
    throw new RangeError("Unknown cartoon hair style");
  }
  const group = new THREE.Group();
  group.name = `cartoon-${style}-wig`;
  const base = style === "quiff" ? "#643322" : "#162e3b";
  const cap = makeCap(style === "quiff" ? "#78412b" : "#23404f", .006);
  (cap.material as THREE.MeshStandardMaterial).roughness = .55;
  // Keep the hairline fitted while filling the raised crown; a uniformly
  // inflated cap would also grow outward around the ears.
  const capPosition = cap.geometry.getAttribute("position");
  for (let i = 0; i < capPosition.count; i++) {
    const p = new THREE.Vector3().fromBufferAttribute(capPosition, i);
    const direction = new THREE.Vector3(
      p.x / .472,
      (p.y - .78) / .636,
      p.z / .413,
    ).normalize();
    const theta = Math.acos(THREE.MathUtils.clamp(direction.y, -1, 1));
    const lift = .032 * (1 - THREE.MathUtils.smoothstep(theta, .85, 1.5));
    p.addScaledVector(new THREE.Vector3(...normal(p)), lift);
    capPosition.setXYZ(i, p.x, p.y, p.z);
  }
  cap.geometry.computeVertexNormals();
  cap.castShadow = true;
  cap.receiveShadow = false;
  cap.userData.previewShadows = { receive: false };
  group.add(cap);
  const lockMaterial = new THREE.MeshStandardMaterial({
    name: `${style} sculpted hair`,
    color: "#ffffff",
    vertexColors: true,
    roughness: .55,
    metalness: 0,
  });
  let index = 0;
  function lock(
    points: THREE.Vector3[],
    width: number,
    thickness: number,
    color: string,
    options: { profile?: number[]; ridge?: number; twist?: number } = {},
  ) {
    const mesh = hairLock(points.map(tuple), {
      name: `${style}-lock-${index++}`,
      width,
      thickness,
      normals: points.map(normal),
      color,
      material: lockMaterial,
      widthProfile: options.profile ?? [.65, 1, .94, .64, 0],
      ridge: options.ridge ?? .15,
      twist: options.twist ?? 0,
      segments: 30,
      crossSegments: 10,
    });
    // The close layered surfaces amplify low-resolution shadow-map acne.
    // Sculpted planes and root color provide the graphic separation, while
    // the locks still cast useful shadows onto the face and neck.
    mesh.receiveShadow = false;
    mesh.userData.previewShadows = { receive: false };
    group.add(mesh);
  }
  if (style === "quiff") {
    // Broad rear panels interleave above a close undercut, rather than a radial
    // field of identical spikes. Their ends follow the nape in small groups.
    for (let i = 0; i < 17; i++) {
      const phi = .98 + i / 16 * (TAU - 1.96);
      const points = Array.from({ length: 7 }, (_, j) => {
        const t = j / 6;
        const theta = .025 + (hairline(phi) + .1) * t;
        return scalpPoint(
          theta,
          phi + .11 * Math.sin(Math.PI * t),
          .016 + .016 * Math.sin(Math.PI * t),
        );
      });
      lock(
        points,
        .15 + .025 * Math.sin(i * 2.3),
        .027,
        i % 3 === 0 ? "#72402a" : base,
        { profile: [0, 1, 1, .75, 0] },
      );
    }
    // The large sweeps hug one continuous scalp volume. Extra height is at
    // the root and settles into a diagonally cut fringe above the eyebrows.
    for (let i = 0; i < 10; i++) {
      const endPhi = -1.12 + i / 9 * 2.6;
      const endTheta = 1.28 + .37 * Math.abs(Math.sin(endPhi));
      const points = Array.from({ length: 10 }, (_, j) => {
        const t = j / 9;
        const startTheta = .02 + i * .018;
        const theta = THREE.MathUtils.lerp(startTheta, endTheta, t);
        const phi = THREE.MathUtils.lerp(
          -1.60 - i * .025,
          endPhi,
          Math.pow(t, .64),
        );
        const lift = .01 + (.050 - i * .001) * Math.sin(Math.PI * t) +
          i * .0015;
        return scalpPoint(theta, phi, lift);
      });
      lock(
        points,
        .20 + .012 * Math.sin(i * .9),
        .029,
        i % 4 === 0 ? "#915033" : "#82472e",
        { profile: [0, 1, .98, .92, 0], ridge: -.16 },
      );
    }
    // Small temple wedges soften the transition from graphic cap to face.
    for (const sign of [-1, 1]) {
      lock(
        [
          scalpPoint(1.05, sign * 1.1, .026),
          scalpPoint(1.35, sign * 1.20, .039),
          scalpPoint(1.62, sign * 1.22, .034),
          scalpPoint(1.78, sign * 1.08, .013),
        ],
        .105,
        .025,
        "#74412c",
        { profile: [.7, 1, .85, 0] },
      );
    }
  } else {
    // Wide underlayer panels make one rounded mass. Uneven pointed ends break
    // the cut's hem without turning every lock into a separate sausage.
    for (let i = 0; i < 16; i++) {
      const phi = .72 + i / 15 * (TAU - 1.44);
      const lift = .032 + .009 * Math.sin(i * 1.8);
      const points = [
        scalpPoint(.025, phi, .016),
        scalpPoint(.65, phi, .027),
        scalpPoint(1.08, phi, lift + .055),
        scalpPoint(1.55, phi, lift + .08),
      ];
      // The bob hangs vertically past the ear before curling gently inward.
      // Continuing the scalp's shrinking nape radius here creates hooked tips.
      const lower = points[3].clone();
      lower.y = .64 + .018 * Math.sin(i * 1.4);
      const end = lower.clone();
      end.y = .46 + .03 * Math.sin(i * 2.2);
      end.x *= .91;
      end.z *= .94;
      points.push(lower, end);
      lock(
        points,
        .25 + .03 * Math.sin(i * .8),
        .03,
        i % 4 === 0 ? "#284757" : "#23404f",
        { profile: [0, .93, 1, 1, .7, 0], ridge: -.1 },
      );
    }
    // Five broad bangs establish a sloping graphic fringe, with a short
    // counter-sweep by the part. Their tips stop above the eyes.
    for (let i = 0; i < 6; i++) {
      const endPhi = -.82 + i * .34;
      const points = Array.from({ length: 9 }, (_, j) => {
        const t = j / 8;
        const theta = THREE.MathUtils.lerp(
          .03 + i * .028,
          1.30 + .10 * Math.sin(i * .7),
          t,
        );
        const phi = THREE.MathUtils.lerp(-1.30, endPhi, Math.pow(t, .7));
        return scalpPoint(
          theta,
          phi,
          .018 + .044 * Math.sin(Math.PI * t) + i * .002,
        );
      });
      lock(
        points,
        .24 + .02 * Math.sin(i),
        .035,
        i % 3 === 0 ? "#315466" : "#294b5d",
        {
          profile: [0, 1, 1, .9, 0],
          ridge: -.18,
        },
      );
    }
    // Low side pieces conceal the ear/back junction and point inward at the jaw.
    for (const sign of [-1, 1]) {
      lock(
        [
          scalpPoint(.75, sign * 1.35, .10),
          scalpPoint(1.2, sign * 1.38, .10),
          new THREE.Vector3(sign * .49, .75, .10),
          new THREE.Vector3(sign * .43, .47, .17),
        ],
        .24,
        .047,
        "#294c5d",
        { profile: [.45, 1, .9, 0] },
      );
    }
  }
  group.userData.cartoonHair = {
    style,
    representation: "closed sculpted locks",
  };
  return group;
}

/** Muted untextured skin keeps the supplied anatomical head coherent with the wig. */
export async function buildCartoonHaircut(
  style: CartoonHairStyle = "quiff",
): Promise<THREE.Group> {
  const head = await buildHead();
  head.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (
      const material of Array.isArray(object.material)
        ? object.material
        : [object.material]
    ) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (material.name === "portrait_head_skin") {
        material.map = null;
        material.normalMap = null;
        material.color.set("#c9947d");
        material.roughness = .84;
      }
    }
  });
  const group = new THREE.Group();
  group.name = `cartoon-${style}`;
  group.add(head, buildCartoonWig(style));
  group.userData.preview = {
    grid: false,
    background: "#30383d",
    direction: [.36, .07, 1],
    target: [0, .65, 0],
    radius: 1.07,
    padding: 1.04,
    exposure: 1.08,
    lighting: { hemisphere: 1.4, key: 2.3, fill: .5, shadows: true },
  };
  return group;
}
