import {
  basin,
  beamBetween,
  bottle,
  bowl,
  box,
  bracket,
  canopy,
  cone,
  cup,
  dome,
  doorframe,
  elbow,
  fence,
  flange,
  frame,
  funnel,
  grille,
  group,
  gusset,
  gutter,
  handrail,
  hemisphere,
  hose,
  knob,
  louvers,
  material,
  molding,
  pedestal,
  pictureFrame,
  pipe,
  planter,
  railing,
  recessedPanel,
  shelving,
  sweepProfile,
  tank,
  THREE,
  tray,
  urn,
  vase,
  windowFrame,
} from "js3";

/** Every new helper, normalized to fit one display tile. Tiles read left to right.
 * Object names and userData.helper identify each shape in inspect/GLB/Blender.
 * Blue: vessels and shells; orange: paths; green: frames/supports; lilac: assemblies.
 */
export default function buildModel() {
  const ceramic = material({
    name: "blue ceramic",
    color: "#58a8b9",
    roughness: 0.35,
  });
  const copper = material({
    name: "copper",
    color: "#d99457",
    roughness: 0.48,
    metalness: 0.25,
  });
  const green = material({ name: "sage", color: "#90b68b", roughness: 0.65 });
  const lilac = material({ name: "lilac", color: "#a99acd", roughness: 0.65 });
  const base = material({
    name: "display bases",
    color: "#353d47",
    roughness: 0.9,
  });
  const entries: [string, THREE.Object3D][] = [
    [
      "basin round",
      basin({
        material: ceramic,
        rimWidth: 0.07,
        rimHeight: 0.04,
        drainRadius: 0.06,
      }),
    ],
    [
      "basin rectangular",
      basin({
        material: ceramic,
        shape: "rectangular",
        width: 1.4,
        depth: 1,
        cornerRadius: 0.18,
        taper: 0.1,
      }),
    ],
    ["bowl", bowl({ material: ceramic })],
    ["tray", tray({ material: ceramic })],
    ["cup", cup({ material: ceramic })],
    ["planter", planter({ material: ceramic })],
    ["tank", tank({ material: ceramic })],
    ["vase", vase({ material: ceramic })],
    ["bottle", bottle({ material: ceramic })],
    ["urn", urn({ material: ceramic })],
    ["pedestal", pedestal({ material: ceramic })],
    ["knob", knob({ material: ceramic })],
    ["dome", dome({ material: ceramic })],
    ["hemisphere", hemisphere({ material: ceramic })],
    ["cone", cone({ material: ceramic })],
    ["funnel", funnel({ material: ceramic })],
    ["canopy", canopy({ material: ceramic })],
    [
      "pipe",
      pipe({ material: copper, radius: 0.3, length: 1.2, wallThickness: 0.05 }),
    ],
    [
      "elbow",
      elbow({
        material: copper,
        radius: 0.14,
        wallThickness: 0.035,
        bendRadius: 0.5,
      }),
    ],
    [
      "hose",
      hose([[0, 0, 0], [0.1, 0.6, 0], [0.8, 1, 0.2], [1, 0.7, 0.4]], {
        material: copper,
      }),
    ],
    [
      "gutter",
      gutter({
        material: copper,
        width: 0.6,
        height: 0.35,
        rotation: [0, 90, 0],
      }),
    ],
    [
      "handrail",
      handrail([[0, 0, 0], [0.2, 0.6, 0], [1.4, 1.1, 0]], { material: copper }),
    ],
    [
      "molding",
      molding(
        [[0, 0], [0.2, 0], [0.2, 0.07], [0.12, 0.07], [0.12, 0.16], [0, 0.2]],
        [[0, 0, 0], [0, 1.3, 0]],
        { material: copper },
      ),
    ],
    [
      "sweepProfile",
      sweepProfile([[-0.2, -0.2], [0.2, -0.2], [0.2, 0.2], [-0.2, 0.2]], [
        [0, 0, 0],
        [0, 0.7, 0],
        [0.6, 1.1, 0.2],
      ], { material: copper }),
    ],
    ["frame", frame({ material: green })],
    ["doorframe", doorframe({ material: green })],
    ["windowFrame", windowFrame({ material: green, mullions: 1, transoms: 1 })],
    ["pictureFrame", pictureFrame({ material: green, backing: true })],
    [
      "recessedPanel",
      recessedPanel({
        material: green,
        depth: 0.25,
        recess: 0.15,
        panelThickness: 0.05,
      }),
    ],
    [
      "beamBetween",
      beamBetween([-0.5, 0, 0], [0.5, 1.2, 0], {
        material: green,
        width: 0.25,
        depth: 0.25,
      }),
    ],
    ["bracket", bracket({ material: green })],
    ["flange", flange({ material: green })],
    ["gusset", gusset({ material: green })],
    ["railing", railing({ material: lilac })],
    ["fence", fence({ material: lilac, topProfile: "pointed" })],
    ["grille", grille({ material: lilac })],
    ["louvers", louvers({ material: lilac })],
    ["shelving", shelving({ material: lilac })],
  ];
  const columns = 7, spacing = 2.8;
  const rows = Math.ceil(entries.length / columns);
  const tiles = entries.map(([name, object], index) => {
    object.name = name;
    object.userData.helper = name;
    object.updateMatrixWorld(true);
    const initial = new THREE.Box3().setFromObject(object, true);
    const extent = initial.getSize(new THREE.Vector3());
    const factor = 1.9 / Math.max(extent.x, extent.y, extent.z);
    const holder = group([object], {
      name: `${String(index + 1).padStart(2, "0")} ${name}`,
      scale: factor,
    });
    holder.updateMatrixWorld(true);
    const normalized = new THREE.Box3().setFromObject(holder, true);
    const center = normalized.getCenter(new THREE.Vector3());
    holder.position.set(-center.x, 0.13 - normalized.min.y, -center.z);
    return group([
      box([2.45, 0.12, 2.45], {
        name: "display tile",
        position: [0, 0.06, 0],
        material: base,
      }),
      holder,
    ], {
      name: `tile ${index + 1}: ${name}`,
      position: [
        (index % columns - (columns - 1) / 2) * spacing,
        0,
        (Math.floor(index / columns) - (rows - 1) / 2) * spacing,
      ],
    });
  });
  return group(tiles, {
    name: "shape helper gallery",
    preview: {
      grid: false,
      background: "#18212b",
      direction: [0.8, 1.65, 1.8],
      padding: 1.08,
    },
  });
}
