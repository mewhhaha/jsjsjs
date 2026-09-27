import * as THREE from "three";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// Dimensions in metres. All geometry and textures are generated locally.
const width = 2.6;
const depth = 2.25;
const height = 3.25;
const barRadius = 0.026;
const doorOpenDegrees = 0;
const textureSize = 512;

function randomGenerator(seed: number) {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

// Periodic value noise keeps the rust and pitting seamless across UV repeats.
function noiseLayer(cells: number, random: () => number) {
  const values = Float32Array.from({ length: cells * cells }, random);
  return (u: number, v: number) => {
    const x = u * cells;
    const y = v * cells;
    const ix = Math.floor(x);
    const iy = Math.floor(y);
    const smooth = (t: number) => t * t * (3 - 2 * t);
    const sx = smooth(x - ix);
    const sy = smooth(y - iy);
    const at = (a: number, b: number) =>
      values[(b % cells) * cells + (a % cells)];
    return THREE.MathUtils.lerp(
      THREE.MathUtils.lerp(at(ix, iy), at(ix + 1, iy), sx),
      THREE.MathUtils.lerp(at(ix, iy + 1), at(ix + 1, iy + 1), sx),
      sy,
    );
  };
}

function weatheredMetal() {
  const random = randomGenerator(81934);
  const coarse = noiseLayer(8, random);
  const medium = noiseLayer(32, random);
  const fine = noiseLayer(96, random);
  const color = new Uint8Array(textureSize * textureSize * 4);
  const surface = new Uint8Array(color.length);
  const bump = new Uint8Array(color.length);
  for (let y = 0; y < textureSize; y++) {
    for (let x = 0; x < textureSize; x++) {
      const u = x / textureSize;
      const v = y / textureSize;
      const grain = random();
      const detail = medium(u, v);
      const pits = fine(u, v);
      const rust = THREE.MathUtils.smoothstep(
        coarse(u, v) * 0.7 + detail * 0.3,
        0.58,
        0.80,
      );
      const fleck = grain < 0.025 ? 0.42 : 1;
      const steel = (78 + detail * 46 + (grain - 0.5) * 22) * fleck;
      const offset = (y * textureSize + x) * 4;
      color[offset] = THREE.MathUtils.lerp(steel * 0.87, 85 + pits * 35, rust);
      color[offset + 1] = THREE.MathUtils.lerp(
        steel * 0.96,
        45 + pits * 20,
        rust,
      );
      color[offset + 2] = THREE.MathUtils.lerp(steel, 25 + pits * 12, rust);
      color[offset + 3] = 255;
      // Green = roughness, blue = metallic, as expected by Three.js.
      surface[offset] = 255;
      surface[offset + 1] = THREE.MathUtils.lerp(135 + pits * 30, 245, rust);
      surface[offset + 2] = THREE.MathUtils.lerp(210, 12, rust);
      surface[offset + 3] = 255;
      bump.fill(
        Math.max(0, 110 + pits * 65 - rust * 45 - (1 - fleck) * 85),
        offset,
        offset + 3,
      );
      bump[offset + 3] = 255;
    }
  }
  // Short polished scratches cut through the oxide layer.
  for (let i = 0; i < 420; i++) {
    const x = Math.floor(random() * textureSize);
    const y = Math.floor(random() * textureSize);
    const length = 2 + Math.floor(random() * 24);
    for (let j = 0; j < length; j++) {
      const offset = (((y + j) % textureSize) * textureSize + x) * 4;
      const brightness = 115 + Math.sin(j / length * Math.PI) * 35;
      color.set([brightness * 0.9, brightness * 0.97, brightness, 255], offset);
      surface.set([255, 95, 225, 255], offset);
    }
  }
  function texture(data: Uint8Array, srgb = false) {
    const result = new THREE.DataTexture(data, textureSize, textureSize);
    result.wrapS = result.wrapT = THREE.RepeatWrapping;
    result.magFilter = THREE.LinearFilter;
    result.minFilter = THREE.LinearMipmapLinearFilter;
    result.generateMipmaps = true;
    result.anisotropy = 8;
    if (srgb) result.colorSpace = THREE.SRGBColorSpace;
    result.needsUpdate = true;
    return result;
  }
  const map = texture(color, true);
  const packed = texture(surface);
  return new THREE.MeshStandardMaterial({
    name: "scratched_steel_with_iron_oxide",
    map,
    roughnessMap: packed,
    metalnessMap: packed,
    bumpMap: texture(bump),
    bumpScale: 0.007,
    roughness: 1,
    metalness: 1,
  });
}

export default function buildModel(): THREE.Group {
  const cage = new THREE.Group();
  const uvRandom = randomGenerator(5389);
  cage.name = "weathered_steel_bar_cage";
  const steel = weatheredMetal();
  const darkSteel = steel.clone();
  darkSteel.name = "darkened_welded_steel";
  darkSteel.color.set("#89949a");
  const wornSteel = steel.clone();
  wornSteel.name = "polished_edges_and_fasteners";
  wornSteel.color.set("#c0c7cb");
  wornSteel.roughness = 0.7;
  const brass = steel.clone();
  brass.name = "aged_brass_padlock";
  brass.color.set("#d7af59");
  brass.metalness = 0.75;
  const black = new THREE.MeshStandardMaterial({
    name: "keyhole",
    color: "#101313",
    roughness: 0.95,
  });

  function add(
    name: string,
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    position: [number, number, number],
    parent = cage,
  ) {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = name;
    mesh.position.set(...position);
    parent.add(mesh);
    return mesh;
  }
  function box(
    name: string,
    size: [number, number, number],
    position: [number, number, number],
    material = steel,
    parent = cage,
    radius = 0.012,
  ) {
    const geometry = new RoundedBoxGeometry(
      ...size,
      1,
      Math.min(radius, ...size.map((v) => v / 3)),
    );
    // World-scaled UVs prevent large plates stretching the weathering texture.
    const uv = geometry.getAttribute("uv");
    const normal = geometry.getAttribute("normal");
    const points = geometry.getAttribute("position");
    const uOffset = uvRandom();
    const vOffset = uvRandom();
    for (let i = 0; i < uv.count; i++) {
      const nx = Math.abs(normal.getX(i));
      const ny = Math.abs(normal.getY(i));
      const nz = Math.abs(normal.getZ(i));
      const a = nx > ny && nx > nz ? points.getZ(i) : points.getX(i);
      const b = ny > nx && ny > nz ? points.getZ(i) : points.getY(i);
      uv.setXY(i, a * 1.4 + uOffset, b * 1.4 + vOffset);
    }
    return add(name, geometry, material, position, parent);
  }
  function rod(
    name: string,
    from: [number, number, number],
    to: [number, number, number],
    radius = barRadius,
    material = steel,
    parent = cage,
    segments = 12,
  ) {
    const a = new THREE.Vector3(...from);
    const b = new THREE.Vector3(...to);
    const direction = b.clone().sub(a);
    const geometry = new THREE.CylinderGeometry(
      radius,
      radius,
      direction.length(),
      segments,
    );
    const uv = geometry.getAttribute("uv");
    const uOffset = uvRandom();
    const vOffset = uvRandom();
    for (let i = 0; i < uv.count; i++) {
      uv.setXY(
        i,
        uv.getX(i) * 0.4 + uOffset,
        uv.getY(i) * direction.length() * 1.4 + vOffset,
      );
    }
    const mesh = add(
      name,
      geometry,
      material,
      a.add(b).multiplyScalar(0.5).toArray(),
      parent,
    );
    mesh.quaternion.setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      direction.normalize(),
    );
    return mesh;
  }
  function bolt(x: number, y: number, z: number, parent = cage) {
    rod(
      "bolt_washer",
      [x, y, z],
      [x, y, z + 0.012],
      0.033,
      darkSteel,
      parent,
      16,
    );
    rod(
      "hex_bolt",
      [x, y, z + 0.01],
      [x, y, z + 0.029],
      0.023,
      wornSteel,
      parent,
      6,
    );
  }

  const hw = width / 2;
  const hd = depth / 2;
  const floorY = 0.19;
  for (const x of [-hw + 0.09, hw - 0.09]) {
    for (const z of [-hd + 0.09, hd - 0.09]) {
      box("foot_plate", [0.3, 0.07, 0.3], [x, 0.035, z], darkSteel);
      box("raised_foot", [0.16, 0.09, 0.16], [x, 0.105, z]);
    }
  }
  box("solid_checker_plate_floor", [width + 0.07, 0.1, depth + 0.07], [
    0,
    floorY - 0.05,
    0,
  ], darkSteel);

  // Raised tread is actual mesh geometry, so it also survives OBJ export.
  const tread: THREE.BufferGeometry[] = [];
  for (let x = -hw + 0.16, column = 0; x < hw - 0.1; x += 0.14, column++) {
    for (let z = -hd + 0.14, row = 0; z < hd - 0.1; z += 0.14, row++) {
      const geometry = new THREE.BoxGeometry(0.074, 0.007, 0.015);
      geometry.rotateY((column + row) % 2 ? Math.PI / 4 : -Math.PI / 4);
      geometry.translate(x, floorY + 0.004, z);
      tread.push(geometry);
    }
  }
  add("raised_diamond_tread", mergeGeometries(tread)!, wornSteel, [0, 0, 0]);
  for (const geometry of tread) geometry.dispose();

  for (const x of [-hw, hw]) {
    for (const z of [-hd, hd]) {
      box("square_corner_post", [0.11, height - floorY, 0.11], [
        x,
        (height + floorY) / 2,
        z,
      ]);
      box("post_cap", [0.16, 0.055, 0.16], [x, height + 0.03, z], wornSteel);
    }
  }
  for (const y of [floorY + 0.075, height - 0.035]) {
    for (const z of [-hd, hd]) {
      box("front_back_perimeter_rail", [width, 0.11, 0.1], [0, y, z]);
    }
    for (const x of [-hw, hw]) {
      box("side_perimeter_rail", [0.1, 0.11, depth], [x, y, 0]);
    }
  }
  // Vertical bars on three fixed panels, plus barred roof.
  for (let i = 1; i < 10; i++) {
    const x = -hw + width * i / 10;
    rod("back_vertical_bar", [x, floorY + 0.08, -hd], [x, height - 0.06, -hd]);
    rod("roof_bar", [x, height - 0.035, -hd], [x, height - 0.035, hd]);
  }
  for (const x of [-hw, hw]) {
    for (let i = 1; i < 9; i++) {
      const z = -hd + depth * i / 9;
      rod("side_vertical_bar", [x, floorY + 0.08, z], [x, height - 0.06, z]);
    }
    box("side_cross_strap", [0.034, 0.075, depth], [
      x + Math.sign(x) * 0.025,
      1.18,
      0,
    ], darkSteel);
  }
  box(
    "back_cross_strap",
    [width, 0.075, 0.034],
    [0, 1.18, -hd - 0.025],
    darkSteel,
  );
  box(
    "roof_cross_strap",
    [width, 0.03, 0.07],
    [0, height + 0.002, 0],
    darkSteel,
  );

  // Separate hinged door assembly. Set doorOpenDegrees above to swing it out.
  const door = new THREE.Group();
  door.name = "hinged_barred_door";
  door.position.set(-hw + 0.105, 0, hd + 0.012);
  door.rotation.y = -THREE.MathUtils.degToRad(doorOpenDegrees);
  cage.add(door);
  const dw = width - 0.21;
  const bottom = floorY + 0.15;
  const top = height - 0.15;
  for (const x of [0, dw]) {
    box(
      "door_stile",
      [0.074, top - bottom, 0.075],
      [x, (top + bottom) / 2, 0],
      steel,
      door,
    );
  }
  for (const y of [bottom, top, 1.18]) {
    box(
      "door_crossrail",
      [dw + 0.07, 0.084, 0.075],
      [dw / 2, y, 0],
      steel,
      door,
    );
  }
  for (let i = 1; i < 9; i++) {
    const x = dw * i / 9;
    rod(
      "door_vertical_bar",
      [x, bottom, 0],
      [x, top, 0],
      barRadius,
      steel,
      door,
    );
    // Small weld beads at the bar ends.
    for (const y of [bottom + 0.047, top - 0.047]) {
      rod(
        "bar_weld",
        [x, y - 0.012, 0],
        [x, y + 0.012, 0],
        barRadius * 1.3,
        darkSteel,
        door,
      );
    }
  }
  for (const y of [0.73, 2.68]) {
    box("hinge_leaf", [0.26, 0.14, 0.032], [0.04, y, 0.055], darkSteel, door);
    rod(
      "hinge_barrel",
      [-0.065, y - 0.105, 0.075],
      [-0.065, y + 0.105, 0.075],
      0.047,
      wornSteel,
      door,
    );
    rod(
      "hinge_pin_cap",
      [-0.065, y + 0.10, 0.075],
      [-0.065, y + 0.12, 0.075],
      0.056,
      darkSteel,
      door,
    );
    bolt(0.07, y, 0.077, door);
  }

  // Reinforcing tabs and exposed fasteners on the frame.
  for (const x of [-hw, hw]) {
    for (const y of [0.43, height - 0.22]) {
      box(
        "corner_reinforcement",
        [0.19, 0.29, 0.025],
        [x, y, hd + 0.06],
        darkSteel,
      );
      for (const offset of [-0.082, 0.082]) bolt(x, y + offset, hd + 0.075);
    }
  }

  const lockX = dw - 0.16;
  box(
    "latch_backplate",
    [0.32, 0.24, 0.026],
    [dw - 0.03, 1.57, 0.057],
    darkSteel,
    door,
  );
  box(
    "sliding_latch_bolt",
    [0.38, 0.065, 0.07],
    [dw - 0.04, 1.6, 0.10],
    wornSteel,
    door,
  );
  for (const x of [dw - 0.155, dw + 0.085]) bolt(x, 1.5, 0.075, door);
  box(
    "padlock_body",
    [0.18, 0.2, 0.09],
    [lockX, 1.38, 0.16],
    brass,
    door,
    0.025,
  );
  const shackle = add(
    "padlock_shackle",
    new THREE.TorusGeometry(0.056, 0.014, 8, 20, Math.PI),
    wornSteel,
    [lockX, 1.50, 0.16],
    door,
  );
  shackle.rotation.z = 0;
  for (const x of [-0.056, 0.056]) {
    rod(
      "shackle_leg",
      [lockX + x, 1.45, 0.16],
      [lockX + x, 1.50, 0.16],
      0.014,
      wornSteel,
      door,
    );
  }
  rod(
    "keyhole_round",
    [lockX, 1.38, 0.204],
    [lockX, 1.38, 0.208],
    0.015,
    black,
    door,
    12,
  );
  add("keyhole_slot", new THREE.BoxGeometry(0.012, 0.024, 0.003), black, [
    lockX,
    1.365,
    0.208,
  ], door);

  // Batch static parts by material while preserving the separate door pivot.
  // UVs, normals and vertex positions survive both rendering and OBJ export.
  for (const parent of [cage, door]) {
    const batches = new Map<THREE.Material, THREE.Mesh[]>();
    for (const child of parent.children) {
      if (!(child instanceof THREE.Mesh) || Array.isArray(child.material)) {
        continue;
      }
      const meshes = batches.get(child.material) ?? [];
      meshes.push(child);
      batches.set(child.material, meshes);
    }
    for (const [material, meshes] of batches) {
      const parts = meshes.map((mesh) => {
        mesh.updateMatrix();
        const geometry = mesh.geometry.index
          ? mesh.geometry.toNonIndexed()
          : mesh.geometry.clone();
        return geometry.applyMatrix4(mesh.matrix);
      });
      const merged = mergeGeometries(parts)!;
      for (const mesh of meshes) {
        parent.remove(mesh);
        mesh.geometry.dispose();
      }
      for (const part of parts) part.dispose();
      add(
        `${parent.name}_${material.name}`,
        merged,
        material,
        [0, 0, 0],
        parent,
      );
    }
  }
  return cage;
}
