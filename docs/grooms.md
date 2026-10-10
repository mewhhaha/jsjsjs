# Editable guide grooms

A guide groom is one editable, JSON-safe source that drives every hair
representation. `createGroom()` validates the source: named guides, named
layers, widths, surface-facing frames, and optional root attachments.
`generateGroomStrands()` produces deterministic child fibers from it, and
`bakeGroomCards()` projects those same fibers into a texture atlas.
`buildGroom()` combines these stages, compiles a source-fiber volume for preview
shadows, and builds an exportable representation.

For small direct strand systems, grass, authored cards, or sculpted locks, see
[strands, cards, and sculpted locks](strands.md).

Save this as `output/lock.ts`:

```ts
import { buildGroom, createGroom } from "js3";

const source = createGroom({
  version: 1,
  seed: 42,
  name: "swept-lock",
  layers: [{
    id: "outer",
    kind: "hair",
    children: 32,
    radius: .0005,
    clump: .45,
    lengthVariation: .12,
    frizz: .001,
    color: "#48291e",
    tipColor: "#85553b",
    roughness: .5,
  }],
  guides: [{
    id: "left-fringe",
    layer: "outer",
    region: "left-of-part",
    points: [[0, 1, 0], [.06, .8, .04], [.10, .6, .02]],
    width: [.04, .05, .01],
    normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
  }],
});

export default () =>
  buildGroom(source, { lod: "high", representation: "hybrid" });
```

```sh
js3 build output/lock.ts output/lock --software
js3 export output/lock.ts output/lock/model.blend --software --timeout 120000
```

Guide IDs determine child identities. Reordering guides or inserting an
unrelated guide does not change existing fibers. Children belong to their guide
and region; they do not interpolate across a parting. `width` is the full guide
strip width in scene units. `radius` is an individual fiber radius in those same
units. Width and fiber radius must be chosen together, rather than compensating
with texture noise.

Layer `depth` controls the base outward spread as a fraction of guide width
(0–1, default `.09`). It preserves the roots and existing child identities while
adding volume through the middle of each lock. Values around `.3`–`.5` create
deeper bundles in native strand renders. Adjust it with guide placement and
fiber radius; it does not fill gaps between unrelated guides.

`serializeGroom(source)` and `parseGroom(json)` round-trip the source with
validation. Edit a guide's points, width, or layer settings and regenerate every
representation. Optional `root: { surfaceId, triangleIndex, barycentric, uv }`
stores a persistent surface attachment. This release preserves that binding
data; it does not evaluate animated skin deformation or simulate guide dynamics.

## Layers, cards, and baking

Layers independently control density (`children` per guide, 1–512), radius,
clumping, shortening, frizz, loose hairs, color, and roughness. `kind` is
`"hair"`, `"undercoat"`, `"guard"`, or `"flyaway"`. Use undercoat and guard
layers for a short dense coat beneath longer sparse guard hairs. In hybrid
renders, flyaway layers appear only as explicit strands, never as cards.

Each baked card corresponds to a source guide. Its atlas tile is rasterized from
the generated fibers, including their actual radius, curved direction, depth,
and length. The five RGBA8 maps contain diffuse/coverage, fiber normal, tangent,
depth, and root-coordinate/fiber-ID attributes. `bakeGroomCards()` returns the
maps, card guides, per-tile depth ranges, and a memory report. The bake runs on
the CPU and needs no browser or canvas.

The default atlas uses 32 × 64 pixel cells with transparent gutters, a maximum
width of 2048, and a maximum height of 4096. `atlas` options on `buildGroom()`
include `textureSize`, `tileWidth`, `tileHeight`, `gutter`, and `maxBytes`. The
memory limit is checked before allocating five maps. Texture filtering and
mipmaps add GPU memory beyond the raw pixel count in the report. Use larger
tiles for a few close-up locks and smaller tiles for dense overlapping coverage.
Compilation always prepares the card maps, including for a strand-only render,
so all representations can share one bake and exported asset set. Reduce
`tileWidth`/`tileHeight` for grooms with many guides. Use
`generateGroomStrands()` directly when only the source curves are needed.

## Detail levels and export

`compileGroom()` generates fibers, bakes cards, and voxelizes the complete
source once. `renderGroom(compiled, options)` builds any number of consistent
representations from it:

```ts
import { compileGroom, renderGroom } from "js3";
const compiled = compileGroom(source);
const close = renderGroom(compiled, { lod: "high", representation: "hybrid" });
const distant = renderGroom(compiled, { lod: "low", representation: "cards" });
const curves = renderGroom(compiled, {
  lod: "high",
  representation: "strands",
});
```

