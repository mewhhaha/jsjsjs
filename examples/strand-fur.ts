/** A small furry creature. Each coat is sampled from the transformed skin surface. */
import { cylinder, fur, group, material, sphere } from "js3";

export default function buildModel() {
  const skin = material({ color: "#685342", roughness: 0.95 });
  const dark = material({ color: "#251b1a", roughness: 0.32 });
  const pink = material({ color: "#be8675", roughness: 0.8 });
  const body = sphere(0.5, {
    name: "body emitter",
    scale: [1.1, 0.94, 0.84],
    position: [0, 0.58, 0],
    material: skin,
    widthSegments: 48,
    heightSegments: 32,
  });
  const head = sphere(0.34, {
    name: "head emitter",
    scale: [1.05, 0.95, 0.86],
    position: [0, 0.92, 0.32],
    material: skin,
    widthSegments: 48,
    heightSegments: 32,
  });
  const ears = [-1, 1].map((side) =>
    sphere(0.16, {
      name: `ear ${side}`,
      position: [side * 0.27, 1.18, 0.23],
      scale: [0.63, 1.3, 0.65],
      rotation: [0, 0, side * -24],
      material: skin,
    })
  );
  const eyes = [-1, 1].map((side) =>
    sphere(0.041, {
      name: `eye ${side}`,
      position: [side * 0.125, 0.97, 0.6],
      scale: [1, 1.1, 0.72],
      material: dark,
    })
  );
  const paws = [-1, 1].map((side) =>
    sphere(0.13, {
      name: `paw ${side}`,
      position: [side * 0.27, 0.17, 0.27],
      scale: [1, 0.55, 1.5],
      material: skin,
    })
  );
  const coats = [body, head, ...ears].map((surface, i) =>
    fur(surface, {
      roots: {
        count: [16000, 10000, 1600, 1600][i],
        seed: 71 + i,
        density: ({ position: [x, y, z], normal }) => {
          if (normal[1] < -0.85) return 0;
          if (i === 1 && z > 0.55) {
            if (Math.hypot(Math.abs(x) - 0.125, y - 0.97) < 0.045) return 0;
            if (Math.hypot(x, y - 0.88) < 0.047) return 0;
          }
          return 1;
        },
      },
      groom: {
        length: i === 0 ? 0.065 : 0.04,
        lengthVariation: 0.28,
        normalInfluence: 0.75,
        direction: [0, -0.35, 0.12],
        bend: [0, -0.02, 0.005],
        radius: i === 0 ? 0.004 : 0.003,
        curl: { radius: 0.003, turns: 0.7 },
        flyaways: { fraction: 0.025, amplitude: 0.015 },
      },
      render: {
        name: `${surface.name} fur`,
        color: "#715b48",
        tipColor: "#9f8669",
        colorVariation: 0.16,
      },
    })
  );
  return group([
    cylinder(0.86, 0.1, {
      name: "display plinth",
      position: [0, 0.05, 0],
      radialSegments: 64,
      material: material({ color: "#c9bba8", roughness: 0.9 }),
    }),
    body,
    head,
    ...ears,
    ...paws,
    ...coats,
    ...eyes,
    sphere(0.042, {
      name: "nose",
      position: [0, 0.88, 0.628],
      scale: [1.2, 0.7, 0.7],
      material: pink,
    }),
  ], {
    name: "furry woodland creature",
    preview: {
      grid: false,
      background: "#e1d8ca",
      direction: [0.6, 0.3, 1],
      padding: 1.06,
      lighting: { hemisphere: 1.8, key: 3, fill: 1.2 },
    },
  });
}
