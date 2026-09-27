# Editable guide grooms

`createGroom()` validates an editable, JSON-safe source containing named guides,
named layers, widths, surface-facing frames, and optional root attachments.
`generateGroomStrands()` produces deterministic child fibers. `bakeGroomCards()`
projects those same fibers into an atlas. `buildGroom()` combines these stages,
compiles a source-fiber volume for preview shadows, and builds an exportable
representation.

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
validation. Edit a guide's points, width, or layer settings and regenerate both
representations. Optional `root: { surfaceId, triangleIndex, barycentric, uv }`
stores a persistent surface attachment. This release preserves that binding
data; it does not evaluate animated skin deformation or simulate guide dynamics.

## Layers, cards, and baking

Layers independently control density (`children` per guide), radius, clumping,
shortening, frizz, loose hairs, color, and roughness. Use `kind: "undercoat"`
and `kind: "guard"` for a short dense coat beneath longer sparse guard hairs.
See `examples/groom-fur.ts`. The updo's editable source is
`buildMessyBunGroom()` in `examples/haircuts/messy-bun.ts`.

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

High, medium, and low levels reduce card subdivisions and explicit fibers while
retaining the baked coverage of every card and sharing the same full-source
shadow volume. Fiber subsets use stable IDs. Each result records geometry,
atlas, and volume statistics in `userData.threejsGroom.statistics`. These are
adjustable development presets; measure frame time and overdraw in the target
engine to set a runtime budget.

`buildGroomLODs(source)` creates a live Three.js LOD object. Optional
`distances` are three increasing model-unit distances beginning at zero. See
`examples/hair-bun-lod.ts`. For a predictable asset export, build one explicit
level with `renderGroom()`; generic glTF does not preserve Three.js LOD
switching.

```sh
js3 open examples/hair-bun.ts
js3 open examples/hair-bun-lod.ts
js3 build examples/groom-fur.ts output/groom-fur --software
js3 export examples/groom-fur.ts output/groom-fur/model.blend --software
js3 types --force
```

The editable guide source is preserved as JSON metadata in GLB. Visible native
fiber batches become editable Blender Hair Curves; cards remain meshes. Choose
`representation: "strands"` when all generated fibers should become native
curves. In hybrid mode, most fibers are represented by baked textures and only
the explicit fine-fiber subset is exported as native curves.

`js3 build` also writes an asset folder for each groom under `grooms/`:

- `groom.json`: the validated, editable source, including named guides and
  layers.
- `coverage.png`, `normal.png`, `tangent.png`, `depth.png`, `attributes.png`:
  the five baked maps, preserving straight RGBA data even in transparent pixels.
- `manifest.json`: channel encodings, tile UV rectangles, depth ranges, baked
  card paths, and transforms for the groom's scene attachments.

Live LOD levels share one exported asset folder. Parse `groom.json` with
`parseGroom()` and rebuild it after edits. When loading it from a model entry,
use `await fetch("/assets/groom.json").then(r => r.text())` for a file beside
that entry. The manifest records texture orientation and color spaces for
importing the maps into other tools.

## Full-source volume shadows

Baked guide cards default to an alpha cutoff of `.03` to retain thin fibers
after texture filtering. Set `alphaTest` in `renderGroom()`, `buildGroom()`, or
`buildGroomLODs()` to tune coverage for a particular atlas; it accepts 0–1 and
also applies to the portable standard material. The standalone `hairCards()`
helper keeps its existing `.3` default.

The baked alpha channel measures fractional fiber coverage. In an opaque
multisampled preview, source-backed cards retain that fraction above the cutoff,
so fine filtered hairs stay softer than a solid clump. This applies to both hair
and standard shading. Targets without multisampling and transparent captures use
a binary cutout fallback; retaining fractional alpha there would either lack
sample coverage or count it twice in the resolved transparency. GLB keeps the
portable masked material and its authored cutoff.

`renderGroom()` applies this automatically. Custom Three.js integrations can use
`preserveGroomCardCoverage(material)` for source-baked coverage maps; it
composes with existing shader hooks and keeps the material's alpha cutoff.

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
key/fill shadows, including when those lights are switched off.

The controls have separate purposes:

- `volume.resolution`: local source grid, integer 16–128, default 64. Set on
  `compileGroom()`, `buildGroom()`, or `buildGroomLODs()`. `volume: false` skips
  voxelization entirely.
- `volume.maxBytes`: conservative CPU typed-buffer budget for voxelization,
  default 128 MiB, maximum 512 MiB. It includes dense workspace and worst-case
  sparse output, but excludes source objects, card atlases, and GPU textures.
- `preview.lighting.hairShadowResolution`: directional optical-depth grid,
  integer 16–192, default 96. Each default RGBA8 3D map occupies 3.375 MiB; two
  lights use 6.75 MiB before CPU workspace. Doubling resolution multiplies grid
  memory by eight.
- `preview.lighting.hairShadows`: defaults to true when `shadows: true`. Setting
  it to false restores ordinary mesh shadows without discarding the compiled
  volume. General preview shadows are off by default.
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
source volume is static; regenerate the compiled groom after editing fibers.
Custom Three.js integrations can use `voxelizeGroom()`,
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
medulla scattering, or physics simulation. Ambient visibility uses six cardinal
directions with normal weighting and a triangular distance kernel; this is a
coarse hemisphere approximation and can miss diagonal occluders. It comes from
hair density, not the card alpha-tested depth buffer. Occlusion also cannot
replace missing geometric coverage. These distinctions matter especially for
bright fur, sparse hairlines, and strong backlighting.

`shading: "standard"` selects the portable anisotropic physical material. GLB
also exports this standard fallback because glTF does not carry the browser's
custom lighting shader or volume shadows. Blender's native curves receive
Principled Hair for Cycles and use that renderer's own lighting and shadows.
Compare appearance in the target renderer before production use. The
[visual review workflow](hair-lookdev.md) provides shared camera/light presets
and a separate full-density Cycles reference export from `groom.json`.

The guide-to-card organization follows the established
[Houdini card workflow](https://www.sidefx.com/docs/houdini/fur/haircards.html).
Unreal's
[groom rendering pipeline](https://dev.epicgames.com/documentation/en-us/unreal-engine/groom-scalability-and-performance-with-unreal-engine)
documents the additional deformation, transmittance, and rendering stages needed
for a full animated strand system.