`lod` defaults to `"high"` and `representation` to `"hybrid"`. High, medium, and
low levels reduce card subdivisions and explicit fibers while retaining the
baked coverage of every card and sharing the same full-source shadow volume.
Fiber subsets use stable IDs. Each result records geometry, atlas, and volume
statistics in `userData.threejsGroom.statistics`. These are adjustable
development presets; measure frame time and overdraw in the target engine to set
a runtime budget.

`buildGroomLODs(source)` creates a live Three.js `LOD` object. Optional
`distances` are three increasing model-unit distances beginning at zero; the
defaults are 0, 6, and 12 times the guides' bounding radius. For a predictable
asset export, build one explicit level with `renderGroom()`; generic glTF does
not preserve Three.js LOD switching.

The editable guide source is preserved as JSON metadata in GLB. Visible native
fiber batches become editable Blender Hair Curves; cards remain meshes. Choose
`representation: "strands"` when all generated fibers should become native
curves. In hybrid mode, most fibers are represented by baked textures and only
the explicit fine-fiber subset is exported as native curves.

### Groom assets

`js3 build` also writes an asset folder for each groom under
`grooms/<NNN>-<name>/`, numbered in scene order and named from the source's
`name` (for the example above, `output/lock/grooms/001-swept-lock/`). A scene
can export at most 64 groom asset sets.

- `groom.json`: the validated, editable source, including named guides and
  layers.
- `coverage.png`, `normal.png`, `tangent.png`, `depth.png`, `attributes.png`:
  the five baked maps, preserving straight RGBA data even in transparent pixels.
- `manifest.json`: channel encodings, tile UV rectangles, depth ranges, baked
  card guides, and world transforms for every scene object that uses the groom.

Live LOD levels share one exported asset folder. Parse `groom.json` with
`parseGroom()` and rebuild it after edits. When loading it from a model entry,
use `await fetch("/assets/groom.json").then((r) => r.text())` for a file beside
that entry. The manifest records texture orientation and color spaces for
importing the maps into other tools.

## Card coverage

Baked guide cards default to an alpha cutoff of `.03` to retain thin fibers
after texture filtering. Set `alphaTest` in `renderGroom()`, `buildGroom()`, or
`buildGroomLODs()` to tune coverage for a particular atlas; it accepts 0–1 and
also applies to the portable standard material. The standalone `hairCards()`
helper keeps its own `.3` cutoff.

The baked alpha channel measures fractional fiber coverage. In an opaque
multisampled preview, source-backed cards retain that fraction above the cutoff,
so fine filtered hairs stay softer than a solid clump. This applies to both hair
and standard shading. Targets without multisampling and transparent captures,
such as imposters, use a binary cutout fallback; retaining fractional alpha
there would either lack sample coverage or count it twice in the resolved
transparency. GLB keeps the portable masked material and its authored cutoff.

`renderGroom()` applies this automatically. Custom Three.js integrations can use
`preserveGroomCardCoverage(material)` for source-baked coverage maps; it
composes with existing shader hooks and keeps the material's alpha cutoff.

## Full-source volume shadows

Enable preview shadows on the returned scene root to use volume attenuation:

```ts
import { buildGroom, group } from "js3";

export default () =>
  group([
    buildGroom(source, {
      representation: "hybrid",
      volume: { resolution: 64, maxBytes: 128 * 1024 * 1024 },
    }),
  ], {
    preview: {
      lighting: {
        shadows: true,
        hairShadows: true,
        hairShadowResolution: 96,
        hairAmbientOcclusion: 1,
        hairAmbientResolution: 64,
      },
    },
  });
```

The volume includes every generated fiber, independently of visible strand
subsets or card detail. Its density integrates fiber radius and segment length;
orientation moments approximate the cross-section facing each light. The viewer
projects that volume into a fixed cubic optical-depth grid for each of its two
directional lights, key and fill. Direct light reaching hair and other
shadow-receiving Standard/Physical materials is multiplied by Beer
transmittance, `exp(-opticalDepth)`. Groom meshes are excluded from ordinary
shadow casting to avoid counting their opacity twice. Other objects still cast
ordinary shadows.

The same source density also occludes ambient and environment lighting near the
groom. This prevents unshadowed hemisphere light from making scalp visible
through dense hair look as bright as exposed skin. The renderer caches local
transmission toward six world directions in two 3D textures and blends them
using the receiving surface normal. Its finite distance kernel fades occlusion
away from the hair. It affects indirect lighting separately from the direct
key/fill shadows, including when those lights are switched off. Occlusion only
darkens bright gaps; where hair is actually missing, add an overlapping interior
layer rather than relying on shadows.

