# Low-poly human

Derived from the local [MakeHuman stock foundation](../stock-human/CREDITS.md).
The original mesh, rig, clothing textures, clothing normals, and hair cards are
MakeHuman Community CC0 assets. Their license is included at
[../stock-human/LICENSE.md](../stock-human/LICENSE.md).

The replacement **Aksel skin** diffuse and normal maps are by **Mindfront**,
distributed as CC0 in the official
[MakeHuman skins02 pack](https://static.makehumancommunity.org/assets/assetpacks/skins02.html).
The original filenames are `Aksel_Skin_diffuse.png` and `Aksel_Skin_NRM.png`,
stored here as `skin-albedo.png` and `skin-source-normal.png`.

The preparation script reduces geometry while preserving the existing UVs and
53-bone skinning. Facial boundary edges and the stock hair/eyelash/eyebrow cards
are retained. `manifest.json` records the actual triangle counts by part.

Skin, shirt/jeans and shoes have baked tangent-space normal maps: source surface
curvature, the Aksel skin and existing clothing normal details, and subtle
procedural microrelief. Roughness maps are generated from procedural variation.
These are not scanned displacement or measured roughness maps. Clothing albedo
maps remain unchanged. This is a textured game-character derivative, not a
photogrammetry scan.

Body and clothing normal/roughness maps are 2048×2048; footwear maps are
1024×1024. `character.glb` embeds the materials, textures and deform rig.
`source.blend` contains the reduced meshes with packed textures. Keep the stock
source to make other LODs; this version has no IK controllers or animation
clips.

Rebuild in the repository root:

```sh
blender -b --factory-startup --python-exit-code 1 \
  --python scripts/bake-lowpoly-human.py -- \
  examples/stock-human/base.glb examples/lowpoly-human
```

The TS entry point controls pose and optional wireframe display. The portrait
entry point uses the same complete asset with different camera framing. No
runtime Blender installation or network connection is needed by the viewer.
