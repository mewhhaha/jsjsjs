import * as THREE from "three";

// Portrait-only art direction; geometry and the shared character stay reusable.
export async function applyPortraitMaterials(model: THREE.Object3D) {
  const loader = new THREE.TextureLoader();
  const [clothColor, clothNormal, eyesColor] = await Promise.all([
    loader.loadAsync("/assets/female-portrait/clothing-albedo.png"),
    loader.loadAsync("/assets/female-portrait/clothing-normal.png"),
    loader.loadAsync("/assets/female-portrait/eyes-albedo.png"),
  ]);
  clothColor.colorSpace = THREE.SRGBColorSpace;
  eyesColor.colorSpace = THREE.SRGBColorSpace;
  for (const texture of [clothColor, clothNormal, eyesColor]) {
    // Match the existing glTF UVs, including the sideways garment islands.
    texture.flipY = false;
    texture.anisotropy = 8;
  }
  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    for (const material of materials) {
      if (!(material instanceof THREE.MeshStandardMaterial)) continue;
      if (material.name === "Lowpoly_female_casualsuit01") {
        material.map = clothColor;
        material.normalMap = clothNormal;
        material.normalScale.set(.55, .55);
        material.roughness = .92;
      } else if (material.name === "Lowpoly_body") {
        // Preserve the UV-aligned Freckles albedo and geometric normal bake.
        material.color.setRGB(.80, .87, .92);
        material.normalScale.set(.52, .52);
        material.roughness = .9;
      } else if (material.name === "Lowpoly_low-poly") {
        material.map = eyesColor;
        material.roughness = .19;
      } else if (/hair|long01/i.test(material.name)) {
        material.color.setRGB(.38, .32, .28);
        material.roughness = .83;
      }
      for (
        const texture of [
          material.map,
          material.normalMap,
          material.roughnessMap,
        ]
      ) {
        if (texture) texture.anisotropy = 8;
      }
      material.needsUpdate = true;
    }
  });
}
