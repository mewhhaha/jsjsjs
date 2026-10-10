# js3 guide: setup, modeling, and delivery

`js3 --help` lists every command and option. `js3 guide` prints that list, then
this guide, then the references below. This guide covers setup, the build and
review loop, how commands report results, the authoring contract, the modeling
prelude, previews, and exports.

- [Shape reference](new-shapes.md): containers, vessels, profiles, frames,
  connectors, and repeated assemblies.
- [Strands, cards, and sculpted locks](strands.md): procedural hair, fur, and
  grass, authored hair cards, and stylized locks.
- [Editable grooms](grooms.md): guide grooms, baked cards, detail levels, volume
  shadows, and hair review.
- [Rigging and animation](rigging.md): skeletons, skinning, clips, IK, spring
  chains, and frame capture.

## Setup

Install Deno 2 from https://deno.com/, then run these commands from this
repository checkout. `just` is optional; the direct Deno commands do the same
work.

```sh
deno --version
deno task setup
deno install --global --allow-all --force --name js3 --config deno.json main.ts
# Equivalent shortcuts when just is installed: just setup && just install
js3 guide
```

The installer prints its global bin directory. Add that directory to `PATH` if
`js3` is not found. With Deno's default installation on Linux/macOS:

```sh
export PATH="$HOME/.deno/bin:$PATH"
```

Put that line in your shell configuration (for example, `~/.zshrc`) to keep it
across sessions. If you chose a custom installation root, use its `bin`
directory instead. The command references this checkout: keep it in place,
including its source, configuration, and web assets. Re-run the install command
if you move it.

After installation, run `js3` from any directory. Relative model and output
paths resolve from your current directory; absolute paths and models outside the
checkout also work. Quote paths that contain spaces. You can also run commands
from this checkout as `deno run -A main.ts <command> ...` without installing
globally. `js3 guide --json` returns this guide as a JSON result.

Chromium is needed for rendering, inspection, and export. To install the
matching browser from any directory, run:

```sh
deno run -A npm:playwright@1.63.0 install chromium
```

On Linux, if Chromium reports missing system libraries, install its dependencies
with `deno run -A npm:playwright@1.63.0 install-deps chromium` (this may request
administrator privileges). `guide`, `init`, `types`, and `serve` do not launch
Chromium.

## Create, edit, build, review

```sh
mkdir -p /tmp/chair-project
cd /tmp/chair-project
js3 init chair.ts --json
js3 types --json
# Edit chair.ts using your file tools.
deno run -A npm:typescript@5.9.3/tsc -p .js3/tsconfig.json
js3 build chair.ts chair-build --software --json
js3 screenshot chair.ts chair-front.png --view front --software --json
js3 inspect chair.ts --software --json
```

Read stdout as one JSON object and check the exit code. A successful build
reports absolute `outputs.glb`, `outputs.preview`, and `outputs.report` paths.
Open the preview with your image inspection tool, and compare the silhouette,
placement, and proportions to the request. Adjust the TypeScript and rebuild
until the model is satisfactory. Deliver the GLB and preview, and keep the
TypeScript for later edits.

Use batch commands for autonomous work. `open` and `--headed` intentionally
create visible windows; use them only when the user wants a live viewer.

## How commands behave

`js3 --help` is the reference for command syntax, defaults, and options. This
section explains the behavior behind them.

### Results and exit codes

With `--json`, stdout carries exactly one JSON object. Build logs, renderer
messages, and Blender output go to stderr. Any failure exits with code 1. With
`--json`, it also prints `{ "ok": false, "error": "..." }` on stdout. The error
message always goes to stderr.

Successful results have `ok: true`, `command`, and absolute paths:

