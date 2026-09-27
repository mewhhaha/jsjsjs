# Stock human foundation

The mesh, UV layout, skin weights, `game_engine` skeleton, and bundled
appearance assets come from **MakeHuman Community / MPFB**. These graphical
assets are released under **CC0 1.0**, included in [LICENSE.md](LICENSE.md).

- [MPFB source](https://github.com/makehumancommunity/mpfb2), revision
  `7fcc8df56f26776923e0a825f4551c3c3779befe`.
- [Official system asset pack and per-asset licenses](https://static.makehumancommunity.org/assets/assetpacks/makehuman_system_assets.html).
- [Downloaded pack](https://files2.makehumancommunity.org/asset_packs/makehuman_system_assets/makehuman_system_assets_cc0.zip).

Included stock assets: `middleage_caucasian_male` skin, `low-poly` eyes,
`eyebrow001`, `eyelashes01`, `teeth_base`, `short04` hair, `male_casualsuit01`
clothing, and `shoes01`. Stock clothing and footwear include normal maps; the
stock skin supplies diffuse color, without a skin normal map.

`base.glb` embeds meshes, textures, and the 53-bone deform rig. `source.blend`
contains the editable MakeHuman source with packed textures and its original
phenotype targets. `manifest.json` records the bone names and phenotype
settings. This stock foundation has 44,394 triangles before game-specific
retopology or LOD reduction. The GLB has no subdivision, no animation clips, and
at most four joint influences per vertex. Hidden body faces under clothing are
removed in the GLB; the complete body remains in the Blender source.

Rebuild with Blender and a checkout of the pinned MPFB source plus the unpacked
asset pack (only needed to regenerate the asset, not to run the TS viewer):

```sh
blender -b --factory-startup --python-exit-code 1 \
  --python scripts/prepare-stock-human.py -- \
  /path/to/mpfb2/src /path/to/unpacked-assets /tmp/mpfb-work examples/stock-human
```

MPFB's program code has a separate license; it is not bundled here. The
preparation script calls its API and exports its CC0 graphical assets.
