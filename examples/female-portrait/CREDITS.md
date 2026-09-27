# Female portrait variant

The portrait uses the existing adult MakeHuman body, clothes, skin, eyebrows and
lashes, with a new static pose and separate reduced flowing hair. See the
[base asset credits](../female/CREDITS.md) for authors and CC0 sources.

The body and clothing retain 3,030 triangles. Portrait hair has 1,799 triangles,
for **4,829 triangles total**, with the original 53 body and 31 hair joints. The
original female and flowing-hair entry points keep their defaults.

`clothing-albedo.png`, `clothing-normal.png`, and `eyes-albedo.png` were
generated with GPT Image from the corresponding CC0 MakeHuman UV atlases in
September 2026. They are 1,254 × 1,254 pixels. The clothing map removes the
stock graphic and adds worn mustard fabric, seams, folds and charcoal denim. The
normal atlas is generated OpenGL tangent-space detail, not a scan or a high-poly
bake. Its strength is kept moderate in `female-portrait-materials.ts`.

Skin keeps Margaret Toigo's Freckles albedo and the existing
geometric/procedural normal and roughness bakes. The portrait adjusts its tint
and normal strength. Hair keeps the original `long01` alpha texture with a
darker material tint. These are photographic-style game materials, not measured
scanned surfaces.

```sh
just open examples/female-portrait.ts
just screenshot examples/female-portrait.ts output/female-portrait.png --width 1000 --height 1200
just export examples/female-portrait.ts output/female-portrait.glb
blender -b --factory-startup --python-exit-code 1 --python scripts/prepare-portrait-hair.py
```

The GLB contains the posed skeleton, reduced hair and embedded texture maps.
Preview lighting, background and camera are viewer settings and are not
exported.
