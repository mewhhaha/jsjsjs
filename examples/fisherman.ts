import * as THREE from "three";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Edit joint angles in degrees here, then save to pose the character.
export const pose: Record<string, [number, number, number]> = {
  UpperArm_R: [0, 0, -12],
  Forearm_R: [-12, 0, -145],
  Hand_R: [0, 12, 8],
  UpperArm_L: [-8, 0, 8],
  Forearm_L: [-12, 0, 0],
  Head: [0, -8, 0],
};
const showAccessories = true;
type Vec = [number, number, number];
type Weight = [string, number][];
type Ring = { p: Vec; r: [number, number]; w: Weight; opening?: number };

export default async function buildModel(): Promise<THREE.Scene> {
  // A scene keeps skinned meshes at the GLB root, as required by skin transforms.
  const model = new THREE.Scene();
  model.name = "Fisherman";
  const loader = new THREE.TextureLoader();
  const [albedo, normal, details, detailsNormal] = await Promise.all([
    loader.loadAsync("/assets/fisherman/albedo.png"),
    loader.loadAsync("/assets/fisherman/normal.png"),
    loader.loadAsync("/assets/fisherman/details-albedo.png"),
    loader.loadAsync("/assets/fisherman/details-normal.png"),
  ]);
  albedo.colorSpace = details.colorSpace = THREE.SRGBColorSpace;
  albedo.anisotropy = normal.anisotropy = 4;
  const materials = {
    coat: new THREE.MeshStandardMaterial({
      name: "Yellow_oilskin",
      map: albedo,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.25, 0.25),
      color: "#ead989",
      roughness: 0.64,
      side: THREE.DoubleSide,
    }),
    lining: new THREE.MeshStandardMaterial({
      name: "Hood_lining",
      map: albedo,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.18, 0.18),
      color: "#665c38",
      roughness: 0.9,
      side: THREE.DoubleSide,
    }),
    face: new THREE.MeshStandardMaterial({
      name: "Face_and_beard",
      map: albedo,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.13, 0.13),
      roughness: 0.78,
    }),
    skin: new THREE.MeshStandardMaterial({
      name: "Weathered_skin",
      map: albedo,
      normalMap: normal,
      normalScale: new THREE.Vector2(0.18, 0.18),
      roughness: 0.75,
    }),
    trousers: new THREE.MeshStandardMaterial({
      name: "Charcoal_denim",
      map: details,
      normalMap: detailsNormal,
      normalScale: new THREE.Vector2(0.3, 0.3),
      roughness: 0.91,
    }),
    shirt: new THREE.MeshStandardMaterial({
      name: "Faded_cotton_shirt",
      map: details,
      normalMap: detailsNormal,
      normalScale: new THREE.Vector2(0.13, 0.13),
      color: "#e2e4d7",
      roughness: 0.98,
    }),
    boots: new THREE.MeshStandardMaterial({
      name: "Rubber_boots",
      map: details,
      normalMap: detailsNormal,
      normalScale: new THREE.Vector2(0.2, 0.2),
      color: "#474946",
      roughness: 0.76,
    }),
    hardware: new THREE.MeshStandardMaterial({
      name: "Dark_brass_hardware",
      color: "#4b4130",
      metalness: 0.6,
      roughness: 0.4,
    }),
  };
  type Material = keyof typeof materials;
  // Atlas quadrants: face / oilskin / denim / plain skin. Inset avoids seams.
  const tiles: Record<Material, [number, number]> = {
    coat: [0.5, 0.5],
    lining: [0.5, 0.5],
    face: [0, 0.5],
    skin: [0.5, 0],
    trousers: [0.5, 0],
    shirt: [0, 0.5],
    boots: [0, 0],
    hardware: [0, 0],
  };
  const bones: THREE.Bone[] = [];
  const ids: Record<string, number> = {};
  const joints: Record<string, THREE.Bone> = {};
  const positions: Record<string, THREE.Vector3> = {};
  function bone(name: string, parent: string | null, p: Vec) {
    const joint = new THREE.Bone();
    joint.name = name;
    positions[name] = new THREE.Vector3(...p);
    joint.position.copy(positions[name]);
    if (parent) {
      joint.position.sub(positions[parent]);
      joints[parent].add(joint);
    } else model.add(joint);
    ids[name] = bones.length;
    bones.push(joint);
    joints[name] = joint;
  }
  bone("Root", null, [0, 0, 0]);
  bone("Hips", "Root", [0, 0.97, 0]);
  bone("Spine", "Hips", [0, 1.14, 0]);
  bone("Chest", "Spine", [0, 1.39, 0]);
  bone("Neck", "Chest", [0, 1.53, 0]);
  bone("Head", "Neck", [0, 1.63, 0]);
  bone("Jaw", "Head", [0, 1.66, 0.04]);
  for (const [side, sign] of [["L", 1], ["R", -1]] as const) {
    bone(`Clavicle_${side}`, "Chest", [sign * 0.17, 1.43, 0]);
    bone(`UpperArm_${side}`, `Clavicle_${side}`, [sign * 0.245, 1.43, 0]);
    bone(`Forearm_${side}`, `UpperArm_${side}`, [sign * 0.395, 1.20, 0]);
    bone(`Hand_${side}`, `Forearm_${side}`, [sign * 0.485, 0.99, 0.025]);
    bone(`Thigh_${side}`, "Hips", [sign * 0.105, 0.94, 0]);
    bone(`Shin_${side}`, `Thigh_${side}`, [sign * 0.11, 0.54, 0.014]);
    bone(`Foot_${side}`, `Shin_${side}`, [sign * 0.11, 0.12, 0]);
    bone(`Toe_${side}`, `Foot_${side}`, [sign * 0.11, 0.055, 0.12]);
    bone(`Coat_${side}`, "Hips", [sign * 0.17, 0.92, 0]);
    for (let finger = 0; finger < 5; finger++) {
      const x = sign * (0.457 + finger * 0.014);
      const y = finger === 0 ? 0.955 : 0.92;
      const z = finger === 0 ? 0.066 : 0.03;
      const length = finger === 0 || finger === 4 ? 0.055 : 0.075;
      for (let segment = 0; segment < 3; segment++) {
        const name = `Finger${finger}_${segment}_${side}`;
        bone(
          name,
          segment ? `Finger${finger}_${segment - 1}_${side}` : `Hand_${side}`,
          [x, y - segment * length / 3, z],
        );
      }
    }
  }
  function tangents(geometry: THREE.BufferGeometry) {
    if (!geometry.index || !geometry.getAttribute("uv")) return;
    geometry.computeTangents();
    const tangent = geometry.getAttribute("tangent");
    const normal = geometry.getAttribute("normal");
    for (let i = 0; i < tangent.count; i++) {
      const t = new THREE.Vector3(
        tangent.getX(i),
        tangent.getY(i),
        tangent.getZ(i),
      );
      if (t.lengthSq() < 0.5 || !Number.isFinite(t.lengthSq())) {
        const n = new THREE.Vector3().fromBufferAttribute(normal, i);
        const axis = Math.abs(n.y) < 0.9
          ? new THREE.Vector3(0, 1, 0)
          : new THREE.Vector3(1, 0, 0);
        t.crossVectors(axis, n).normalize();
        tangent.setXYZW(i, t.x, t.y, t.z, 1);
      }
    }
  }
  const pieces = new Map<Material, THREE.BufferGeometry[]>();
  function register(
    geometry: THREE.BufferGeometry,
    material: Material,
    weights: Weight[] | Weight,
  ) {
    const position = geometry.getAttribute("position");
    const index = new Uint16Array(position.count * 4);
    const weight = new Float32Array(position.count * 4);
    const varying = typeof weights[0]?.[0] !== "string";
    for (let i = 0; i < position.count; i++) {
      const influences = (varying ? weights[i] : weights) as Weight;
      const total = influences.reduce((sum, [, w]) => sum + w, 0);
      for (let j = 0; j < influences.length; j++) {
        if (influences[j][1] <= 0) continue;
        index[i * 4 + j] = ids[influences[j][0]];
        weight[i * 4 + j] = influences[j][1] / total;
      }
    }
    geometry.setAttribute(
      "skinIndex",
      new THREE.Uint16BufferAttribute(index, 4),
    );
    geometry.setAttribute(
      "skinWeight",
      new THREE.Float32BufferAttribute(weight, 4),
    );
    const uv = geometry.getAttribute("uv");
    const tile = tiles[material];
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(
        i,
        tile[0] + 0.008 + uv.getX(i) * 0.484,
        tile[1] + 0.008 + uv.getY(i) * 0.484,
      );
    }
    if (materials[material].normalMap) tangents(geometry);
    const list = pieces.get(material) ?? [];
    list.push(geometry.index ? geometry.toNonIndexed() : geometry);
    if (geometry.index) geometry.dispose();
    pieces.set(material, list);
  }
  function loft(rings: Ring[], material: Material, segments = 10, cap = true) {
    const p: number[] = [], uv: number[] = [], indices: number[] = [];
    const weights: Weight[] = [];
    for (let row = 0; row < rings.length; row++) {
      const ring = rings[row];
      for (let j = 0; j <= segments; j++) {
        const opening = ring.opening ?? 0;
        const theta = opening + j / segments * (Math.PI * 2 - opening * 2);
        p.push(
          ring.p[0] + Math.sin(theta) * ring.r[0],
          ring.p[1],
          ring.p[2] + Math.cos(theta) * ring.r[1],
        );
        uv.push(j / segments, row / (rings.length - 1));
        if (
          ring.w.some(([name]) => name === "Coat_L") &&
          ring.w.some(([name]) => name === "Coat_R")
        ) {
          const left = (Math.sin(theta) + 1) / 2;
          weights.push([["Coat_L", left], ["Coat_R", 1 - left]]);
        } else weights.push(ring.w);
        if (row < rings.length - 1 && j < segments) {
          const a = row * (segments + 1) + j, b = a + segments + 1;
          indices.push(a, a + 1, b, b, a + 1, b + 1);
        }
      }
    }
    if (cap && !rings[0].opening) {
      for (let j = 1; j < segments - 1; j++) {
        indices.push(0, j + 1, j);
        const a = (rings.length - 1) * (segments + 1);
        indices.push(a, a + j, a + j + 1);
      }
    }
    if (rings.at(-1)!.p[1] < rings[0].p[1]) {
      for (let i = 0; i < indices.length; i += 3) {
        [indices[i + 1], indices[i + 2]] = [indices[i + 2], indices[i + 1]];
      }
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
    geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geometry.setIndex(indices);
    geometry.computeVertexNormals();
    register(geometry, material, weights);
  }
  function sphere(
    center: Vec,
    scale: Vec,
    material: Material,
    weights: Weight,
    segments = 10,
  ) {
    const geometry = new THREE.SphereGeometry(1, segments, 6);
    geometry.scale(...scale).translate(...center);
    register(geometry, material, weights);
  }
  function box(
    center: Vec,
    scale: Vec,
    material: Material,
    weights: Weight,
    angle = 0,
  ) {
    const geometry = new THREE.BoxGeometry(...scale);
    geometry.rotateZ(angle).translate(...center);
    register(geometry, material, weights);
  }

  // Trousers, articulated legs, and heavy rubber deck boots.
  loft(
    [
      { p: [0, 0.87, 0], r: [0.18, 0.11], w: [["Hips", 1]] },
      { p: [0, 1.035, 0], r: [0.165, 0.115], w: [["Hips", 1]] },
    ],
    "trousers",
    12,
  );
  for (const [side, sign] of [["L", 1], ["R", -1]] as const) {
    const thigh = `Thigh_${side}`, shin = `Shin_${side}`, foot = `Foot_${side}`;
    loft(
      [
        { p: [sign * 0.11, 0.16, 0], r: [0.065, 0.068], w: [[shin, 1]] },
        { p: [sign * 0.11, 0.29, 0], r: [0.077, 0.072], w: [[shin, 1]] },
        {
          p: [sign * 0.115, 0.48, 0.025],
          r: [0.073, 0.071],
          w: [[shin, 0.8], [thigh, 0.2]],
        },
        {
          p: [sign * 0.11, 0.56, 0.015],
          r: [0.078, 0.085],
          w: [[shin, 0.45], [thigh, 0.55]],
        },
        { p: [sign * 0.105, 0.76, 0], r: [0.091, 0.102], w: [[thigh, 1]] },
        {
          p: [sign * 0.095, 0.94, 0],
          r: [0.10, 0.113],
          w: [[thigh, 0.65], ["Hips", 0.35]],
        },
      ],
      "trousers",
      10,
    );
    sphere([sign * 0.11, 0.075, 0.065], [0.086, 0.074, 0.17], "boots", [[
      foot,
      1,
    ]], 10);
    box([sign * 0.11, 0.019, 0.05], [0.166, 0.03, 0.29], "boots", [[foot, 1]]);
    loft(
      [
        { p: [sign * 0.11, 0.07, 0], r: [0.076, 0.084], w: [[foot, 1]] },
        {
          p: [sign * 0.11, 0.19, 0],
          r: [0.070, 0.077],
          w: [[foot, 0.6], [shin, 0.4]],
        },
        { p: [sign * 0.11, 0.28, 0], r: [0.082, 0.082], w: [[shin, 1]] },
      ],
      "boots",
      10,
    );
  }

  loft(
    [
      { p: [0, 0.97, 0], r: [0.173, 0.114], w: [["Hips", 1]] },
      {
        p: [0, 1.12, 0],
        r: [0.175, 0.113],
        w: [["Spine", 0.8], ["Hips", 0.2]],
      },
      {
        p: [0, 1.30, 0],
        r: [0.206, 0.135],
        w: [["Chest", 0.6], ["Spine", 0.4]],
      },
      { p: [0, 1.43, 0], r: [0.23, 0.126], w: [["Chest", 1]] },
      { p: [0, 1.49, 0], r: [0.08, 0.08], w: [["Chest", 0.8], ["Neck", 0.2]] },
    ],
    "shirt",
    14,
  );
  // The open coat is a continuous shell, with extra weighted hem joints.
  const coatRows: [number, number, number, number][] = [
    [0.29, 0.305, 0.16, 0.34],
    [0.50, 0.30, 0.163, 0.31],
    [0.73, 0.277, 0.16, 0.30],
    [0.94, 0.231, 0.143, 0.34],
    [1.12, 0.217, 0.137, 0.40],
    [1.31, 0.247, 0.155, 0.70],
    [1.43, 0.259, 0.148, 0.90],
    [1.50, 0.135, 0.116, 0.83],
  ];
  const coatRings: Ring[] = coatRows.map(([y, rx, rz, opening]) => ({
    p: [0, y, -0.008],
    r: [rx, rz],
    opening,
    w: y < 0.9
      ? [["Coat_L", 0.5], ["Coat_R", 0.5]]
      : y < 1.15
      ? [["Hips", 0.5], ["Spine", 0.5]]
      : [["Chest", 1]],
  }));
  loft(coatRings, "coat", 18, false);
  // Thick front facings, pockets and button placket.
  for (const sign of [-1, 1]) {
    const facing: Ring[] = coatRows.map(([y, rx, rz, opening]) => ({
      p: [sign * Math.sin(opening) * rx, y, Math.cos(opening) * rz + 0.006],
      r: [0.012, 0.009],
      w: y < 0.9
        ? [[`Coat_${sign > 0 ? "L" : "R"}`, 1]]
        : y < 1.2
        ? [["Spine", 0.6], ["Hips", 0.4]]
        : [["Chest", 1]],
    }));
    loft(facing, "coat", 5);
    box([sign * 0.218, 0.86, 0.087], [0.105, 0.14, 0.021], "coat", [[
      "Hips",
      0.8,
    ], ["Spine", 0.2]], sign * 0.10);
    box([sign * 0.218, 0.927, 0.100], [0.115, 0.031, 0.016], "coat", [[
      "Hips",
      0.8,
    ], ["Spine", 0.2]], sign * 0.10);
  }
  for (const y of [0.42, 0.63, 0.85, 1.05, 1.23]) {
    sphere(
      [-0.103, y, 0.165],
      [0.010, 0.010, 0.004],
      "hardware",
      y < 0.9 ? [["Coat_R", 1]] : [["Spine", 1]],
      8,
    );
  }
  // Neck is separate from the photo-projected facial surface.
  loft(
    [
      {
        p: [0, 1.44, 0],
        r: [0.069, 0.067],
        w: [["Neck", 0.7], ["Chest", 0.3]],
      },
      { p: [0, 1.59, 0], r: [0.056, 0.061], w: [["Head", 0.5], ["Neck", 0.5]] },
    ],
    "skin",
    10,
  );

  // Sleeves smoothly blend across shoulder, elbow, and wrist joints.
  for (const [side, sign] of [["L", 1], ["R", -1]] as const) {
    const upper = `UpperArm_${side}`,
      fore = `Forearm_${side}`,
      hand = `Hand_${side}`;
    loft(
      [
        {
          p: [sign * 0.479, 1.018, 0.022],
          r: [0.049, 0.054],
          w: [[fore, 0.8], [hand, 0.2]],
        },
        { p: [sign * 0.459, 1.068, 0.02], r: [0.064, 0.064], w: [[fore, 1]] },
        {
          p: [sign * 0.427, 1.14, 0.01],
          r: [0.068, 0.068],
          w: [[fore, 0.9], [upper, 0.1]],
        },
        {
          p: [sign * 0.392, 1.21, 0],
          r: [0.074, 0.075],
          w: [[fore, 0.45], [upper, 0.55]],
        },
        { p: [sign * 0.33, 1.31, 0], r: [0.085, 0.08], w: [[upper, 1]] },
        {
          p: [sign * 0.259, 1.405, 0],
          r: [0.09, 0.095],
          w: [[upper, 0.85], ["Chest", 0.15]],
        },
        {
          p: [sign * 0.224, 1.448, 0],
          r: [0.073, 0.07],
          w: [[upper, 0.5], ["Chest", 0.5]],
        },
      ],
      "coat",
      10,
    );
    loft(
      [
        {
          p: [sign * 0.485, 1.0, 0.025],
          r: [0.048, 0.05],
          w: [[fore, 0.3], [hand, 0.7]],
        },
        {
          p: [sign * 0.476, 1.027, 0.022],
          r: [0.053, 0.056],
          w: [[fore, 0.8], [hand, 0.2]],
        },
      ],
      "lining",
      10,
    );
    sphere([sign * 0.485, 0.956, 0.03], [0.041, 0.069, 0.026], "skin", [[
      hand,
      1,
    ]], 10);
    for (let f = 0; f < 5; f++) {
      const x = sign * (0.457 + f * 0.014),
        y = f === 0 ? 0.955 : 0.92,
        z = f === 0 ? 0.066 : 0.03;
      const length = f === 0 || f === 4 ? 0.055 : 0.075;
      const rows: Ring[] = [];
      for (let segment = 0; segment < 4; segment++) {
        rows.push({
          p: [x, y - segment * length / 3, z],
          r: [segment === 3 ? 0.004 : 0.008, segment === 3 ? 0.004 : 0.009],
          w: [[`Finger${f}_${Math.min(segment, 2)}_${side}`, 1]],
        });
      }
      loft(rows, "skin", 6);
    }
  }

  // Anatomical low-poly head volume plus an explicitly UV-mapped face surface.
  sphere([0, 1.723, -0.018], [0.113, 0.16, 0.113], "skin", [["Head", 1]], 14);
  for (const sign of [-1, 1]) {
    sphere([sign * 0.113, 1.725, 0.013], [0.022, 0.040, 0.016], "skin", [[
      "Head",
      1,
    ]], 8);
  }
  const facePositions: number[] = [],
    faceUV: number[] = [],
    faceIndices: number[] = [],
    faceWeights: Weight[] = [];
  const widths = [
    0.055,
    0.081,
    0.099,
    0.108,
    0.115,
    0.117,
    0.117,
    0.116,
    0.113,
    0.109,
    0.095,
    0.060,
  ];
  const columns = 12;
  const gaussian = (x: number, center: number, width: number) =>
    Math.exp(-Math.pow((x - center) / width, 2));
  for (let row = 0; row < widths.length; row++) {
    const v = row / (widths.length - 1), y = 1.555 + v * 0.338;
    for (let column = 0; column <= columns; column++) {
      const nx = column / columns * 2 - 1, x = nx * widths[row];
      let z = 0.063 + 0.036 * (1 - nx * nx);
      z += 0.063 * gaussian(x, 0, 0.026) * gaussian(y, 1.693, 0.034);
      z += 0.013 * gaussian(x, 0, 0.062) * gaussian(y, 1.637, 0.022);
      z += 0.012 * gaussian(y, 1.763, 0.012) * (1 - nx * nx);
      z -= 0.012 * (gaussian(x, 0.047, 0.026) + gaussian(x, -0.047, 0.026)) *
        gaussian(y, 1.746, 0.014);
      facePositions.push(x, y, z);
      faceUV.push(column / columns, v);
      const jaw = THREE.MathUtils.clamp((1.675 - y) / 0.07, 0, 0.85);
      faceWeights.push([["Head", 1 - jaw], ["Jaw", jaw]]);
      if (row < widths.length - 1 && column < columns) {
        const a = row * (columns + 1) + column, b = a + columns + 1;
        faceIndices.push(a, a + 1, b, a + 1, b + 1, b);
      }
    }
  }
  const faceGeometry = new THREE.BufferGeometry();
  faceGeometry.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(facePositions, 3),
  );
  faceGeometry.setAttribute("uv", new THREE.Float32BufferAttribute(faceUV, 2));
  faceGeometry.setIndex(faceIndices);
  faceGeometry.computeVertexNormals();
  register(faceGeometry, "face", faceWeights);

  // Hood wraps the back of the head, leaving a deep open front around the face.
  const hoodRows: [number, number, number, number][] = [
    [1.49, 0.112, 0.098, 0.82],
    [1.56, 0.156, 0.135, 0.90],
    [1.68, 0.161, 0.150, 0.81],
    [1.81, 0.153, 0.148, 0.70],
    [1.90, 0.131, 0.12, 0.52],
    [1.965, 0.066, 0.066, 0.2],
    [1.98, 0.008, 0.010, 0.02],
  ];
  for (const [material, scale] of [["coat", 1], ["lining", 0.96]] as const) {
    loft(
      hoodRows.map(([y, rx, rz, opening]) => ({
        p: [0, y, -0.016],
        r: [rx * scale, rz * scale],
        opening,
        w: [["Head", y > 1.62 ? 1 : 0.55], ["Neck", y > 1.62 ? 0 : 0.45]],
      })),
      material,
      16,
      false,
    );
  }
  for (const sign of [-1, 1]) {
    loft(
      hoodRows.slice(0, -1).map(([y, rx, rz, opening]) => ({
        p: [sign * Math.sin(opening) * rx, y, Math.cos(opening) * rz - 0.010],
        r: [0.011, 0.012],
        w: [["Head", y > 1.62 ? 1 : 0.55], ["Neck", y > 1.62 ? 0 : 0.45]],
      })),
      "coat",
      6,
    );
  }

  model.updateMatrixWorld(true);
  const skeleton = new THREE.Skeleton(bones);
  for (const [material, geometries] of pieces) {
    const geometry = mergeGeometries(geometries)!;
    const mesh = new THREE.SkinnedMesh(geometry, materials[material]);
    mesh.name = `Fisherman_${material}`;
    mesh.bind(skeleton);
    mesh.frustumCulled = false;
    model.add(mesh);
    for (const piece of geometries) piece.dispose();
  }

  // Accessories are bone children, so they follow hand poses and export with the rig.
  if (showAccessories) {
    const rodMat = new THREE.MeshStandardMaterial({
      name: "Fishing_rod",
      color: "#344a48",
      metalness: 0.45,
      roughness: 0.45,
    });
    const corkMat = new THREE.MeshStandardMaterial({
      name: "Cork_grip",
      color: "#796d48",
      roughness: 0.94,
    });
    const prop = (
      parent: THREE.Object3D,
      name: string,
      geometry: THREE.BufferGeometry,
      material: THREE.Material,
      p: Vec,
    ) => {
      if (
        material instanceof THREE.MeshStandardMaterial && material.normalMap
      ) tangents(geometry);
      const mesh = new THREE.Mesh(geometry, material);
      mesh.name = name;
      mesh.position.set(...p);
      parent.add(mesh);
      return mesh;
    };
    const rod = new THREE.Group();
    rod.name = "Fishing_rod_prop";
    joints.Hand_R.add(rod);
    prop(
      rod,
      "rod_shaft",
      new THREE.CylinderGeometry(0.004, 0.009, 0.74, 7),
      rodMat,
      [0, -0.35, 0.055],
    );
    prop(
      rod,
      "cork_handle",
      new THREE.CylinderGeometry(0.015, 0.015, 0.14, 8),
      corkMat,
      [0, -0.025, 0.055],
    );
    prop(
      rod,
      "fishing_reel",
      new THREE.TorusGeometry(0.031, 0.010, 6, 12),
      rodMat,
      [0.027, -0.07, 0.055],
    );
    for (const y of [-0.21, -0.40, -0.60]) {
      prop(
        rod,
        "line_guide",
        new THREE.TorusGeometry(0.012, 0.003, 5, 8),
        rodMat,
        [0.013, y, 0.055],
      );
    }
    const fish = new THREE.Group();
    fish.name = "Fish_prop";
    joints.Hand_L.add(fish);
    fish.position.set(0, -0.10, 0.037);
    const fishMap = details.clone();
    const fishNormal = detailsNormal.clone();
    for (const texture of [fishMap, fishNormal]) {
      texture.repeat.set(0.484, 0.484);
      texture.offset.set(0.508, 0.508);
      texture.needsUpdate = true;
    }
    const fishMat = new THREE.MeshStandardMaterial({
      name: "Copper_fish_scales",
      map: fishMap,
      normalMap: fishNormal,
      normalScale: new THREE.Vector2(0.3, 0.3),
      color: "#d6bfaa",
      metalness: 0.25,
      roughness: 0.52,
    });
    const belly = new THREE.MeshStandardMaterial({
      name: "Fish_belly",
      color: "#d6c8a5",
      roughness: 0.6,
    });
    prop(fish, "fish_body", new THREE.SphereGeometry(1, 10, 8), fishMat, [
      0,
      -0.16,
      0,
    ]).scale.set(0.078, 0.18, 0.039);
    prop(fish, "fish_belly", new THREE.SphereGeometry(1, 8, 6), belly, [
      -0.021,
      -0.16,
      0.026,
    ]).scale.set(0.040, 0.15, 0.018);
    const fin = (name: string, vertices: number[], position: Vec) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
      g.setAttribute(
        "uv",
        new THREE.Float32BufferAttribute([0.5, 1, 0, 0, 1, 0], 2),
      );
      g.setIndex([0, 1, 2]);
      g.computeVertexNormals();
      const mat = fishMat.clone();
      mat.side = THREE.DoubleSide;
      prop(fish, name, g, mat, position);
    };
    fin("forked_tail_left", [0, 0, 0, -0.081, -0.09, 0, 0.01, -0.06, 0], [
      0,
      -0.31,
      0,
    ]);
    fin("forked_tail_right", [0, 0, 0, 0.081, -0.09, 0, -0.01, -0.06, 0], [
      0,
      -0.31,
      0,
    ]);
    fin("dorsal_fin", [0, 0, 0, 0.07, -0.035, 0, 0, -0.14, 0], [
      0.062,
      -0.10,
      0,
    ]);
    const eyeMat = new THREE.MeshStandardMaterial({
      color: "#0a1512",
      roughness: 0.1,
    });
    prop(fish, "fish_eye", new THREE.SphereGeometry(0.007, 6, 4), eyeMat, [
      -0.021,
      -0.028,
      0.031,
    ]);
  }

  for (const [name, angles] of Object.entries(pose)) {
    joints[name].rotation.set(...angles.map(THREE.MathUtils.degToRad) as Vec);
  }
  for (const side of ["L", "R"]) {
    for (let f = 0; f < 5; f++) {
      for (let segment = 0; segment < 3; segment++) {
        joints[`Finger${f}_${segment}_${side}`].rotation.x = side === "R"
          ? 0.5
          : 0.24;
      }
    }
  }
  model.updateMatrixWorld(true);
  // A portable example animation accompanies the editable humanoid skeleton.
  const track = (name: string, axis: "x" | "y" | "z", values: number[]) => {
    const rotations = values.flatMap((value) => {
      const euler = joints[name].rotation.clone();
      euler[axis] = value;
      return new THREE.Quaternion().setFromEuler(euler).toArray();
    });
    return new THREE.QuaternionKeyframeTrack(`${name}.quaternion`, [
      0,
      1,
      2,
      3,
      4,
    ], rotations);
  };
  model.animations = [
    new THREE.AnimationClip("Breathing_idle", 4, [
      track("Chest", "x", [0, 0.015, 0, -0.008, 0]),
      track("Head", "y", [-0.14, -0.10, -0.14, -0.18, -0.14]),
      track("Coat_L", "z", [0, 0.012, 0, -0.008, 0]),
    ]),
  ];
  model.userData = {
    authoring:
      "Low-poly fisherman with generated photographic albedo and OpenGL normal maps",
    rig: "Humanoid FK skeleton; editable pose in fisherman.ts",
    bones: bones.length,
    preview: { direction: [0.27, 0.12, 1], padding: 1.02 },
  };
  return model;
}
