# Strands, cards, and sculpted locks

The prelude has three kinds of direct fiber builders. Each returns ordinary,
exportable meshes:

- **Procedural strands**: `fur()`, `grass()`, and `hair()` sample seeded roots
  on a surface, groom tapered centerlines, and batch them into tube or ribbon
  meshes. `sampleRoots()`, `groom()`, and `strands()` expose the three stages.
- **Hair cards**: `hairCards()` builds curved, alpha-masked cards along authored
  guides, with a generated fiber atlas.
- **Sculpted locks**: `hairLock()` builds closed, tapered locks for stylized and
  cartoon hair.

For one persistent source shared by strands, baked cards, detail levels, and
preview volume shadows, use the [editable groom pipeline](grooms.md) instead.
`js3 types` includes every option type below with inline documentation.

## Procedural strands

These builders create a deterministic procedural groom: real strands with
tapered widths. They do not run particle dynamics, dynamic collisions, or a
cloth simulation.

Save this as `output/fur.ts` and build it:

```ts
import { fur, group, material, sphere } from "js3";

export default function () {
  const body = sphere(0.5, {
    material: material({ color: "#775941", roughness: 0.9 }),
  });
  const coat = fur(body, {
    roots: { count: 12000, seed: 21 },
    groom: { length: 0.06, radius: 0.003, segments: 8 },
    render: { color: "#775941", tipColor: "#bb9970" },
  });
  return group([body, coat]);
}
```

```sh
js3 build output/fur.ts output/fur --software
js3 export output/fur.ts output/fur.blend --software --timeout 120000
```

The emitter is not automatically added to the returned group. Keep it visible
under fur to avoid gaps; for plants you can use a separate ground mesh.

### Coordinates and emitter surfaces

Pass a `THREE.Mesh` or `THREE.BufferGeometry`. Root sampling respects a mesh's
world transform, including transforms of its ancestors. A raw geometry is
sampled in its own coordinates. The result contains those sampled coordinates,
so do not apply the emitter's transform a second time to the coat. Move the
emitter and coat together by grouping them after sampling.

Roots are distributed by triangle area, and interpolated surface normals
determine the initial growth direction. Use outward-facing normals for fur. A
horizontal `PlaneGeometry` needs a rotation of `-Math.PI / 2` around X to grow
upward in this Y-up prelude:

```ts
import { grass, group, THREE } from "js3";

export default function () {
  const soil = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  soil.rotation.x = -Math.PI / 2;
  const blades = grass(soil, {
    roots: { count: 2000, seed: 7 },
    groom: { length: 0.3, radius: 0.01 },
    render: { ribbonPlanes: 2, color: "#37602b", tipColor: "#99b753" },
  });
  return group([soil, blades]);
}
```

Emitters must be static. Skinned, instanced, and morphing meshes and custom draw
ranges are rejected; bake them before sampling.

### Presets

All presets accept the same nested options as `hair(surface, options)`:

- `roots` controls where strands grow and how many roots are sampled.
- `groom` controls the strand centerlines, lengths, and widths.
- `render` controls geometry, material, color, and the returned group's
  transform.

Every preset value can be overridden. Lengths and widths use your scene's units;
these defaults assume an object approximately one unit across.

| Preset  | Roots | Length | Root radius | Segments | Geometry         |
| ------- | ----: | -----: | ----------: | -------: | ---------------- |
| `fur`   | 12000 |  0.065 |       0.003 |        8 | Four-sided tubes |
| `grass` |  1200 |   0.35 |       0.012 |        8 | Crossed ribbons  |

Use shorter, thinner strands for fur on smaller objects. Use the same seed to
reproduce a groom. Raising the count makes a denser coat; raising the segments
makes each strand's curvature smoother. Neither is a substitute for the other.

### Density masks and guide curves

A density callback is an acceptance probability from zero to one. It can use
each candidate's world-space position, normal, UV coordinates, and face index.
For example, keep moss on the upper side of a rock:

