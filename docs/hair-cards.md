# Textured hair cards

`hairCards(guides, options)` creates a batched mesh of curved, alpha-masked hair
cards. Use cards for layered human hairstyles or other dense fibers when a mesh
per strand would be too expensive. Use `strands()` for individual flyaways or
when every fiber must remain a native editable Blender curve.

```ts
import { type HairCardGuide, hairCards } from "js3";

const guides: HairCardGuide[] = [{
  points: [[0, 1, 0], [.1, .8, .02], [.12, .5, .02], [.2, .2, 0]],
  width: [.06, .08, .06, .02],
  normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1], [0, 0, 1]],
}];
export default () =>
  hairCards(guides, {
    color: "#362018",
    tipColor: "#715036",
    seed: 42,
    roughness: .53,
    density: 1,
    camber: .14,
  });
```

`width` is the **full width** of a card, either one number or a number for every
point. `normals`, when supplied, specify outward-facing directions at each
point; the helper projects them perpendicular to the guide's tangent. Supply
them for predictable card orientation, particularly for hair hanging below a
head.

`arcT` optionally supplies one strictly increasing coordinate in `[0,1]` per
point. These coordinates control the atlas's root-to-tip position and color
gradient. Preserve them when simplifying a baked guide so its texture stays
attached to the same part of the original curve. The groom LOD helpers do this
automatically. Omit `arcT` to use the current guide's normalized arc length;
partial ranges such as `[0.2, 0.4, 0.7]` can represent a trimmed section.

`camber` rounds the cross-section, giving a lock softer highlights than a flat
ribbon. It ranges from 0 to 0.5 and defaults to 0. The centerline remains the
ridge; both edges bend inward by `camber * width`. Allow that depth when placing
cards over the scalp. Values around 0.1–0.18 work well for dense head hair.
`widthSegments` sets 1–8 subdivisions across the card. It defaults to 4 when
camber is enabled and 1 otherwise; nonzero camber requires at least 2. Smooth
normals and tangents follow the rounded cross-section and the guide's curve.
Four subdivisions use four times as many triangles as a flat card, so use this
for visible layers and keep buried coverage simple.

Layer cards in several depths, vary roots and lengths, and keep some thin cards
around the silhouette. Several identical wide cards will still produce a flat or
regular result. A textured atlas does not author a hairstyle for you.

The helper creates a seeded eight-variant fiber atlas with alpha coverage and
normal detail. `textureSize` sets atlas width (a power of two from 128 to 1024;
height is twice the width). The default is 1024 × 2048. `density` ranges from
0.1 to 2; it controls fibers inside the atlas, not the number of cards.
`colorVariation` changes per-card brightness. `guide.shade` and `guide.variant`
allow explicit control.

`rootFade` controls the fraction of arc length used to soften roots (default
0.015, range 0–0.2). Fibers complete their root fade at staggered distances to
avoid a shared seam. Keep it small on long cards so the hairline does not
recede, and bury overlapping roots beneath the previous layer. `rootFade: 0` is
useful for hidden coverage layers. Stagger guide endpoints as well: the atlas
softens individual fibers but cannot hide a shared geometric boundary. For depth
in a close-up preview, set
`model.userData.preview = { lighting: { shadows: true } }`. This enables a
fitted soft shadow map; use restrained key lighting and adequate fill for dense
grooms.

Cards use one double-sided physical material, alpha testing, depth writing, and
longitudinal anisotropy. Textures are embedded in GLB exports and preserved in
Blender. Alpha-to-coverage smooths the edges in the CLI's multisampled preview;
another engine's anti-aliasing and lighting can change their appearance.
