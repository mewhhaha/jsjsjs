/** One layered coat source, rendered through the same guide/card/strand pipeline. */
import {
  buildGroom,
  createGroom,
  type GroomGuide,
  group,
  material,
  sphere,
  THREE,
} from "js3";

export function buildFurGroom() {
  const guides: GroomGuide[] = [];
  const count = 960;
  for (let i = 0; i < count; i++) {
    const y = 1 - (i + .5) / count * 2;
    const angle = i * Math.PI * (3 - Math.sqrt(5));
    const rootNormal = new THREE.Vector3(
      Math.sqrt(1 - y * y) * Math.cos(angle),
      y,
      Math.sqrt(1 - y * y) * Math.sin(angle),
    );
    const root = rootNormal.clone().multiplyScalar(.5);
    const side = new THREE.Vector3(0, 1, 0).cross(rootNormal).normalize();
    const comb = new THREE.Vector3(0, -1, 0)
      .addScaledVector(rootNormal, rootNormal.y).normalize()
      .applyAxisAngle(rootNormal, .35 * Math.sin(i * 2.37));
    for (const layer of ["undercoat", "guard"] as const) {
      const length = layer === "guard" ? .15 : .08;
      const lift = layer === "guard" ? .75 : .42;
      const points: [number, number, number][] = [];
      const normals: [number, number, number][] = [];
      for (let j = 0; j <= 12; j++) {
        const t = j / 12;
        points.push(
          root.clone().addScaledVector(rootNormal, length * lift * t)
            .addScaledVector(comb, length * Math.sqrt(1 - lift * lift) * t)
            .addScaledVector(side, .01 * Math.sin(i) * t * t)
            .add(new THREE.Vector3(0, -.018 * t * t, 0)).toArray(),
        );
        normals.push(rootNormal.toArray());
      }
      guides.push({
        id: `${layer}-${i}`,
        layer,
        region: y > 0 ? "upper" : "lower",
        points,
        normals,
        width: layer === "guard" ? .035 : .062,
      });
    }
  }
  return createGroom({
    version: 1,
    seed: 901,
    name: "layered-fur",
    guides,
    layers: [
      {
        id: "undercoat",
        kind: "undercoat",
        children: 32,
        radius: .0014,
        clump: .18,
        frizz: .002,
        lengthVariation: .2,
        color: "#756049",
        tipColor: "#bca07a",
        roughness: .65,
      },
      {
        id: "guard",
        kind: "guard",
        children: 8,
        radius: .00085,
        clump: .65,
        frizz: .001,
        lengthVariation: .27,
        color: "#30271e",
        tipColor: "#d7bb8d",
        roughness: .4,
      },
    ],
  });
}

export default () =>
  group([
    sphere(.5, { material: material({ color: "#66513c", roughness: .9 }) }),
    buildGroom(buildFurGroom(), {
      representation: "hybrid",
      lod: "high",
      atlas: { textureSize: 1024 },
    }),
  ], {
    preview: {
      grid: false,
      background: "#252a30",
      direction: [1, .65, 1.5],
      padding: 1.04,
      lighting: { hemisphere: 1.6, key: 2.5, fill: .4, shadows: true },
    },
  });