```ts
const moss = fur(rock, {
  roots: {
    count: 1500,
    seed: 12,
    density: (root) => root.normal[1] > 0.2 ? 1 : 0,
  },
  groom: { length: 0.03, radius: 0.002 },
  render: { color: "#436a29", tipColor: "#8e9e48" },
});
```

`count` means the number of accepted roots. A mask redistributes those roots
into the allowed area; it does not reduce the requested number. An empty or
excessively restrictive mask throws when `maxAttempts` is exhausted. For painted
masks, `densityAttribute` reads a scalar geometry vertex attribute (or the first
component of a color attribute) and interpolates it across each triangle.

Guide curves shape a groom. Guide points use the same coordinates as the roots.
Their shape is sampled along its length and scaled to `groom.length`, then
placed at each root. `guideInfluences` (default 3) controls how many nearby
guides contribute. `clump` draws strand tips toward the nearest matching guide
tip while preserving root positions:

```ts
import { groom, sampleRoots, strands } from "js3";

const roots = sampleRoots(emitter, { count: 2000, seed: 14 });
const data = groom(roots, {
  length: 0.4,
  lengthVariation: 0.3,
  radius: 0.008,
  tipRadius: 0,
  segments: 12,
  guides: [
    { points: [[-0.3, 0, 0], [-0.3, 0.2, 0], [-0.1, 0.4, 0.1]] },
    { points: [[0.3, 0, 0], [0.32, 0.2, 0], [0.5, 0.4, 0.1]] },
  ],
  guideInfluences: 2,
  clump: 0.15,
  frizz: { amplitude: 0.003, frequency: 3 },
  seed: 14,
});
const blades = strands(data, {
  mode: "ribbons",
  ribbonPlanes: 2,
  color: "#37602b",
  tipColor: "#99b753",
});
```

Keep `roots` and re-run `groom()` to change shape without shifting their
placement. Set `roots.region` to a callback that returns a label, and give
guides matching `region` labels, to keep separate tufts or groom sections
independent. Unlabelled roots use unlabelled guides.

Additional grooming controls:

- `direction` adds a world-space comb bias to surface normals, weighted by
  `normalInfluence`.
- `bend` is a world-space tip displacement that increases quadratically along a
  strand. It can suggest wind without moving roots.
- `curl: { radius, turns }` makes curls around the groomed centerline.
- `frizz: { amplitude, frequency }` adds small irregularities.
- `flyaways: { fraction, amplitude }` gives a fraction of the strands larger
  departures from the groom.
- `colliders: [{ center, radii }]` provides static ellipsoid clearance for the
  sampled centerline points. Roots stay fixed. It does not guarantee clearance
  of the segments between samples or the strand radius, and overlapping
  colliders may conflict. It is not dynamic collision against arbitrary triangle
  meshes.

Root sampling and grooming have separate seeds, both defaulting to 1. `hair()`
and the presets reuse `roots.seed` for grooming unless `groom.seed` is set.
`tipRadius` and `taper` control the width profile; zero tip radius produces
pointed ends.

### Rendering and performance

Tubes keep a volume from every direction and work well for close fur or rushes.
Ribbons use fewer vertices and are useful for grass and distant strands.
`ribbonPlanes: 2` crosses two ribbons along the same strand so a blade remains
visible from more viewing directions. This is fixed mesh geometry, not a
camera-facing billboard.

Strands are batched into meshes rather than thousands of separate objects.
Geometry cost still increases with root count, curve segments, and tube sides
(`radialSegments`, 3–12) or ribbon planes (1–3). Start with a few hundred roots
while grooming, then increase the count for a final capture. Each call supports
at most 20,000 roots, 1,024 guides, two million groom points, and two million
mesh vertices. Larger coats can use several separately groomed regions. Keep a
close camera for checking taper, bends, and root placement before judging an
entire patch.

`color` and `tipColor` create a root-to-tip gradient, and `colorVariation`
varies individual strand brightness. You can provide a custom Three.js material
through `render.material`; enable its `vertexColors` to keep the gradient.
`hairMaterial()` supplies a strand-aligned anisotropic PBR material; this
browser approximation is not a full multiple-scattering hair shader.

### Blender export

