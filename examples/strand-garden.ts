/** Exportable grass blades, longer rushes, and soft moss share the same strand engine. */
import {
  fur,
  grass,
  group,
  material,
  roundedBox,
  sphere,
  type StrandGuide,
  THREE,
} from "js3";

export default function buildModel() {
  const turf = material({ color: "#3e4a25", roughness: 1 });
  const earth = material({ color: "#65513c", roughness: 1 });
  const emitter = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 1.7), turf);
  emitter.name = "upward meadow emitter";
  emitter.rotation.x = -Math.PI / 2;
  emitter.position.y = 0.16;
  const guides: StrandGuide[] = [];
  for (let x = -1; x <= 1; x += 0.4) {
    for (let z = -0.6; z <= 0.6; z += 0.4) {
      guides.push({
        points: [[x, 0.16, z], [x + 0.02, 0.38, z], [x + 0.1, 0.48, z + 0.03]],
      });
    }
  }
  const meadow = grass(emitter, {
    roots: { count: 2200, seed: 41 },
    groom: {
      length: 0.27,
      radius: 0.009,
      guides,
      clump: 0.18,
      bend: [0.025, 0, 0.015],
    },
    render: { color: "#35592a", tipColor: "#98b857", ribbonPlanes: 2 },
  });
  const rushSurface = new THREE.Mesh(new THREE.CircleGeometry(0.18, 24), turf);
  rushSurface.name = "rush emitter";
  rushSurface.rotation.x = -Math.PI / 2;
  rushSurface.position.set(-0.76, 0.17, -0.38);
  const rushes = grass(rushSurface, {
    roots: { count: 85, seed: 77 },
    groom: {
      length: 0.75,
      radius: 0.008,
      segments: 12,
      lengthVariation: 0.3,
      guides: [{
        points: [[-0.76, 0.17, -0.38], [-0.76, 0.6, -0.38], [
          -0.54,
          0.93,
          -0.32,
        ]],
      }],
      clump: 0.15,
    },
    render: {
      name: "tall rushes",
      mode: "tubes",
      radialSegments: 4,
      color: "#747943",
      tipColor: "#bac07b",
    },
  });
  const rock = sphere(0.3, {
    name: "mossy stone",
    position: [0.58, 0.27, 0.02],
    scale: [1.2, 0.62, 0.85],
    widthSegments: 16,
    heightSegments: 12,
    material: material({ color: "#6e7562", roughness: 1 }),
  });
  const moss = fur(rock, {
    roots: {
      count: 1500,
      seed: 33,
      density: (root) => root.normal[1] > 0.2 ? 1 : 0,
    },
    groom: { length: 0.032, radius: 0.002 },
    render: {
      name: "moss strands",
      color: "#436a29",
      tipColor: "#8e9e48",
    },
  });
  return group([
    roundedBox([2.6, 0.22, 1.9], 0.07, {
      name: "earth bed",
      position: [0, 0.04, 0],
      material: earth,
    }),
    emitter,
    rushSurface,
    meadow,
    rushes,
    rock,
    moss,
  ], {
    name: "strand garden",
    preview: {
      grid: false,
      background: "#d5d9ce",
      direction: [1.2, 0.85, 1.5],
      padding: 1.12,
      lighting: { hemisphere: 1.7, key: 3.5, fill: 1.1 },
    },
  });
}