The controls have separate purposes:

- `volume.resolution`: local source grid, integer 16–128, default 64. Set on
  `compileGroom()`, `buildGroom()`, or `buildGroomLODs()`. `volume: false` skips
  voxelization entirely.
- `volume.maxBytes`: conservative CPU typed-buffer budget for voxelization,
  default 128 MiB, maximum 512 MiB. It includes dense workspace and worst-case
  sparse output, but excludes source objects, card atlases, and GPU textures.
- `preview.lighting.shadows`: enables preview shadows, off by default. Turning
  it off disables both volume shadows and ambient occlusion.
- `preview.lighting.hairShadowResolution`: directional optical-depth grid,
  integer 16–192, default 96. Each default RGBA8 3D map occupies 3.375 MiB; two
  lights use 6.75 MiB before CPU workspace. Doubling resolution multiplies grid
  memory by eight.
- `preview.lighting.hairShadows`: defaults to true when `shadows: true`. Setting
  it to false restores ordinary mesh shadows without discarding the compiled
  volume.
- `preview.lighting.hairAmbientOcclusion`: ambient occlusion amount, 0–1,
  default 1 with preview shadows enabled. Set 0 to disable it independently of
  direct volume shadows.
- `preview.lighting.hairAmbientResolution`: ambient visibility grid, integer
  16–96, default 64. The two RGBA8 maps occupy 2 MiB at the default resolution.
- `preview.lighting.hairAmbientDistance`: positive world-space distance over
  which nearby hair occludes indirect light. The default is 12% of the largest
  transformed groom extent. Decrease it for tighter contact shadows or increase
  it for broader occlusion.

Voxelization accepts up to 200,000 fibers, four million fiber points, and 16
million quadrature samples. Each directional map accepts at most 64 groom
instances and eight million active voxel projections. Budget violations throw an
error. Inspect `compiled.volume.statistics` or
`object.userData.threejsGroom.statistics.volume` for actual sparse storage and
the conservative allocation bound.

Camera changes reuse the maps. Moving, rotating, or scaling a registered groom,
changing a light direction, or changing shadow resolution rebuilds them. The
source volume is static; regenerate the compiled groom after editing fibers, and
disable volume shadows and ambient occlusion for deforming grooms. Custom
Three.js integrations can use `voxelizeGroom()`,
`buildDirectionalGroomShadow()`, `buildAmbientGroomVisibility()`,
`registerGroomVolume()`, and `GroomVolumeShadows`. A controller supports at most
two directional lights and must be shared by scenes that share materials. Point
lights, spotlights, and area lights do not receive directional volume
attenuation. Indirect lighting uses the separate local ambient visibility field,
cached independently of light direction and camera position.

These grids and shader hooks belong to the preview runtime. They are not saved
in GLB or the `grooms/` asset folder; rebuild them from `groom.json` when using
this renderer. The exported atlas `depth.png` records local card geometry and is
separate from directional optical depth.

## Shading and the research boundary