- Batch commands that render (`inspect`, `build`, `screenshot`, `export`,
  `imposter`, `frames`) report the model `file`, `headless`, the selected
  `renderer`, and an `inspection` object (see
  [Review results](#review-results)). With `--clip`, they also report the
  `animation` playback state.
- `screenshot` and `export` add `output`. `build` adds `outputs.glb`,
  `outputs.preview`, and `outputs.report`, plus `outputs.grooms` when the model
  contains editable grooms. `imposter` adds `outputs.atlas`, `outputs.manifest`,
  `coverage`, and `views`. `frames` adds `outputs.directory`,
  `outputs.manifest`, and the `frames` count.
- `init` reports the created `file`. `types` reports the bundle `directory` and
  its `config`.
- Live commands report the `url` and whether the browser is `headless` (`null`
  for `serve`).

`inspect` always prints JSON. Without `--json`, `init`, `screenshot`, and
`export` print `Saved <path>`, and other commands print their result as indented
JSON. `build` saves the same result object it prints as `report.json`.

### Output files

| Command      | Writes                                                                                          |
| ------------ | ----------------------------------------------------------------------------------------------- |
| `build`      | `model.glb`, `preview.png`, `report.json`, and a `grooms/` folder per [groom](grooms.md)        |
| `screenshot` | One `.png` file; other extensions are rejected                                                  |
| `export`     | `.glb`, `.obj`, or `.blend`, chosen by the output extension; other extensions are rejected      |
| `imposter`   | `atlas.png` and `manifest.json` (see [imposter baking](#octahedral-imposter-baking))            |
| `frames`     | `frame-00000.png`, `frame-00001.png`, ..., and `manifest.json` (see [rigging](rigging.md))      |
| `init`       | The starter model; refuses to replace an existing file                                          |
| `types`      | A declaration bundle and `tsconfig.json`; replaces only its own bundle, and only with `--force` |

Output directories are created as needed. Each file is written to a temporary
file and renamed into place once complete, replacing any earlier artifact. An
output path that would overwrite the model source is rejected. A run that fails
partway can leave a mix of new and earlier files in an output directory, so
judge success by the exit code and `ok`, not by which files exist.

### Batch and live sessions

Batch commands (`inspect`, `build`, `screenshot`, `export`, `imposter`,
`frames`) start an isolated local server on a free port, launch headless
Chromium, build the model, wait for it to render, write their outputs, and shut
everything down.

Live commands (`headless`, `serve`, `open`) watch the model and its imported
TS/JS files until Ctrl+C. Closing a managed browser window also ends the
session. Their initial result means the session started, not that the model
built. The server listens on 127.0.0.1 on a free port unless `--port` sets one,
and prints its URL. `serve` launches no browser and needs no Playwright browser
install.

`open` is headed; every other command is headless. `--headed` and `--headless`
override that. `headless --headed` is rejected, as are browser flags on `serve`.
On Linux, headless Chromium uses its headless window platform and clears
`DISPLAY` and `WAYLAND_DISPLAY`, so it never connects to your desktop, including
during software fallback.

### Timeouts

For batch commands, `--timeout` is one deadline for the whole run: server
startup, browser launch, the model build and first render, capture, and writing
outputs, including `.blend` conversion. The default is 30000 ms, or 120000 ms
for `imposter` and `frames`. When it expires, the command fails with
`Operation timed out after N ms.` For `open` and `headless`, the value bounds
browser launch and page load, plus the initial model build when `--clip` is
given. The session itself has no deadline.

### Renderers

By default, Chromium tries hardware WebGL2 first. If no WebGL2 context is
available, js3 relaunches it with SwiftShader software rendering and prints
`GPU WebGL is unavailable; using software rendering.` The selected renderer is
printed as `Renderer: ...` on stderr and reported as `renderer` in results.
`--software` always uses SwiftShader, which needs no GPU and makes screenshots
more reproducible. `--gpu` fails instead of falling back, including when
Chromium selects a software renderer. In the live viewer, software rendering
drops to half resolution while you drag and returns to full resolution when you
stop.

### Camera views

Without `--view`, batch captures use the model's authored framing from
`userData.preview` (see [preview settings](#preview-settings)), or a default
three-quarter view. `--view` places a perspective camera on one side of the
model: `front` +Z, `back` −Z, `left` −X, `right` +X, `top` +Y, `bottom` −Y, or
`iso` (the default three-quarter direction). It looks at the center of the
model's bounding sphere and fits the whole model. An explicit view ignores the
authored `direction`, `target`, `radius`, and `padding`, but keeps the authored
lighting, exposure, background, and grid. `--view` only affects batch commands;
`init`, `open`, `headless`, and `serve` reject it. In a live viewer, press `F`
to return to the authored framing. `imposter` chooses its own views and rejects
`--view`.

`--width` and `--height` set both the browser viewport and the captured image
size. `imposter` rejects them and sizes its atlas with `--grid` and
`--tile-size`.

## Authoring contract

Export a default function returning a Three.js `Object3D` (usually a `Group`)
with finite geometry. Async functions are supported. Await every required
texture or GLTF load before returning, so captures and exports wait for the
complete model. Each call should return fresh objects, materials, and textures;
the viewer disposes the previous model's GPU resources on rebuild.

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

Keep dimensions and colors in easy-to-edit constants. Use consistent units,
Y-up, and descriptive mesh and material names. Use groups to organize related
parts. Primitives, `Shape`/`ExtrudeGeometry`, `LatheGeometry`, curves, and
custom `BufferGeometry` support procedural modeling. Overlapping meshes are
separate surfaces until combined with `await union([...])`. The prelude also
provides subtraction, intersection, profile offsets, and profile bevels. Solid
operations require closed, manifold static input meshes; scenes and exports are
not automatically fused or certified printable.

Model code runs inside Chromium, bundled by esbuild. Use browser APIs; there is
no `Deno` or Node filesystem access. Import the prelude as `js3` or
`js3/prelude`, Three.js as `three`, addons as `three/addons/...`, and local
helpers using relative `.ts`/`.js` paths. The viewer and model share one
Three.js instance. Other npm packages must be browser-compatible and resolvable
by esbuild from the model's directory. Deno import-map aliases and `npm:`/`jsr:`
specifiers are not supported in model code.

Place assets beside the model and load them from `/assets/`: for example,
`await new THREE.TextureLoader().loadAsync("/assets/wood.png")`. Only files
inside the model's directory are served. Each batch run reads fresh assets. In a
live session, imported source files trigger rebuilds but assets alone do not:
save a source file after changing an asset. Camera position is preserved on hot
reload, so press `F` after changing dimensions or authored camera settings. Use
a fresh batch build for the final preview.

## Modeling prelude

Import helpers from `js3` (or the equivalent `js3/prelude`). The exported
`THREE` namespace gives access to the complete Three.js API. The helpers create
ordinary meshes, materials, groups, bones, and clips; they do not introduce a
separate scene format. Use descriptive names so the inspection report identifies
each part. `js3 types` includes every helper with inline documentation.

| Helpers                                                                           | Purpose                                                       | Reference                                                           |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------- |
| `material`, `box`, `roundedBox`, `sphere`, `cylinder`, `extrude`, `lathe`, `tube` | Named materials, primitives, extrusions, revolutions, tubes   | Table below                                                         |
| `group`, `transform`, `center`, `ground`, `align`, `repeat`, `radial`, `mirror`   | Organize parts, place them by bounds, repeat and reflect them | Table below                                                         |
| `stairs`, `ramp`, `arch`, `wall`, `column`, `gableRoof`                           | Architectural parts with real openings                        | [Architectural compositions](#architectural-compositions)           |
| `basin`, `bowl`, `tray`, `cup`, `planter`, `tank`                                 | Hollow containers with real interiors                         | [Shape reference](new-shapes.md#hollow-containers)                  |
| `vase`, `bottle`, `urn`, `pedestal`, `knob`                                       | Revolved vessels, bases, and fittings                         | [Shape reference](new-shapes.md#revolved-vessels-and-turned-solids) |
| `dome`, `hemisphere`, `cone`, `funnel`, `canopy`                                  | Caps, curved shells, and open funnels                         | [Shape reference](new-shapes.md#caps-and-curved-shells)             |
| `sweepProfile`, `molding`, `pipe`, `elbow`, `hose`, `gutter`, `handrail`          | Profiles and hollow or solid sections along paths             | [Shape reference](new-shapes.md#paths-and-profiles)                 |
| `frame`, `doorframe`, `windowFrame`, `pictureFrame`, `recessedPanel`              | Openings, trim, and inset panels                              | [Shape reference](new-shapes.md#frames-and-recessed-faces)          |
| `beamBetween`, `bracket`, `flange`, `gusset`                                      | Supports and connectors, including real flange holes          | [Shape reference](new-shapes.md#connectors-and-supports)            |
| `railing`, `fence`, `grille`, `louvers`, `shelving`                               | Named repeated components with controlled spacing             | [Shape reference](new-shapes.md#repeated-assemblies)                |
| `union`, `subtract`, `intersect`, `offsetProfile`, `bevel`                        | Solid booleans, profile offsets, beveled extrusions           | [Solid operations](#solid-operations-offsets-and-bevels)            |
| `fur`, `grass`, `hair`, `sampleRoots`, `groom`, `strands`, `hairMaterial`         | Seeded strands emitted from a surface                         | [Strands](strands.md)                                               |
| `hairCards`, `hairLock`                                                           | Authored textured hair cards and sculpted stylized locks      | [Strands](strands.md)                                               |
| `createGroom`, `compileGroom`, `renderGroom`, `buildGroom`, `buildGroomLODs`      | Editable guides shared by strands, baked cards, and LODs      | [Grooms](grooms.md)                                                 |
| `rig`, `boneChain`, `humanoidRig`, `bindSkin`, `attachToBone`                     | Named skeletons, weight binding, and bone attachments         | [Rigging](rigging.md)                                               |
| `applyPose`, `resetPose`, `clip`, `sampleAnimation`, `AnimationPlayer`            | Rest-relative posing, clips, and deterministic playback       | [Rigging](rigging.md)                                               |
| `solveTwoBoneIK`, `springChain`, `bakeAnimation`                                  | Limb IK and bakeable secondary motion                         | [Rigging](rigging.md)                                               |

The basic helpers:

| Helper                                                       | Use                                                                                                            |
| ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `material(colorOrOptions)`                                   | Create a `MeshStandardMaterial` from a color or options such as `name`, `color`, `roughness`, and `metalness`. |
| `box([width, height, depth], options)`                       | Create a box centered on its local origin.                                                                     |
| `roundedBox(size, radius, options)`                          | Create a box with rounded edges.                                                                               |
| `sphere(radius, options)`                                    | Create a sphere.                                                                                               |
| `cylinder(radius, height, options)`                          | Create a cylinder along Y; `radiusTop: 0` makes a cone.                                                        |
| `extrude(shape, options)`                                    | Extrude an XY `Shape` along +Z; bevels are off by default.                                                     |
| `lathe([[radius, y], ...], options)`                         | Revolve a profile around Y.                                                                                    |
| `tube(pointsOrCurve, options)`                               | Create a tube along XYZ points or a Three.js curve.                                                            |
| `group(children, options)`                                   | Organize objects; options also accept `preview` settings.                                                      |
| `transform(object, options)`                                 | Set name, position, rotation, or scale. Rotations use degrees.                                                 |
| `center(object, axes = "xyz")`                               | Move selected world-space bounds centers to zero; use `"xz"` to leave height unchanged.                        |
| `ground(object, y = 0)`                                      | Place the bottom of the bounds on a horizontal plane.                                                          |
| `align(object, target, { x: "min", y: "center", z: "max" })` | Align selected minimum, center, or maximum bounds coordinates.                                                 |
| `repeat(count, stepXYZ, factory)`                            | Build a line of objects returned by the factory.                                                               |
| `radial(count, radius, factory, options)`                    | Arrange factory-created objects around a circle.                                                               |
| `mirror(object, axis = "x")`                                 | Put the object into a reflecting wrapper group; this reparents it.                                             |

Primitive options accept `name`, `material`, `position`, `rotation`, and
`scale`. Position and size use your chosen modeling units, with Y up. Prelude
rotation tuples are XYZ Euler angles in degrees; `object.rotation` and other
direct Three.js APIs still use radians. Call factories inside `buildModel` so
reloads receive fresh resources.

`transform`, `center`, `ground`, and `align` mutate and return the supplied
object. Bounds placement uses world coordinates, including under transformed
parents. `align` accepts a target object or `THREE.Box3`, matches the same edge
on both bounds, and leaves omitted axes unchanged; omitting its entire options
argument centers all three axes.

`repeat` calls `factory(index)` for each part and adds `index * step` to its
position. `radial` calls `factory(index, angleRadians)` and adds an XZ circle
offset. Its `startAngle` and `sweep` options use degrees; full circles omit the
duplicate endpoint, while partial arcs include both ends. `orient: true` turns
local +X outward. Both factories must return a fresh, unparented object each
time. `group` and `mirror` reparent their children; cloning is explicit. For
example, `mirror(part.clone(), "x")` keeps the original part in place.

Use Three.js `Shape` for extrusion profiles and holes, addons for more geometry,
and ordinary Three.js methods to modify returned objects. Overlapping meshes
remain separate surfaces, including after GLB or Blender export, unless you
explicitly combine them with the solid operations below.

### Architectural compositions

These helpers accept an optional options object, including `name`, `material`,
`position`, `rotation` (degrees), and `scale`. All dimensions below describe
local coordinates before those transforms. `stairs`, `arch`, `wall`, and
`column` return groups of named, editable meshes and also accept `preview`.
`ramp` and `gableRoof` return meshes. Parts share the supplied material.

| Helper and defaults                                                                              | Dimensions and placement                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `stairs({ width: 2, steps: 6, rise: 0.2, run: 0.3, style: "solid" })`                            | Centered on X, starts at Z = 0, climbs +Z. Total height is `steps * rise`; total length is `steps * run`. `"solid"` uses separate touching blocks extending to Y = 0. `style: "treads"` makes only horizontal slabs; `treadThickness` defaults to `rise / 4` and cannot exceed `rise`. Tread tops have the same heights as solid steps, so their undersides need not reach Y = 0. |
| `ramp({ width: 2, height: 1, length: 3 })`                                                       | Closed wedge centered on X, with a base on Y = 0; climbs from Y = 0 at Z = 0 to `height` at Z = `length`.                                                                                                                                                                                                                                                                         |
| `arch({ openingWidth: 2, openingHeight: 3, depth: 0.4, thickness: 0.25, segments: 24 })`         | Semicircular opening centered on X; depth centered on Z; piers start on Y = 0. `openingHeight` is the clear height at the inner crown. The inner radius is `openingWidth / 2`, with the curve starting at `openingHeight - openingWidth / 2`. Outer width is `openingWidth + 2 * thickness`; outer height is `openingHeight + thickness`.                                         |
| `wall({ width: 4, height: 3, depth: 0.25 })`                                                     | Centered on X and Z, based at Y = 0. Add `opening: { width, height, bottom: 0, center: 0 }` for an empty rectangular opening assembled from surrounding panels. `bottom` is the opening's lower Y and `center` is its X offset; both default to 0. The opening must fit inside the wall.                                                                                          |
| `column({ radius: 0.25, height: 3, baseHeight: 0.15, capitalHeight: 0.15, radialSegments: 24 })` | Circular column centered on X/Z, based at Y = 0. `height` includes the base and capital. `baseRadius` and `capitalRadius` each default to `radius * 1.4`. Set either part's height to 0 to omit it.                                                                                                                                                                               |
| `gableRoof({ width: 4, depth: 3, rise: 1, thickness: 0.15 })`                                    | Closed extruded roof shell, centered on X/Z with its ridge along Z. The underside rises from Y = 0 at the eaves to Y = `rise` at the ridge. `thickness` is vertical; the overall height is `rise + thickness`.                                                                                                                                                                    |

The groups preserve individual parts for later edits and inspection; they do not
fuse touching geometry into one manifold solid. Door and window openings contain
no geometry.

```ts
import { arch, gableRoof, group, material, stairs } from "js3";

export default function buildModel() {
  const stone = material({ color: "#c3b49b", roughness: 0.9 });
  return group([
    stairs({
      name: "entrance_steps",
      steps: 5,
      rise: 0.2,
      run: 0.3,
      material: stone,
    }),
    arch({
      name: "doorway",
      openingWidth: 2,
      openingHeight: 3,
      position: [0, 1, 1.7],
      material: stone,
    }),
    gableRoof({
      name: "canopy",
      width: 3,
      depth: 1,
      rise: 0.8,
      position: [0, 4.25, 1.7],
      material: material("#745145"),
    }),
  ], { name: "entrance", preview: { grid: false } });
}
```

### Containers, profiles, and assemblies

Most of these helpers take one optional options object with dimensions, `name`,
`material`, and transforms. `sweepProfile`, `molding`, `hose`, and `handrail`
take a profile or path first, and `beamBetween` takes two XYZ endpoints. Angles
use degrees. Invalid dimensions and impossible fits throw errors. Walls, floors,
bores, drains, and bolt holes are real geometry, not backface rendering tricks.
Containers and repeated assemblies stand on Y = 0 with a bottom-center origin.
The [shape reference](new-shapes.md) lists each helper's defaults, local axes,
thickness rules, part names, and fit constraints.

### Solid operations, offsets, and bevels

| Helper                                                    | Behavior                                                                                                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `await union(objects, options)`                           | Fuse all supplied objects; each may be a mesh or group of meshes.                                                                                |
| `await subtract(base, cutterOrCutters, options)`          | Remove one or more cutter objects from a base.                                                                                                   |
| `await intersect(objects, options)`                       | Keep only the shared volume of all objects.                                                                                                      |
| `await offsetProfile(profile, distance, options)`         | Expand an XY profile with positive distance, shrink it with negative distance, preserving holes; returns a `THREE.Shape[]` of surviving islands. |
| `bevel(profile, { depth: 1, amount: 0.05, segments: 3 })` | Extrude an XY profile along +Z with beveled perimeter edges, including holes.                                                                    |

Booleans and offsets load the bundled Manifold WASM engine lazily. Use an async
default model factory and await the results. No separate modeling service is
needed. Boolean inputs must contain closed, manifold static triangle meshes;
skinned meshes, instanced meshes, and morph targets must be baked first.
Operations include descendant meshes and bake their world transforms without
modifying the input objects. The result starts in those world coordinates;
`position`, `rotation`, and `scale` options apply additional transforms.

Solid options include `name`, `material`, transforms, `smooth` (default false),
and an optional nonnegative vertex-welding `tolerance`. The result uses one
material, defaulting to the first input material, and computes new normals.
Input UVs are carried through the operation; multiple source materials, rigs,
and modeling history are not preserved. An empty subtraction/intersection can
produce empty geometry, so check whether that result is useful before returning
it as the whole model.

Profiles accept a `THREE.Shape` or an array of `[x, y]` points. Offset options
are `join: "round" | "miter" | "square"` (default `"round"`), `miterLimit`
(default 2), and `segments` (default 32). Curves are sampled. Shrinking can
remove a profile entirely, returning `[]`, or split it into multiple shapes;
handle these cases before extrusion. `bevel` is a profile extrusion helper, not
a modifier for arbitrary existing mesh edges. Its `amount` extends the outline
and both Z ends beyond the nominal extrusion, so allow for the extra dimensions.

```ts
import { basin, box, cylinder, group, material, subtract } from "js3";

export default async function buildModel() {
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
      position: [0, 0.9, 0],
      material: material("#eee5d6"),
    }),
  ], { name: "washbasin", preview: { grid: false } });
}
```

The cylinder cuts completely through the countertop. The basin hangs through
that opening, and its wider rim rests on the top surface. The basin's drain and
interior remain open in the exported geometry.

## Portable types and editor setup

Run `types` in a model project to write declarations without installing npm
packages in that project:

```sh
js3 types                  # Default output: .js3/
# The compiler is fetched/cached by Deno; no npm install step is needed.
deno run -A npm:typescript@5.9.3/tsc -p .js3/tsconfig.json
js3 types .js3 --force --json  # Refresh after a CLI update.
```

The bundle contains the prelude and viewer API declarations, Three.js core and
addon declarations, and their transitive type dependencies. It maps `js3`,
`js3/prelude`, `three`, and `three/addons/...` imports for TypeScript. Use
`import type` from `js3/api` when you need the viewer API's types. The bundle is
portable: it does not depend on this checkout's absolute path or a project's
`node_modules` directory. It supplies types, not a runtime; build and render
models through the CLI.

The emitted `tsconfig.json` enables strict checking and `noEmit`, and checks
TypeScript files under the bundle's parent directory. Place the bundle in your
model project (for example, `models/.js3`) to control the scope. For an editor
or existing project, add a project-root `tsconfig.json` that extends it and sets
the files you want checked:

```json
{
  "extends": "./.js3/tsconfig.json",
  "include": ["models/**/*.ts", "helpers/**/*.ts"]
}
```

Then run `deno run -A npm:typescript@5.9.3/tsc -p tsconfig.json`. `init` does
not write this config or run `types`. `types` refuses an existing output
directory unless `--force` is provided and the directory is recognized as a
bundle owned by this command; it will not overwrite an unrelated directory.

## Review results

`inspection.bounds` contains world-space `min`, `max`, `size`, and `center` XYZ
arrays. `counts` includes objects, meshes, instances, unique geometries, unique
materials, vertices, and triangles. Mesh totals include instances; per-object
counts describe one copy of its geometry. Counts include full geometry even when
a draw range renders only part of it. `objects` lists every object with its
name, type, visibility, counts, and materials; `materials` lists each material's
color and transparency; `animations` lists clip names, durations, and track
counts. Bounds include hidden authored objects; viewer lights and grid are
excluded. Inspect `warnings` for visibility, instancing, or other
qualifications. These are descriptive checks, not a proof of correct topology or
an exact count of what every exporter writes.

### Preview settings

Set `userData.preview` on the returned root object, or pass `preview` to
`group()`, to control the default camera and the viewer's look. These settings
affect previews and captures only, not exported materials.

```ts
model.userData.preview = {
  direction: [1.2, 0.85, 1.5], // Direction from the target toward the camera.
  target: [0, 0.5, 0], // Optional; defaults to the model bounds center.
  radius: 2, // Optional framing radius; defaults to the model bounds radius.
  padding: 1.2, // Default 1.2, minimum 1.
  background: "#202522",
  grid: false,
  exposure: 1.4, // Tone-mapping exposure; default 1.4.
  lighting: { hemisphere: 2.4, key: 3, fill: 2, shadows: true },
};
```

`target` and `radius` frame one part of a model, such as a face. `lighting` sets
the hemisphere, key, and fill intensities; `shadows: true` enables model-fitted
soft key/fill shadow maps (off by default). Groom volume shadow settings also
live under `lighting`; see [grooms](grooms.md). To control one mesh, set
`mesh.userData.previewShadows = { cast: true, receive: false }`. `--view`
replaces the authored camera but keeps these lighting and background settings;
see [Camera views](#camera-views).

## Export formats

Prefer GLB for delivery. It keeps meshes, hierarchy, and the materials,
textures, skins, morph targets, and animations that Three.js's `GLTFExporter`
supports. The viewer's default lights, grid, and camera are never exported.

```sh
js3 export chair.ts chair.glb --json
js3 export chair.ts chair.obj --json
js3 export chair.ts chair.blend --software --json
```

OBJ contains the model's geometry and world transforms in your modeling units;
the format has no unit metadata. Three.js's
[OBJExporter](https://threejs.org/docs/pages/OBJExporter.html) writes no MTL
materials or textures, and OBJ carries no rig or animation. Skinned, instanced,
and shader-deformed geometry is not baked into its displayed pose, so use
regular meshes for OBJ. Intersecting meshes stay separate surfaces unless you
combine suitable closed static meshes with `await union([...])` first.

`.blend` export requires Blender on `PATH`, or `JS3_BLENDER` set to its
executable. The CLI exports a temporary GLB, imports it in a separate background
Blender process (`--background --factory-startup --disable-autoexec`, with
display variables cleared on Linux), packs textures, and saves a real `.blend`
file. It never connects to an existing Blender or MCP session or opens a Blender
window. Meshes, materials, hierarchy, rigs, and animation that survive glTF
remain editable. Procedural modeling history, modifiers, Geometry Nodes,
constraints, and arbitrary Three.js shaders are not reconstructed. Strand
batches become native Blender Hair Curves; see [strands](strands.md). The entry
TypeScript file is included as a text datablock for reference, but its imports
and assets are not archived, so keep the original project for parametric edits.
`build` never needs Blender; `.blend` is a separate export.

## Hair, fur, grass, and grooms

Two references cover fibers, and `js3 guide` prints both:

- [Strands, cards, and sculpted locks](strands.md) covers the direct builders.
  `fur`, `grass`, and `hair` emit seeded, groomed strands from a static surface,
  and `sampleRoots`, `groom`, and `strands` expose the separate stages.
  `hairCards` builds authored textured cards; `hairLock` sculpts closed,
  stylized locks.
- [Editable grooms](grooms.md) covers `createGroom`, `compileGroom`,
  `renderGroom`, `buildGroom`, and `buildGroomLODs`. One JSON-safe guide source
  feeds strands, baked cards, detail levels, and preview volume shadows. `build`
  saves each groom's source and baked maps under `grooms/`. It also covers the
  hair review script and Cycles reference renders.

All of them return ordinary meshes that work with `build`, `screenshot`,
`export`, and `imposter`.

## Octahedral imposter baking

Use `imposter` to capture many orthographic views in one headless browser
session:

```sh
js3 imposter tree.ts output/tree-imposter --coverage 180 --software --json
js3 imposter rock.ts output/rock-imposter --coverage 360 --grid 9 --tile-size 256 --gutter 2 --padding 1.05 --software --json
```

Both commands write transparent `atlas.png` and `manifest.json`; omitting the
output directory uses `output/imposter`. Coverage `180` (the default) means the
upper hemisphere: every azimuth, from the horizon to directly above. It suits
objects whose underside is never visible. Coverage `360` includes both
hemispheres and the bottom pole. It suits objects that can be viewed from below.
Coverage does not restrict horizontal rotation to 180 degrees.

The square atlas has side length `grid * tile-size`, at most 8192 pixels. The
tile size includes the transparent gutter on every tile edge. The odd grid
samples exact poles and horizon directions. More tiles improve angular coverage;
larger tiles improve each view's detail. For a faster first check, use
`--grid 3 --tile-size 128`.

Every view uses the same orthographic scale and the model bounds center as its
pivot, so silhouettes do not change size just because the camera rotates. The
manifest describes the baked world coordinate system, including any transforms
already applied by the model source. Directions point from that center toward
the camera. The right/up basis is recorded per tile; at a pole the stable up
direction is −Z. Framing ignores authored `preview.direction`, `target`, and
`radius`. The bake preserves model-authored lighting and viewer exposure, while
removing the viewer grid and background for transparent output. Await textures
and other asynchronous assets in the model factory before returning the model.

The manifest's `tiles` array contains each tile's `index`, `row`, `col`,
`octUV`, `direction`, `up`, `right`, `rect`, `contentRect`, and `uvRect`. `rect`
and `contentRect` use pixel coordinates; `contentRect` excludes the gutters.
`uvRect` describes that content in normalized atlas coordinates. The top-level
`atlas` records its dimensions and `origin: "top-left"`; `center`, `radius`, and
`orthographic.width`/`height` describe the shared framing.

To consume the atlas:

1. Load `manifest.json` alongside `atlas.png` and use its recorded center and
   orthographic scale to position and size the billboard.
2. Express the runtime camera position in the same coordinate system as the
   bake. For a moved or rotated model, apply the inverse runtime model transform
   first. Normalize `cameraPosition - center` to get the pivot-to-camera
   direction.
3. For a basic nearest-view implementation, choose the tile with the greatest
   dot product between that direction and the tile's recorded camera direction.
   Hemisphere atlases have no underside views; a camera below the horizon will
   select a horizon tile with this method.
4. Sample inside the selected tile's image UV rectangle. All rectangles use a
   top-left origin. For a rectangle `(u, v, width, height)` and tile-local
   coordinates `(s, t)` measured from its top-left, atlas coordinates are
   `(u + s * width, v + t * height)`. If your shader uses bottom-left texture
   coordinates, flip the resulting atlas Y coordinate, or configure texture
   upload to account for the difference; do not apply both flips.

The atlas uses octahedral direction sampling, rather than rows of equally spaced
elevations. The per-tile directions avoid guessing a decoder or its axis order.
More advanced shaders can select and blend neighboring views using the recorded
mapping and camera bases. Gutters reduce adjacent-tile bleed at full resolution;
large mip levels still require an atlas-aware filtering strategy. This command
bakes lit color and alpha only. It does not export depth or normal atlases,
reconstruct hidden surfaces, provide relighting, or install a runtime shader for
a particular engine.

## Troubleshooting

- **Command not found:** add the installer's bin directory to `PATH`; run
  `command -v js3` to check which executable your shell finds.
- **Browser executable missing:** run the pinned Chromium install command in
  Setup. For missing Linux libraries, use the `install-deps` command there.
- **No WebGL context:** retry with `--software`. `--gpu` deliberately fails if
  hardware rendering is unavailable.
- **A window appeared:** `open` and `--headed` explicitly request a window. Use
  batch commands without `--headed`, or use `headless` for a persistent session.
- **Editor cannot resolve `js3` or `three`:** run `js3 types` in the model
  project and extend its `tsconfig.json` as shown above. Refresh generated types
  with `js3 types --force` after updating the CLI.
- **Model fails to build:** read stderr or the JSON `error`; fix syntax,
  imports, or the default export. Return an Object3D containing finite geometry
  and await required asset loads. Quote paths containing spaces.
- **Texture edit did not appear:** save a source file to trigger hot reload, or
  rerun the batch command. Assets are confined to the model's directory.
- **Timeout:** check for unresolved loading promises or missing assets before
  increasing `--timeout`. Use the exit code and `ok` field to establish success;
  a failed build can leave artifacts from an earlier or partial build.
