import {
  arch,
  box,
  column,
  gableRoof,
  group,
  material,
  ramp,
  stairs,
  wall,
} from "js3";

/** A small pavilion assembled from editable, named architectural parts. */
export default function buildModel() {
  const stone = material({
    name: "warm limestone",
    color: "#c8b38f",
    roughness: 0.85,
  });
  const roofPaint = material({
    name: "terracotta",
    color: "#9b4c36",
    roughness: 0.8,
  });
  const paving = material({
    name: "paving",
    color: "#847f6b",
    roughness: 0.95,
  });
  return group([
    box([10, 0.16, 7], {
      name: "ground",
      position: [1, -0.08, 0.6],
      material: paving,
    }),
    box([5, 1.2, 3], {
      name: "platform",
      position: [0, 0.6, 0],
      material: stone,
    }),
    stairs({
      name: "entrance steps",
      width: 2,
      steps: 6,
      rise: 0.2,
      run: 0.3,
      material: stone,
      position: [0, 0, 3.3],
      rotation: [0, 180, 0],
    }),
    ramp({
      name: "side ramp",
      width: 1.1,
      height: 1.2,
      length: 3,
      material: stone,
      position: [5.5, 0, 0],
      rotation: [0, -90, 0],
    }),
    arch({
      name: "entrance arch",
      openingWidth: 2,
      openingHeight: 2.5,
      thickness: 0.28,
      depth: 0.5,
      material: stone,
      position: [0, 1.2, 1.22],
    }),
    wall({
      name: "rear wall",
      width: 5,
      height: 2.78,
      depth: 0.25,
      opening: { width: 1.4, height: 1.1, bottom: 0.8 },
      material: stone,
      position: [0, 1.2, -1.25],
    }),
    ...[-2.1, 2.1].flatMap((x) =>
      [-1.1, 1.22].map((z) =>
        column({
          name: `column_${x}_${z}`,
          radius: 0.18,
          height: 2.78,
          material: stone,
          position: [x, 1.2, z],
        })
      )
    ),
    gableRoof({
      name: "roof",
      width: 5.7,
      depth: 3.6,
      rise: 1,
      thickness: 0.18,
      material: roofPaint,
      position: [0, 3.98, 0],
    }),
  ], {
    name: "pavilion",
    preview: { grid: false, background: "#242b2a", direction: [1.3, 0.9, 1.6] },
  });
}