The default `shading: "hair"` uses a dedicated direct-light preview with three
fiber-scattering paths: surface reflection, transmission, and internal
reflection. It follows the practical longitudinal/azimuthal approximations in
[Karis's SIGGRAPH 2016 hair shading presentation](https://blog.selfshadow.com/publications/s2016-shading-course/karis/s2016_pbs_epic_hair.pdf),
including its color-to-absorption and optical path approximations. The baked
tangent map supplies local fiber direction. Incoming direct light uses the
viewer's ordinary object shadows and the source-volume attenuation above.

The scattering shader remains a single-fiber approximation. Volume extinction
uses `sqrt(1 - E[(tangent · lightDirection)^2])` to approximate the mean
projected fiber cross-section. This is exact for aligned orientations, but can
overestimate extinction when directions vary within a voxel. Finite grids also
smooth small gaps. Optical depth is stored up to 16, where transmission is
already about one ten-millionth.

This implements directional cumulative optical depth on a fixed grid. It does
not implement adaptive deep shadow maps, multiple scattering between fibers,
medulla scattering, or physics simulation, so dense regions can look darker than
a path-traced reference. Ambient visibility uses six cardinal directions with
normal weighting and a triangular distance kernel; this is a coarse hemisphere
approximation and can miss diagonal occluders. It comes from hair density, not
the card alpha-tested depth buffer. Occlusion also cannot replace missing
geometric coverage. These distinctions matter especially for bright fur, sparse
hairlines, and strong backlighting.

`shading: "standard"` selects the portable anisotropic physical material. GLB
also exports this standard fallback because glTF does not carry the browser's
custom lighting shader or volume shadows. Blender's native curves receive
Principled Hair for Cycles and use that renderer's own lighting and shadows.
Compare appearance in the target renderer before production use; the review
tools below help.

The guide-to-card organization follows the established
[Houdini card workflow](https://www.sidefx.com/docs/houdini/fur/haircards.html).
Unreal's
[groom rendering pipeline](https://dev.epicgames.com/documentation/en-us/unreal-engine/groom-scalability-and-performance-with-unreal-engine)
documents the additional deformation, transmittance, and rendering stages needed
for a full animated strand system.

## Visual review

`scripts/review-hair.ts` captures front, three-quarter, profile, and back views
under studio, backlight, and grazing light. It uses one headless,
software-rendered browser, writes `<light>-<view>.png` for each combination, and
records the exact camera and light settings with geometry counts in
`review.json`. Run it from the checkout with any model whose default export
builds the hair:

```sh
deno run -A scripts/review-hair.ts output/lock.ts output/lock/review
deno run -A scripts/review-hair.ts output/lock.ts output/lock/review-front --presets studio --views front,profile,back
```

`--help` lists the options. `--width`, `--height`, and `--timeout` control image
dimensions and startup time (defaults 800 × 1000 and 180000 ms). Use
`--hair-shadows off` for a matched comparison against ordinary mesh shadows, or
`--hair-shadow-resolution 128` to raise the directional volume map resolution
from its default of 96 (range 16–192). The source density resolution is a
separate `compileGroom` option. Use `--hair-ao 0` versus `--hair-ao 1` to
compare ambient occlusion while keeping direct shadows fixed.
`--hair-ao-distance` sets its world-space influence distance and
`--hair-ao-resolution` sets its grid size (16–96, default 64). `review.json`
records these settings.

The shared presets in `scripts/hair-review-presets.json` frame a head-sized
model: the camera targets `[0, 0.69, -0.07]` with a 1.03 framing radius. Edit
them when reviewing a model at a different scale or position. Stop editing the
model during capture: a rebuild invalidates the review rather than silently
mixing revisions.

Look for continuous root coverage, intentional partings, hair following the
scalp into its gather, tapered tips, and a coherent silhouette at every angle.
Backlighting exposes broad opaque bands and gaps; grazing light exposes flat
cards and repeated clumps. Adding fibers alone does not fix poorly placed
guides. Soft hairlines come from grading short, fine, lightly pigmented hairs
into denser roots farther inland, with longer hairs overlapping them from inside
the boundary.

## Full-strand Cycles reference

`scripts/export-groom-reference.ts` generates every child fiber directly from a
saved `groom.json` and renders it in Cycles. It does not treat the hybrid
preview's small visible strand subset as the full groom. Blender receives native
Hair Curves, per-layer Principled Hair materials, the optional head mesh, and
the review presets' camera and light directions.

```sh
js3 build output/lock.ts output/lock --software
deno run -A scripts/export-groom-reference.ts \
  --source output/lock/grooms/001-swept-lock/groom.json \
  --output output/lock/cycles-reference \
  --preset studio --view all --resolution 800x1000 --samples 32
```

Use `--preset backlight` or `--preset grazing` with a separate output directory
for further comparisons. `--view` accepts `front`, `three-quarter` (the
default), `profile`, `back`, `all`, or a comma-separated list. `--help` lists
camera, curve sampling, and device options. Fiber density is always the complete
source; `--segments` adjusts samples along each fiber. Blender must be
installed; `JS3_BLENDER` selects its executable. It runs with
`--background --factory-startup --disable-autoexec` and no display connection on
Linux.

`--head` adds a head-only GLB, such as one written by `js3 export`. It is
imported in its own GLB frame, so it must already match the groom's world-space
fitting frame. Transforms from the sibling groom asset `manifest.json` are
applied automatically; `--manifest` selects a different one.

Outputs include `reference.blend`, one PNG per rendered view, a settings and
count report, and the packed editable source. Cycles path tracing, its hair
material, and AgX color management differ from the WebGL preview's lighting and
ACES tone mapping. This is a geometry and appearance reference, not a
pixel-identical renderer test. It helps separate problems in the authored groom
from card coverage and preview shading.
