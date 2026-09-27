# Fur, grass, and groomed strands

For a persistent groom shared by strands, baked cards, and detail levels, use
`createGroom()` and `buildGroom()`. See [editable guide grooms](grooms.md). The
helpers below remain useful for small direct strand systems and grass.

The prelude builds strand systems in three stages: sample roots on a surface,
groom their centerlines, and turn those curves into exportable geometry. Use
`fur()` or `grass()` for a starting preset, `hair()` for a custom setup, or work
with the stages separately when you want to keep the same roots while changing a
groom.

This is a deterministic procedural groom. It creates actual strands with tapered
widths; it does not run particle dynamics, dynamic collisions, or a cloth
simulation.

## First examples

```sh
js3 build examples/strand-fur.ts output/strand-fur --software
js3 build examples/strand-garden.ts output/strand-garden --software
js3 export examples/strand-fur.ts output/strand-fur.blend --software
js3 types --force
```

`build` produces the usual model, preview, and inspection report. Both examples
use the same strand engine: the garden contains short grass, taller rushes, and
moss on a stone.

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

The emitter is not automatically added to the returned group. Keep it visible
under fur to avoid gaps; for plants you can use a separate ground mesh.

## Coordinates and emitter surfaces

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

## Presets

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

## Density masks and guide curves

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
placed at each root. `guideInfluences` controls how many nearby guides
contribute. `clump` draws strand tips toward the nearest matching guide tip
while preserving root positions:

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
placement. Set `roots.region` to return a label and give guides matching
`region` labels to keep separate tufts or groom sections independent. Unlabelled
roots use unlabelled guides.

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

Root sampling and grooming have separate seeds. Set both explicitly when
comparing different distributions or grooms. The presets use seed 1 by default.
`tipRadius` and `taper` control the width profile; zero tip radius produces
pointed ends.

## Rendering and performance

Tubes keep a volume from every direction and work well for close fur or rushes.
Ribbons use fewer vertices and are useful for grass and distant strands.
`ribbonPlanes: 2` crosses two ribbons along the same strand so a blade remains
visible from more viewing directions. This is fixed mesh geometry, not a
camera-facing billboard.

Strands are batched into meshes rather than thousands of separate objects.
Geometry cost still increases with root count, curve segments, and radial
segments (or ribbon planes). Start with a few hundred roots while grooming, then
increase the count for a final capture. Each call supports at most 20,000 roots,
1,024 guides, and two million groom points. Larger coats can use several
separately groomed regions. Static emitters are required; bake skinning,
morphing, instancing, and custom draw ranges before sampling. Keep a close
camera for checking taper, bends, and root placement before judging an entire
patch.

`color` and `tipColor` create a root-to-tip gradient, and `colorVariation`
varies individual strand colors. You can provide a custom Three.js material
through `render.material`. Exported GLB and OBJ contain static strand geometry.
For custom vertex-colored materials, enable `vertexColors` to retain those
gradients. `hairMaterial()` supplies a strand-aligned anisotropic PBR material;
this browser approximation is not a full multiple-scattering hair shader.

Blender export also preserves strand centerlines for native curve editing. Tube
systems render as native Hair Curves with a Principled Hair shader in Cycles,
with the original polygon preview retained but hidden. Ribbon systems keep their
polygon blades visible and retain hidden editable centerlines, so their flat
shape is preserved. Guides are hidden editable curves. Root/tip colors, shade
variation, radii, and transforms are preserved; arbitrary custom shader graphs
are not translated into native hair shading. Native strand export requires the
`hair_curves.add_curves` API (verified with Blender 5.2). These exported curves
have no automatic scalp binding or dynamics.

Use `js3 types` for the complete option types and inline API documentation.

For dense human hair, `hairCards()` supplies layered textured cards with tapered
fiber coverage and directional highlights. Combine these with `strands()` for
individual loose hairs. See [the card guide](hair-cards.md) and
[the human haircut examples](haircuts.md).
