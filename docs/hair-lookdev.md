# Sculpted hair and repeatable visual review

The examples now include a swept realistic updo and two cartoon styles on the
same fitting head. Run these commands from the checkout:

```sh
js3 open examples/hair-bun.ts
js3 open examples/hair-cartoon.ts
js3 open examples/hair-cartoon-bob.ts
```

`open` intentionally opens a window. The build, screenshot, and review commands
below use headless processes. The installed `js3` command reads this checkout,
so new helpers are available without reinstalling it.

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

The width profile is sampled from root to tip. Width and thickness use scene
units; twist uses degrees. `normal` sets the outward-facing frame; `normals` can
supply one frame direction per path point. `ridge` biases the upper ridge toward
one edge. `segments` and `crossSegments` control tessellation. Pass `material`
to share a material across locks; enable its `vertexColors` to retain the
generated root-to-tip color gradient.

The cartoon examples cast shadows onto the face but disable receiving the
preview's coarse shadow maps on their overlapping locks. For individual meshes,
`mesh.userData.previewShadows = { cast: true, receive: false }` controls this
viewer behavior. Exported meshes remain normal geometry; a target renderer
computes its own shadows.

`examples/haircuts/cartoon.ts` exports `buildCartoonWig("quiff" | "bob")` for
detached wigs, and asynchronous `buildCartoonHaircut(style)` for the head and
wig together. Their fitting frame matches the other haircut examples: Y-up, face
toward +Z. The cartoon example simplifies the head's materials; the head
geometry remains the shared anatomical mesh.

```sh
js3 build examples/hair-cartoon.ts output/hair-cartoon-quiff --software
js3 build examples/hair-cartoon-bob.ts output/hair-cartoon-bob --software
js3 export examples/hair-cartoon.ts output/hair-cartoon-quiff/model.blend --software
js3 types --force
```

## Review views and lighting

The review script captures front, three-quarter, profile, and rear views under
studio, backlit, and grazing light. It uses one headless software browser,
writes a PNG for each combination, and records exact camera and light settings
with geometry counts in `review.json`.

```sh
deno run -A scripts/review-hair.ts examples/hair-bun.ts output/hair-bun/review
deno run -A scripts/review-hair.ts examples/hair-cartoon.ts output/hair-cartoon-quiff/review --presets studio --views front,profile,back
```

Optional `--width`, `--height`, and `--timeout` control image dimensions and
startup time. Use `--hair-shadows off` for a matched comparison against ordinary
mesh shadows, or `--hair-shadow-resolution 128` to raise the directional volume
map resolution from its default of 96. The accepted range is 16–192; the source
density resolution is a separate `compileGroom` option. `review.json` records
these settings. Use `--hair-ao 0` versus `--hair-ao 1` to compare ambient
occlusion while keeping direct shadows fixed. `--hair-ao-distance` sets its
world-space influence distance and `--hair-ao-resolution` sets its grid size
(16–96, default 64). Shared presets live in `scripts/hair-review-presets.json`
and frame this example head. Adjust those settings when reviewing a differently
scaled model. Stop editing the model during capture: a rebuild invalidates the
review rather than silently mixing revisions.

Look for continuous root coverage, intentional partings, hair following the
scalp into its gather, tapered tips, and a coherent silhouette at every angle.
Backlighting exposes broad opaque bands and gaps; grazing light exposes flat
cards and repeated clumps. Adding fibers alone does not fix poorly placed
guides.

## Full-strand Cycles reference

This separate reference tool generates every child fiber directly from the
editable groom. It does not turn the hybrid preview's small visible strand
subset into a purported full groom. Blender receives native Hair Curves,
per-layer Principled Hair materials, the optional head mesh, and the shared
camera and light directions.

