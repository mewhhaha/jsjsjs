# js3

An agent-friendly CLI for building 3D models with TypeScript and Three.js.
Create a model, edit its named parts, then produce a GLB, PNG preview, and
geometry report in one headless command. Runs on Deno 2; Blender is optional and
only needed for `.blend` export. No MCP server is required. `just` provides
optional shortcuts.

## Start

```sh
git clone git@github.com:mewhhaha/jsjsjs.git
cd jsjsjs
deno task setup                 # Install Playwright's Chromium once
just install                    # Install js3; put Deno's bin directory on PATH
js3 init output/chair.ts     # Create a starter; refuses to overwrite
js3 types output/.js3   # Emit portable declarations and a tsconfig
# Edit output/chair.ts to build the desired model.
deno run -A npm:typescript@5.9.3/tsc -p output/.js3/tsconfig.json
js3 build output/chair.ts output/chair --json
js3 inspect output/chair.ts --json
```

`build` writes `model.glb`, `preview.png`, and `report.json` inside the
requested directory. An agent can read the report and view the PNG, edit the
source, and repeat. GLB preserves materials, textures, skeletons, and animations
supported by Three.js's exporter. This is a code-driven modeling tool; it does
not generate geometry from natural language on its own.

For hair and fur, the [editable groom pipeline](docs/grooms.md) derives strands,
cards, baked maps, detail levels, and a preview shadow volume from one guide
source. With preview shadows enabled, the viewer attenuates its key and fill
lights through the full fiber volume and occludes ambient light near the hair,
including at lower detail levels. `build` also saves the source and five texture
maps under `grooms/` for editing or reuse in another renderer; volume grids
remain specific to the preview runtime. See `examples/hair-bun.ts` and
`examples/groom-fur.ts`. For sculpted cartoon styles, use `hairLock()` and the
quiff/bob examples. The [hair review guide](docs/hair-lookdev.md) covers
repeatable lighting captures and full-strand Cycles references.

Every command also works as `deno run -A main.ts <command> ...`. To install the
`js3` executable, run `just install` and put Deno's global bin directory on your
`PATH`. The installed command references this checkout; keep it in place. Run
`js3 guide` from any directory for setup instructions, modeling examples, all
commands and options, and troubleshooting (`--json` returns the guide as JSON).
See the [agent guide](docs/agent-guide.md) for the complete edit/build/review
loop.

Previously named `threejs`. Existing `threejs` and `threejs/prelude` model
imports still work, and `threejs/api` remains a type alias. New models use
`js3`, `js3/prelude`, and `js3/api`; generated types default to `.js3/`.
`js3 types .threejs --force` can refresh an older bundle in place. `JS3_BLENDER`
selects Blender, with `THREEJS_BLENDER` retained as a fallback. Saved
groom/imposter format identifiers and asset metadata remain compatible.

The [rigging and animation prelude](docs/rigging.md) adds named skeletons, skin
weights, rest-relative poses, degree-based clips, morph tracks, a humanoid
preset, two-bone IK, and bakeable spring chains for hair and accessories. Try
`js3 open examples/rigging.ts` for playback and scrubbing, or
`js3 frames examples/rigging.ts output/wave --clip Wave --fps 24` for
deterministic headless frame capture. `js3 types --force` includes the new APIs.

**Batch commands are headless by default.** `open` and `--headed` explicitly
request windows. On Linux, headless Chromium uses the headless window platform
and clears its display connection variables, including during software fallback.
Use `--software` to render without a GPU. `headless --headed` is rejected.

## Optional live viewer

```sh
just open examples/bracket.ts   # Explicitly opens a visible window
```

Edit `examples/bracket.ts` and save. The model and its imported TS/JS files are
watched automatically. The viewer swaps the model without resetting the orbit
camera. Animated models show clip selection and playback controls over the
canvas. Errors go to the console (and terminal for managed browsers); the last
successful model stays visible until a corrected build is ready. Press `F` to
refit the camera after substantially changing the model's size.