GLB and OBJ contain the static strand meshes. `.blend` export also preserves
strand centerlines for native curve editing. Tube systems render as native Hair
Curves with a Principled Hair shader in Cycles, with the original polygon
preview retained but hidden. Ribbon systems keep their polygon blades visible
and retain hidden editable centerlines, so their flat shape is preserved. Guides
are hidden editable curves. Root/tip colors, shade variation, radii, and
transforms are preserved; arbitrary custom shader graphs are not translated into
native hair shading. Native strand export needs a Blender version whose Hair
Curves support `add_curves`. These exported curves have no automatic scalp
binding or dynamics.

## Hair cards

`hairCards(guides, options)` creates a batched mesh of curved, alpha-masked hair
cards. Use cards for layered hairstyles or other dense fibers when a mesh per
strand would be too expensive. Use `strands()` for individual flyaways or when
every fiber must remain a native editable Blender curve.

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

`points` run from root to tip. `width` is the **full width** of a card, either
one number or a number for every point. `normals`, when supplied, specify
outward-facing directions at each point; the helper projects them perpendicular
to the guide's tangent. Supply them for predictable card orientation,
particularly for hair hanging below a head.

`arcT` optionally supplies one strictly increasing coordinate in `[0,1]` per
point. These coordinates control the atlas's root-to-tip position and color
gradient. Preserve them when simplifying a baked guide so its texture stays
attached to the same part of the original curve. The groom LOD helpers do this
automatically. Omit `arcT` to use the current guide's normalized arc length;
partial ranges such as `[0.2, 0.4, 0.7]` can represent a trimmed section.

`camber` rounds the cross-section, giving a lock softer highlights than a flat
ribbon. It ranges from 0 to 0.5 and defaults to 0. The centerline remains the
ridge; both edges bend inward by `camber * width`. Allow that depth when placing
cards over a surface. Values around 0.1–0.18 work well for dense head hair.
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
in a close-up preview, set `lighting: { shadows: true }` in the model's
[preview settings](agent-guide.md#preview-settings), with restrained key
lighting and adequate fill for dense hair.

Cards use one double-sided physical material with an alpha cutoff of 0.3, depth
writing, and longitudinal anisotropy. Alpha-to-coverage smooths the edges in the
CLI's multisampled preview; another engine's anti-aliasing and lighting can
change their appearance. GLB embeds the alpha and normal textures, card
geometry, colors, and anisotropy. Blender export keeps cards as textured meshes:
the fibers painted into a card's texture are not individually editable curves.
Dense card and strand hair adds up quickly; `js3 inspect` reports exact geometry
counts for budgeting.

## Sculpted locks

`hairLock(path, options)` builds a closed, flattened lock along a curved path.
Broad overlapping locks are useful for quiffs, bobs, swept fringes, and pointed
cartoon silhouettes. Each lock is a normal mesh with an exportable material.

```ts
import { group, hairLock } from "js3";

export default () =>
  group([
    hairLock([[0, 1, 0], [.15, 1.15, .1], [.4, .9, .2]], {
      name: "swept-fringe",
      width: .24,
      thickness: .06,
      widthProfile: [.6, 1, .85, 0],
      normal: [0, 0, 1],
      twist: 15,
      ridge: .3,
      color: "#66351f",
      tipColor: "#96572d",
      roughness: .55,
    }),
  ]);
```

The path takes 2–256 points and is interpolated as a smooth curve. The width
profile is sampled from root to tip at uniform spacing. Width and thickness use
scene units; twist uses degrees. `normal` sets the outward-facing frame;
`normals` can supply one frame direction per path point, which helps on a curved
scalp. `ridge` (−0.7 to 0.7) biases the upper ridge toward one edge. `segments`
and `crossSegments` control tessellation. Pass `material` to share a material
across locks; enable its `vertexColors` to retain the generated root-to-tip
color gradient.

Overlapping locks can pick up blotchy self-shadowing from the preview's coarse
shadow maps. Set `mesh.userData.previewShadows = { cast: true, receive: false }`
on such locks so they still shade what is beneath them. This only changes the
viewer; exported meshes remain normal geometry, and a target renderer computes
its own shadows.
