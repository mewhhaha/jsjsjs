# Human bust for wig fitting

This bust is derived from the bundled MakeHuman Community / MPFB adult female
source in `examples/female-source/source.blend`. The anatomical mesh, eyes,
eyebrow and lash cards, and jacket geometry are **CC0 1.0** graphical assets.
See [the stock credits](../../stock-human/CREDITS.md) and
[the included CC0 license](../../stock-human/LICENSE.md).

The skin uses Margaret Toigo's **Freckles** albedo, CC0, already bundled at
`examples/female/skin-albedo.png`. See
[the female credits](../../female/CREDITS.md) for its source. The iris atlas is
the existing generated adaptation of the CC0 stock eye texture described in
[the portrait credits](../../female-portrait/CREDITS.md).

The bust preserves the source's facial topology, UVs, eyelids, lips, nostrils,
ears and neck. It is cropped at the shoulders, smoothed with subdivision and
fitted to the wigs' Y-up, +Z-forward coordinates. The crown is near Y = 1.4 and
the base at Y = -0.62. Lower shoulders taper to the portrait stand footprint. It
is a static look-development asset, without a facial rig or expression
blendshapes. `head.glb` embeds the required textures; `head.blend` retains the
derived mesh and materials. No MakeHuman Python code is bundled here.

`scalp.json` stores radial intersections with the actual subdivided head. The
shared wig helpers use this surface to place roots on the fuller human forehead
and occiput instead of on a generic ellipsoid.

Regenerate from the existing repository assets, entirely in background mode:

```sh
blender -b --factory-startup --python-exit-code 1 \
  --python scripts/prepare-haircut-head.py
```
