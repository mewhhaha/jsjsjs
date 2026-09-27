import * as THREE from "three";
import scalp from "./assets/scalp.json" with { type: "json" };

/** Shared wig fitting surface. +Z is the face; phi=0 is the forehead. */
export const SCALP = {
  center: [0, .78, 0],
  radii: [.472, .636, .413],
} as const;

/** Bilinear radial correction sampled from the actual anatomical head mesh. */
export function scalpFactor(theta: number, phi: number): number {
  const row = Math.max(
    0,
    Math.min(scalp.rows - 1, theta / scalp.thetaMax * (scalp.rows - 1)),
  );
  const col = ((phi / (Math.PI * 2) % 1) + 1) % 1 * scalp.columns;
  const r0 = Math.floor(row), r1 = Math.min(scalp.rows - 1, r0 + 1);
  const c0 = Math.floor(col) % scalp.columns, c1 = (c0 + 1) % scalp.columns;
  const at = (r: number, c: number) => scalp.factors[r * scalp.columns + c];
  return THREE.MathUtils.lerp(
    THREE.MathUtils.lerp(at(r0, c0), at(r0, c1), col - Math.floor(col)),
    THREE.MathUtils.lerp(at(r1, c0), at(r1, c1), col - Math.floor(col)),
    row - r0,
  );
}

export function scalpPoint(
  theta: number,
  phi: number,
  lift = 0,
): THREE.Vector3 {
  const [rx, ry, rz] = SCALP.radii;
  const s = Math.sin(theta), c = Math.cos(theta);
  const x = s * Math.sin(phi), z = s * Math.cos(phi);
  const normal = new THREE.Vector3(x / rx, c / ry, z / rz).normalize();
  const factor = scalpFactor(theta, phi);
  return new THREE.Vector3(
    x * rx * factor,
    .78 + c * ry * factor,
    z * rz * factor,
  ).addScaledVector(
    normal,
    lift,
  );
}

/** Smooth forehead, temple and nape boundary. */
export function hairline(phi: number): number {
  const front = Math.max(0, Math.cos(phi)), back = Math.max(0, -Math.cos(phi));
  return 1.73 - .55 * Math.pow(front, 1.8) + .21 * Math.pow(back, 1.5);
}

/** Matte fitted underlayer, so lower strand counts still read as a solid hairstyle. */
export function makeCap(
  color: THREE.ColorRepresentation,
  offset = 0,
): THREE.Mesh {
  const rings = 24, sides = 72;
  const positions: number[] = [], indices: number[] = [], uv: number[] = [];
  for (let row = 0; row <= rings; row++) {
    for (let col = 0; col <= sides; col++) {
      const phi = col / sides * Math.PI * 2;
      const point = scalpPoint(row / rings * hairline(phi), phi, offset);
      positions.push(point.x, point.y, point.z);
      uv.push(col / sides, row / rings);
      if (row && col < sides) {
        const a = (row - 1) * (sides + 1) + col, b = a + sides + 1;
        if (row > 1) indices.push(a, b, a + 1);
        indices.push(a + 1, b, b + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(positions, 3),
  );
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color,
    roughness: .83,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "fitted scalp underlayer";
  return mesh;
}
