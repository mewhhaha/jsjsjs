/** Nine identical heads: one fitting reference and eight interchangeable game wigs. */
import { cylinder, group, material, roundedBox, THREE } from "js3";
import { buildHaircut, HAIRCUTS } from "./haircuts/catalog.ts";

function label(text: string): THREE.Mesh {
  const canvas = document.createElement("canvas");
  canvas.width = 768;
  canvas.height = 128;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#1e282b";
  context.fillRect(0, 0, 768, 128);
  context.fillStyle = "#d5cbb6";
  context.font = "500 38px sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, 384, 66);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.PlaneGeometry(1.53, .255),
    new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide }),
  );
  mesh.position.set(0, -.545, 1.10);
  mesh.name = `label-${text}`;
  return mesh;
}

export async function haircutGallery(angle = -.12) {
  const pedestals = material({ color: "#253438", roughness: .72 });
  const rings = material({ color: "#9d8864", metalness: .65, roughness: .4 });
  const displays = await Promise.all(HAIRCUTS.map(async (entry, index) => {
    const bust = await buildHaircut(entry.id);
    // Turn every bust independently so profile reviews do not overlap the columns.
    bust.rotation.y = angle;
    const display = group([
      roundedBox([1.93, .17, 2.12], .055, {
        position: [0, -.70, 0],
        material: pedestals,
        name: "display base",
      }),
      cylinder(.51, .018, {
        position: [0, -.607, 0],
        material: rings,
        radialSegments: 48,
        name: "brass rim",
      }),
      bust,
      label(`${String(index).padStart(2, "0")}   ${entry.label}`),
    ], { name: entry.label });
    // A vertical portrait board keeps all nine silhouettes visible from the front.
    display.position.set(
      (index % 3 - 1) * 2.38,
      (2 - Math.floor(index / 3)) * 2.55,
      0,
    );
    return display;
  }));
  return group(displays, {
    name: "Human haircut collection",
    preview: {
      grid: false,
      background: "#131b21",
      direction: [0, .035, 1],
      target: [0, 2.92, -.1],
      radius: 4.1,
      padding: 1.03,
      exposure: 1.1,
      lighting: { hemisphere: 1.65, key: 3.2, fill: 1.65 },
    },
  });
}

export default function buildModel() {
  return haircutGallery();
}