Use **WASD** to move, **Q/E** to descend/ascend, and **Shift** for faster
movement. **Middle-drag** orbits, **Shift + middle-drag** pans, and **scroll**
zooms. Right-drag also pans. Export assets and capture PNG using the commands
below.

## Write a model

The built-in `js3` prelude creates ordinary Three.js objects with fewer steps.
`js3/prelude` is an equivalent import. Use `THREE` for anything the helpers do
not cover:

```ts
import { box, group, material, roundedBox, THREE } from "js3";

export default function buildModel(): THREE.Group {
  const wood = material({ name: "wood", color: "#98724b", roughness: 0.8 });
  const legs = [-0.85, 0.85].flatMap((x) =>
    [-0.35, 0.35].map((z) =>
      box([0.12, 0.925, 0.12], {
        name: `leg_${x}_${z}`,
        material: wood,
        position: [x, 0.4625, z],
      })
    )
  );
  return group([
    roundedBox([2, 0.15, 1], 0.04, {
      name: "top",
      material: wood,
      position: [0, 1, 0],
    }),
    ...legs,
  ], { name: "table", preview: { grid: false } });
}
```

| Helpers                                                                      | Purpose                                                                      |
| ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `material`, `box`, `roundedBox`, `sphere`, `cylinder`                        | Named materials and primitives with position, rotation, and scale options.   |
| `extrude`, `lathe`, `tube`                                                   | Shapes, revolved profiles, and curved tubes.                                 |
| `stairs`, `ramp`, `arch`, `wall`, `column`, `gableRoof`                      | Common architectural shapes with editable dimensions and named parts.        |
| `basin`, `bowl`, `tray`, `cup`, `planter`, `tank`                            | Hollow containers with real interiors and configurable thickness.            |
| `vase`, `bottle`, `urn`, `pedestal`, `knob`                                  | Revolved vessels, bases, and fittings.                                       |
| `dome`, `hemisphere`, `cone`, `funnel`, `canopy`                             | Caps, curved shells, and open funnels.                                       |
| `sweepProfile`, `molding`, `pipe`, `elbow`, `hose`, `gutter`, `handrail`     | Profiles and hollow or solid sections along paths.                           |
| `frame`, `doorframe`, `windowFrame`, `pictureFrame`, `recessedPanel`         | Openings, trim, and inset panels.                                            |
| `beamBetween`, `bracket`, `flange`, `gusset`                                 | Supports and connectors, including actual flange holes.                      |
| `railing`, `fence`, `grille`, `louvers`, `shelving`                          | Named repeated components with controlled spacing.                           |
| `union`, `subtract`, `intersect`, `offsetProfile`, `bevel`                   | Solid booleans, profile offsets, and beveled profile extrusion.              |
| `group`, `transform`, `center`, `ground`, `align`                            | Organize parts and place them using bounds.                                  |
| `repeat`, `radial`, `mirror`                                                 | Build repeated and reflected arrangements.                                   |
| `hair`, `fur`, `grass`, `strands`, `hairCards`                               | Surface emission, styled strands, and authored hair cards.                   |
| `hairLock`                                                                   | Closed, flattened, tapered locks for sculpted cartoon hair.                  |
| `rig`, `boneChain`, `humanoidRig`, `bindSkin`, `attachToBone`                | Named skeletons, weight binding, and bone attachments.                       |
| `applyPose`, `resetPose`, `clip`, `sampleAnimation`, `AnimationPlayer`       | Rest-relative posing, morph/transform clips, and deterministic playback.     |
| `solveTwoBoneIK`, `springChain`, `bakeAnimation`                             | Limb IK and portable secondary motion for hair, tails, and props.            |
| `createGroom`, `compileGroom`, `renderGroom`, `buildGroom`, `buildGroomLODs` | Editable guides shared by strand generation, baked cards, and detail levels. |

