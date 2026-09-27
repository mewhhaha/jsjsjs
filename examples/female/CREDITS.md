# Adult female character and separate flowing hair

The body uses MakeHuman's **female1605** low-poly topology and the stock 53-bone
`game_engine` skeleton. Its adult female phenotype is set in
[`prepare-stock-human.py`](../../scripts/prepare-stock-human.py) and recorded in
the [source manifest](../female-source/manifest.json), including age `0.5`. The
body, clothing, eyes, brows, and lashes total **3,030 triangles**. Hair is
loaded separately.

The flowing hair uses MakeHuman's `long01` mesh and texture. It has **4,108
triangles** and a **31-bone** skeleton: `HairAnchor` fixes the scalp to the
head, and five six-bone chains deform the hanging hair. The chains are
`HairLeft`, `HairLeftBack`, `HairBack`, `HairRightBack`, and `HairRight`, with
bones `_01` through `_06` in each. The combined character has **7,138
triangles**.

The body, clothing, and hair assets come from the CC0
[MakeHuman system asset pack](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html).
Included assets are `female1605`, `young_caucasian_female`,
`female_casualsuit01`, `shoes05`, `low-poly` eyes, `eyebrow001`, `eyelashes01`,
and `long01`. The skin albedo is Margaret Toigo's **Freckles** variation, also
CC0, from the
[MakeHuman natural female skins pack](https://static.makehumancommunity.org/assets/assetpacks/skins01.html)
([original asset](http://www.makehumancommunity.org/node/1134)). The local
[CC0 license](../stock-human/LICENSE.md) and pinned
[MPFB source revision](../stock-human/CREDITS.md) are included.

The Freckles albedo adds freckles and color variation. It is a variation of a
MakeHuman skin, not a photographic scan. Skin and clothing have 2K baked normal
and procedural roughness maps; footwear maps are 1K. The skin normal comes from
geometry and procedural microrelief, not a matched scanned normal. The hair
texture comes from the stock `long01` asset. These are game materials, not
measured skin or strand-scattering data.

## Use and export

```sh
just open examples/female.ts
just open examples/female-hair-preview.ts
just export examples/female.ts output/female.glb
just export examples/female-body.ts output/female-body.glb
just export examples/flowing-hair.ts output/flowing-hair.glb
```

`female.ts` loads the body and hair as separate GLBs. Set `showHair = false`,
call `buildModel({ hair: false })`, or use `female-body.ts` to omit hair. Edit
`pose` for body joints and `hairPose` for static hair joint rotations.

The hair GLB uses the same rest-world coordinates as the body. On load,
`head.attach(HairAnchor)` preserves that alignment and makes the hair follow the
head. The hair mesh stays a scene root, with its own skeleton and material, so
skinning remains portable in GLB exports. When swapping to a different body or
head shape, refit the asset; this alignment depends on the current body.

[`physics.json`](../female-flowing-hair/physics.json) records the five bone
chains and their rest lengths in meters. The scalp is weighted to the anchor;
the hanging vertices are weighted across the chains. A hair solver can drive
local chain rotations. **No physics solver, collision response, or animated
simulation is included.** The viewer stays static until a pose changes.

The full MakeHuman source, reduced body source, and hair source are saved as
`.blend` files with packed textures.

## Rebuild

Using the MPFB checkout and unpacked system assets described in the stock
credits, plus the Freckles albedo from the skins pack:

```sh
# Full base used to fit the flowing hair.
blender -b --factory-startup --python-exit-code 1 --python scripts/prepare-stock-human.py -- \
  /path/to/mpfb2/src /path/to/system-assets /tmp/mpfb-work examples/female-source female none
# Purpose-built low-poly topology for the body.
blender -b --factory-startup --python-exit-code 1 --python scripts/prepare-stock-human.py -- \
  /path/to/mpfb2/src /path/to/system-assets /tmp/mpfb-work examples/female-proxy-source female none female1605
blender -b --factory-startup --python-exit-code 1 --python scripts/bake-lowpoly-human.py -- \
  examples/female-proxy-source/base.glb examples/female examples/female/skin-albedo.png
blender -b --factory-startup --python-exit-code 1 --python scripts/prepare-flowing-hair.py -- \
  /path/to/mpfb2/src /path/to/system-assets examples/female-source/source.blend examples/female-flowing-hair
```