```sh
js3 build examples/hair-bun.ts output/hair-bun --software --timeout 180000
deno run -A scripts/export-groom-reference.ts \
  --source output/hair-bun/grooms/001-wig-messy-bun/groom.json \
  --head examples/haircuts/assets/head.glb \
  --output output/hair-bun/cycles-reference \
  --preset studio --view all --resolution 800x1000 --samples 32
```

Use `--preset backlight` or `--preset grazing` with a separate output directory
for further comparisons. `--view` also accepts `front`, `three-quarter`,
`profile`, or `back`. `--help` lists camera, curve sampling, and device options.
Fiber density is always the complete source; `--segments` adjusts samples along
each fiber. Blender must be installed; `JS3_BLENDER` selects its executable. It
runs with `--background --factory-startup --disable-autoexec` and no display
connection on Linux.

Outputs include `reference.blend`, rendered PNGs, a settings/count report, and
the packed editable source. Sibling groom asset manifests supply attachment
transforms automatically. The optional head is imported in its own GLB frame; it
must already match the groom's world-space fitting frame.

Cycles path tracing, its hair material, and AgX color management differ from the
WebGL preview's lighting and ACES tone mapping. This is a geometry and
appearance reference, not a pixel-identical renderer test. It helps separate
problems in the authored groom from card coverage and preview shading.

## Source density and volume shadows

The updo's crown uses unequal asymmetric flow families and shorter overlapping
locks, with three separate turns into the gather. Its current source contains
3,044 guides and 65,976 fibers. Some long grooves and the bun's layered form
remain visible in the native reference.

The hairline grades from short, fine, lightly pigmented hairs into denser roots
farther inland. The fine hairs follow the fitted scalp and begin slightly below
its surface; longer hairs overlap them from inside the boundary. This gives the
temple and nape a softer transition while keeping the main hairstyle's coverage.
The same source controls the explicit fibers and their baked textures.

In the opaque multisampled preview, baked cards preserve fractional fiber
coverage instead of promoting faint texture samples to solid pixels. This keeps
fine roots and overlapping strands visible in the fade. Transparent imposter
captures and portable exports retain the cutout fallback described in the
[groom guide](grooms.md).

Guide grooms now compile a sparse density volume from every source fiber,
independently of the visible card/strand LOD. The viewer builds cumulative
optical-depth maps for its two directional lights and applies Beer–Lambert
attenuation to hair and other standard/physical materials receiving shadows.
Head and object shadows still come from ordinary shadow maps; groom cards no
longer contribute an additional opaque depth layer. This reduces the broad pale
transmission patches seen under strong backlighting.

Ambient lighting also uses the source density. A local visibility field limits
hemisphere/environment light reaching the roots and nearby scalp, with smooth
distance falloff to keep exposed skin lit. This is separate from coverage:
bright gaps need occlusion, while missing hair still needs an overlapping
interior layer. The updo's interior is fitted behind its fine perimeter rather
than substituting an opaque scalp cap.

Enable the feature with `preview.lighting.shadows: true`. It defaults on for
compiled grooms; `preview.lighting.hairShadows: false` restores ordinary mesh
shadows, and `compileGroom(source, { volume: false })` skips the density volume.
`preview.lighting.hairAmbientOcclusion` controls ambient occlusion separately: 1
is the default and 0 disables it. Disabling preview shadows disables both. The
[groom guide](grooms.md) covers resolution, memory, and custom-renderer use.

This is a fixed-grid approximation of direct extinction, with orientation
moments used to estimate projected fiber area. It does not simulate light
scattering repeatedly between fibers. Dense regions can therefore look darker
than the Cycles reference. Finite grid resolution and sampling at card surfaces
also limit how closely it matches individual fibers. Runtime shadow textures and
shader hooks stay in the viewer; GLB and Blender exports use their target
renderer's lighting.

These are development assets. The real-time groom still lacks inter-fiber
multiple scattering, animated scalp binding, and hair dynamics. The cartoon
meshes use sculpted shapes. Neither route by itself establishes production or
state-of-the-art character quality; inspect the exports and performance in the
target engine.