Prelude rotations use degrees; direct Three.js rotations use radians. Helpers
return standard meshes and groups, so custom geometry, addons, rigs, and
animations remain available. Overlapping primitives remain separate surfaces
until you combine them with `union`. Solid booleans use Manifold and are
asynchronous. See the [prelude reference](docs/agent-guide.md#modeling-prelude)
for signatures, the [shape reference](docs/new-shapes.md) for dimensions and
options, and the [shape gallery](examples/shapes.ts) for compositions.

Compose architectural parts directly:

```ts
import { arch, gableRoof, group, material, stairs } from "js3";

export default function buildModel() {
  const stone = material("#c3b49b");
  return group([
    stairs({ steps: 5, rise: 0.2, run: 0.3, material: stone }),
    arch({
      openingWidth: 2,
      openingHeight: 3,
      position: [0, 1, 1.7],
      material: stone,
    }),
    gableRoof({ width: 3, depth: 1, rise: 0.8, position: [0, 4.25, 1.7] }),
  ], { name: "entrance" });
}
```

Stairs start at Z = 0 and climb toward +Z. Architectural helpers sit on local Y
= 0; arches and walls have real openings. See
[the architecture example](examples/architecture.ts) and the
[dimensions reference](docs/agent-guide.md#architectural-compositions). Refresh
an existing declaration bundle with `js3 types --force` to typecheck the new
helpers.

Create hollow objects directly, then use booleans when a custom cut is needed:

```ts
import { basin, box, cylinder, group, material, subtract } from "js3";

export default async function buildModel() {
  const ceramic = material("#eee5d6");
  const counter = await subtract(
    box([3, 0.2, 1.6], { position: [0, 1.2, 0] }),
    cylinder(0.62, 0.5, { position: [0, 1.2, 0] }),
    { name: "counter", material: material("#665344") },
  );
  return group([
    counter,
    basin({
      radius: 0.6,
      height: 0.4,
      wallThickness: 0.04,
      bottomThickness: 0.04,
      rimWidth: 0.07,
      rimHeight: 0.03,
      drainRadius: 0.035,
      material: ceramic,
      position: [0, 0.9, 0],
    }),
  ], { name: "washbasin" });
}
```

Booleans accept closed, manifold static meshes or groups of them, bake world
transforms, and return one mesh with one material. Inputs remain unchanged.
Skinning, instances, and morph targets must be baked first. `bevel` operates on
an extrusion profile; it does not round arbitrary existing mesh edges.

Return a `Mesh`, `Group`, or other `Object3D` with finite geometry. Async
factories are supported: await texture/model loading before returning so
screenshots and exports wait for the completed model. Each rebuild should create
fresh objects, materials, and textures; the viewer disposes the previous model's
GPU resources.

Use `js3`, `three`, and `three/addons/...` imports, along with relative
`.ts`/`.js` helper files. The viewer and model share one Three.js instance.
Model files run in the browser, so use browser APIs rather than `Deno` or Node
filesystem APIs. Additional npm dependencies must be browser-compatible and
resolvable by esbuild from the model's directory. Arbitrary Deno import-map
aliases and `npm:`/`jsr:` imports in model code are not supported.

Paths can be relative to this project or absolute, including files outside the
project. Quote filenames containing spaces:

```sh
just open "/tmp/my model.ts"
```

Assets next to the model are served under `/assets/`: for example, use
`await new THREE.TextureLoader().loadAsync("/assets/wood.png")`. File watching
covers imported source dependencies; editing a texture file alone does not
trigger a rebuild. Save a source file to refresh the model after changing an
asset.

## Typecheck a model project

```sh
js3 types .js3 --json
deno run -A npm:typescript@5.9.3/tsc -p .js3/tsconfig.json
```

`types` writes a portable declaration bundle for the prelude, viewer API,
Three.js core, addons, and their type dependencies, plus a strict, no-emit
`tsconfig.json`. The config checks TypeScript files beneath the output
directory's parent. No `npm install` is needed. Use `js3/api` for type-only
viewer API imports. The bundle supports editors and typechecking; run models
with the CLI's browser pipeline.

Choose an output directory beside your model files, such as `output/.js3`. For
an existing project, extend the emitted config and set your own `include`.
Refresh an existing generated bundle with `js3 types .js3 --force`; `--force`
only replaces a bundle owned by this command, never an arbitrary directory.
`init` creates source only, so run `types` separately.

## Commands

```sh
just init output/model.ts
js3 types output/.js3 --json
just inspect output/model.ts --json
just build output/model.ts output/model --json
just open examples/bracket.ts                         # Visible Chromium
just headless examples/bracket.ts                     # Headless Chromium, stays running
just serve examples/bracket.ts                        # Server only; open printed URL yourself
just screenshot examples/bracket.ts output/bracket.png
js3 imposter examples/bracket.ts output/bracket-imposter --coverage 360 --json
just export examples/bracket.ts output/bracket.obj
just export examples/fisherman.ts output/fisherman.glb  # Textures + rig + animation
just export examples/bracket.ts output/bracket.blend  # Requires Blender; background only

just open examples/bracket.ts --port 8080
just screenshot examples/bracket.ts output/large.png --width 1600 --height 1200
just screenshot examples/bracket.ts output/front.png --view front --software
just screenshot examples/bracket.ts output/visible.png --headed
```

`--json` emits one result on stdout; build logs and renderer diagnostics go to
stderr. Success has `ok: true`, `command`, and absolute file/output paths.
Failures have `ok: false` and an `error` string and exit nonzero. `inspect`,
`build`, `screenshot`, and `export` include an `inspection` object with world
bounds, counts, named objects, materials, and warnings. `inspect` always outputs
JSON. `build`'s saved report is the same result as its JSON stdout.

`--view` chooses `iso`, `front` (+Z), `back`, `left`, `right` (+X), `top`, or
`bottom` and frames the whole model. Without it, model-authored preview framing
is used. These views use a perspective camera. `--timeout` sets the batch
deadline in milliseconds (default 30000). `--width` and `--height` default to
1280 and 900. `export` defaults to GLB; specify `.obj` for geometry-only output
or `.blend` for an editable Blender file. Unknown output extensions are
rejected. Existing output artifacts are replaced; `init` never replaces an
existing file.

`open`, `headless`, and `serve` choose a free local port and print the URL. Use
`--port 8000` for a fixed address. Ctrl+C stops the server and its managed
browser; closing the managed browser window also stops the session.

`inspect`, `build`, `screenshot`, `imposter`, and `export` start an isolated
server on a free port, build the model, wait for the browser to render it, write
the output, then shut down. They return a nonzero exit code on build or model
errors. The screenshot captures the full canvas in the default fitted camera
view. `--width`/`--height` set both the viewport and output image dimensions.

Both rendering modes use Playwright Chromium and try GPU rendering first. If
WebGL is unavailable, they fall back to software rendering and print the
selected renderer in the terminal. Use `--gpu` to require hardware acceleration
or `--software` to explicitly use the CPU (useful for reproducible screenshots).
Software rendering draws at reduced resolution during mouse interaction and
returns to full resolution when movement stops. The headless commands require no
desktop display. `serve` needs no Playwright browser install. If Chromium
reports missing system libraries on Linux, install its platform dependencies
using Playwright's `install-deps chromium` command. The CLI uses `deno run -A`
to launch the bundler and browser and write the requested outputs.

## Groomed hair, fur, and grass

Use `fur(surface)` and `grass(surface)` for configurable presets, or
`hair(surface, { roots, groom, render })` for a custom groom. Roots are sampled
by surface area with seeded density masks; guide curves control the flow, with
clumping, curl, frizz, flyaways, combing, and tapered tips. `sampleRoots`,
`groom`, and `strands` expose the separate stages so you can change a groom
without moving its roots.

```ts
const coat = fur(body, {
  roots: { count: 12000, seed: 17 },
  groom: { length: 0.06, radius: 0.002, segments: 12 },
  render: { color: "#684b35", tipColor: "#a0815d" },
});
```

Tube and crossed-ribbon output uses batched meshes with root-to-tip color and
strand-aligned anisotropic PBR shading. GLB/OBJ retain those meshes; `.blend`
also contains editable native Hair Curves and guides. Native tube curves use a
Principled Hair material with Cycles; ribbon systems retain the visible mesh and
hidden editable centerlines. This is a static procedural groom, with optional
ellipsoid clearance for sampled points. It does not provide a dynamics solver,
automatic scalp binding, or full hair light scattering in the browser.

```sh
js3 build examples/strand-fur.ts output/strand-fur --software
js3 build examples/strand-garden.ts output/strand-garden --software
js3 export examples/strand-fur.ts output/strand-fur.blend --software --timeout 120000
```

See [the strand guide](docs/strands.md) for masks, guide curves, materials,
coordinate conventions, and performance controls. `js3 guide` includes it;
refresh declarations with `js3 types --force`.

For editable guide grooms, `buildGroom(source, { volume: { resolution: 64 } })`
also compiles density from all generated fibers. Set the scene root's
`preview.lighting` to `{ shadows: true, hairShadowResolution: 96 }` to enable
directional Beer attenuation and local ambient occlusion. Source volume
resolution accepts 16–128; preview shadow resolution accepts 16–192. Use
`volume: false` to skip voxelization or `hairShadows: false` to disable
directional volume shadows. Ambient occlusion is controlled separately by
`hairAmbientOcclusion` (0–1, default 1), `hairAmbientResolution` (16–96, default
64), and `hairAmbientDistance` (world units, default 12% of the groom's largest
extent). This fixed-grid approximation does not include multiple scattering, and
GLB uses the portable material fallback. See
[the groom guide](docs/grooms.md#full-source-volume-shadows) for usage, budgets,
and export differences.

## Human haircut collection

```sh
js3 open examples/haircuts.ts
js3 open examples/hair-bun.ts
js3 open examples/hair-cartoon.ts
js3 open examples/hair-cartoon-bob.ts
```

The collection puts eight detachable wigs on the same neutral human head: buzz,
textured crop, side part, bob, long waves, curls, ponytail, and twin braids.
`examples/haircut.ts` previews one style; edit its `STYLE` constant.
`examples/wig.ts` exports the wig alone. The head uses the bundled licensed
MakeHuman anatomy; wigs combine layered alpha hair cards with fine strands. The
new `hairCards()` prelude helper generates portable fiber textures, curved
cards, and directional shading. See [the haircut guide](docs/haircuts.md) for
fitting and exports, and [the card guide](docs/hair-cards.md) for authoring
guides.

The cartoon quiff and layered bob use sculpted, tapered meshes and simplified
head materials. `hairLock()` is available in the prelude and emitted types. See
[the visual review guide](docs/hair-lookdev.md) for the helper, headless
captures from several angles, and a native Cycles strand reference.

## Octahedral imposter spritesheets

```sh
js3 imposter examples/bracket.ts output/bracket-imposter --coverage 180 --software --json
js3 imposter examples/bracket.ts output/bracket-imposter-full --coverage 360 --grid 9 --tile-size 256 --gutter 2 --padding 1.05 --json
```

`imposter` renders an octahedral atlas in one headless browser session and
writes transparent `atlas.png` plus `manifest.json` (default directory
`output/imposter`). Coverage `180` (the default) samples the upper hemisphere,
including the horizon, around every azimuth. Coverage `360` samples the complete
sphere, including the underside. These values describe hemisphere versus sphere
coverage, not a half-turn versus full-turn around the model.

All tiles use an orthographic camera, the same bounds-center pivot, and the same
scale. The bake keeps model lighting and viewer exposure, removes the viewer
grid and background, and ignores authored perspective framing. `--grid` is the
number of tiles per side (odd 3–33, default 9); `--tile-size` is the complete
tile size including its internal `--gutter` (defaults 256 and 2 pixels). The
atlas side is `grid * tile-size`, limited to 8192 pixels. `--padding` defaults
to 1.05. Use these options instead of `--view`, `--width`, or `--height`, which
are rejected for this command. The default imposter timeout is 120000
milliseconds.

The manifest records camera directions, up/right bases, the shared pivot and
scale, pixel rectangles, and UV rectangles with a top-left origin. A consumer
can select the view whose direction has the largest dot product with its
normalized pivot-to-camera direction. Convert that direction into the baked
coordinate system when moving or rotating the runtime model. Follow the
manifest's UV convention and account for texture Y flipping in your engine. See
the [guide](docs/agent-guide.md#octahedral-imposter-baking) for sampling
details. This produces a lit color/alpha atlas and reconstruction metadata;
normal/depth atlases, relighting, and an engine-specific imposter shader are not
included.

## Adult female character with separate flowing hair

```sh
just open examples/female.ts
just open examples/female-hair-preview.ts
just export examples/female.ts output/female.glb
just export examples/female-body.ts output/female-body.glb
just export examples/flowing-hair.ts output/flowing-hair.glb
```

The adult female character's body, clothes, eyes, brows, and lashes use 3,030
triangles and a 53-bone rig. Its Toigo Freckles skin adds natural freckles and
color variation. The separate `long01` flowing hair uses 4,108 triangles and a
31-bone rig: a scalp anchor and five six-bone chains. It has its own mesh,
materials, skeleton, and GLB file. The combined model is 7,138 triangles.

Edit `pose` and `hairPose` in `examples/female.ts`; set `showHair = false` to
hide the hair. The viewer does not run a physics simulation. See the
[asset notes and rebuild instructions](examples/female/CREDITS.md) for
attachment behavior, physics metadata, licensing, and separate exports.

The `female-portrait.ts` variant adds an asymmetrical pose, worn mustard
clothing, generated fabric normal detail, hazel eyes and darker hair. Its
reduced hair brings the complete character to **4,829 triangles**. See the
[portrait asset notes](examples/female-portrait/CREDITS.md).

```sh
just open examples/female-portrait.ts
just export examples/female-portrait.ts output/female-portrait.glb
```

## Earlier low-poly male

```sh
just open examples/lowpoly-human.ts
just screenshot examples/lowpoly-human-portrait.ts output/portrait.png --width 1000 --height 1000
just export examples/lowpoly-human.ts output/lowpoly-human.glb
```

The reduced stock character retains the 53-bone rig and photographic albedo
textures, with baked normal and roughness maps for skin, clothing and footwear.
Edit `pose` or set `wireframe = true` in `examples/lowpoly-human.ts` and save.
The [asset notes](examples/lowpoly-human/CREDITS.md) describe the texture
sources, baking process, and limitations. Triangle counts are in the asset's
manifest.

## Stock human rig

```sh
just open examples/stock-human.ts
just screenshot examples/stock-human.ts output/stock-human.png --width 1000 --height 1300
just export examples/stock-human.ts output/stock-human.glb
```

This is the new character foundation: MakeHuman's stock male topology, UVs and
53-bone game-engine rig, with stock skin, hair, shirt, jeans and shoes. Edit the
`pose` dictionary in `examples/stock-human.ts` to rotate joints in degrees and
hot reload. Use `{}` for the original A-pose. All bone names are listed in
`examples/stock-human/manifest.json`, including individual finger joints.

The asset is local and self-contained. Blender is only used for the one-time
stock-asset preparation; opening, posing, screenshots, and GLB export still use
the Deno/Three.js pipeline, including headless mode. The editable Blender
source, preparation script, and [asset credits](examples/stock-human/CREDITS.md)
are included. Clothing and shoes have stock normal maps; the stock skin has a
diffuse texture only. This is the base for further character work, with no
fisherman raincoat or accessories yet. Use GLB to retain the skeleton and
textures.

## Earlier procedural fisherman experiment

```sh
just open examples/fisherman.ts
just screenshot examples/fisherman.ts output/fisherman.png --width 1200 --height 1500
just export examples/fisherman.ts output/fisherman.glb
```

The character has approximately 4,400 triangles and a 55-bone humanoid FK
skeleton, including fingers, jaw and coat hem joints. Edit the `pose` dictionary
at the top of `examples/fisherman.ts` to rotate joints in degrees; save to
update the view. Remove entries or set angles to zero to reset those joints.
Accessories follow the hands. Set `showAccessories` to false for the character
alone.

The images in `examples/fisherman/` are generated photographic-style albedo and
OpenGL normal atlases, with UVs assigned in the model source. They are embedded
in GLB exports along with skin weights and the `Breathing_idle` animation. This
is a deformable FK rig; it does not include IK controllers, facial blend shapes
or simulated cloth. Select `Breathing_idle` in the viewer to play or scrub it;
the authored pose stays still until playback is requested.

Models can set `userData.preview.direction` to an XYZ viewing direction and
`userData.preview.padding` (at least 1) for their default screenshot framing.
Optional `preview.target` (XYZ) and `preview.radius` frame a particular part of
the model, such as a face. `preview.exposure` controls the viewer's tone-mapping
exposure; the default is 1.4. These settings do not alter exported materials.
`preview.lighting` optionally sets `hemisphere`, `key`, and `fill` intensities;
`preview.background` sets the background color and `preview.grid` toggles the
grid.

## Blender export

```sh
js3 export examples/bracket.ts output/bracket.blend --software --json
```

Install Blender and put `blender` on `PATH`, or set `JS3_BLENDER` to its
executable path. The CLI exports a temporary GLB, imports it in a separate
Blender process with `--background --factory-startup`, packs image assets, and
saves a real `.blend` file. This does not use Blender MCP or an open Blender
session. Blender's display connection variables are cleared on Linux.

The file contains editable meshes and supported glTF materials, textures,
hierarchy, skinning, and animation. It does not reconstruct procedural modeling
history, modifiers, Geometry Nodes, constraints, or arbitrary Three.js shaders.
The entry TypeScript file is included as a text datablock for reference; its
imports and source assets are not archived as a complete project. Keep the
original source project for parametric edits. The viewer's default lights, grid,
and camera are not exported. Increase `--timeout` for large scenes; the normal
batch deadline also covers the Blender conversion.

`build` still creates GLB, PNG, and JSON without requiring Blender. Use the
separate `export ... .blend` command when you need a Blender handoff.

## OBJ scope

Exports include the authored model's geometry and world transforms, excluding
the viewer grid and lights. Three.js's
[OBJExporter](https://threejs.org/docs/pages/OBJExporter.html) does not write
MTL materials or textures. OBJ also does not retain procedural instructions or
animation. Use regular meshes for export; GPU instancing, skinning, and
shader-only deformation are not baked by this exporter. Intersecting meshes
remain separate surfaces unless you combine suitable closed static meshes with
`await union([...])` before export. Coordinates are in your chosen modeling
units (OBJ has no unit metadata).

## Validate

```sh
just check
just test
```

Tests exercise real headless browsers and CLI subprocesses: initialization, JSON
results/errors, build artifacts, inspection and standard views, display
isolation, external filenames with spaces, imported helper edits, geometry and
transforms in OBJ, PNG generation, build/runtime error recovery, camera
preservation, and asset path confinement. Run `just setup` first. `deno.lock`
pins dependencies. `output/` and `node_modules/` are ignored by Git.
