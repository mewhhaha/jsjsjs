import * as THREE from "three";

// Edit these values and save. The viewer rebuilds without moving your camera.
const width = 4;
const depth = 3;
const height = 3;
const thickness = 0.3;

export default function buildModel(): THREE.Group {
  const model = new THREE.Group();
  model.name = "mounting_bracket";
  const material = new THREE.MeshStandardMaterial({
    color: "#c8dc91",
    roughness: 0.42,
    metalness: 0.25,
  });
  function plate(name: string, size: number[], position: number[]) {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
    mesh.name = name;
    mesh.position.set(position[0], position[1], position[2]);
    model.add(mesh);
  }
  plate("base", [width, thickness, depth], [0, thickness / 2, 0]);
  plate("back", [width, height, thickness], [
    0,
    height / 2,
    -depth / 2 + thickness / 2,
  ]);

  const rib = new THREE.Shape();
  rib.moveTo(0, 0);
  rib.lineTo(depth - thickness * 2, 0);
  rib.lineTo(0, height - thickness * 2);
  rib.closePath();
  for (const x of [-width / 2 + 0.45, width / 2 - 0.45]) {
    const mesh = new THREE.Mesh(
      new THREE.ExtrudeGeometry(rib, {
        depth: thickness,
        bevelEnabled: false,
      }),
      material,
    );
    mesh.name = x < 0 ? "left_rib" : "right_rib";
    mesh.rotation.y = -Math.PI / 2;
    mesh.position.set(x + thickness / 2, thickness, -depth / 2 + thickness);
    model.add(mesh);
  }
  return model;
}
