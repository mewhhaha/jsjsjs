# js3 guide: setup, modeling, and delivery

For skeletons, skin weights, clips, exact-time captures, humanoid presets, IK,
and spring hair chains, see [Rigging and animation](rigging.md). It is also
included in `js3 guide`. Start with `js3 open examples/rigging.ts`.

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
paths resolve from your current directory. You can also run commands from this
checkout as `deno run -A main.ts <command> ...` without installing globally.
Rediscover this guide with `js3 guide`, or get a short reference with
`js3 --help`. `js3 guide --json` returns the guide in a JSON result.

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

Read stdout as one JSON object and check the exit code. Diagnostics are on
stderr. A successful build reports absolute `outputs.glb`, `outputs.preview`,
and `outputs.report` paths. Open the preview with your image inspection tool;
compare the silhouette, placement, and proportions to the request. Adjust the
TypeScript and rebuild until the model is satisfactory. Deliver the GLB and
preview, and retain the TypeScript for later edits.

Use batch commands for autonomous work. `open` and `--headed` intentionally
create visible windows; use them only when the user wants a live viewer.

## Command reference

| Command                           | Result / default output                                                                |
| --------------------------------- | -------------------------------------------------------------------------------------- |
| `guide`                           | Print this setup and modeling guide; no model required.                                |
| `types [directory]`               | Emit portable declarations and a typechecking config; default `.js3`.                  |
| `init model.ts`                   | Create a starter source file; refuse to overwrite it.                                  |
| `inspect model.ts`                | Validate the model and print its geometry report as JSON.                              |
| `build model.ts [directory]`      | Write `model.glb`, `preview.png`, and `report.json`; default directory `output/model`. |
| `screenshot model.ts [image.png]` | Render a PNG; default `output/model.png`.                                              |
| `imposter model.ts [directory]`   | Bake `atlas.png` and `manifest.json`; default directory `output/imposter`.             |
| `export model.ts [model.glb]`     | Export `.glb`, `.obj`, or `.blend`; default `output/model.glb`.                        |
| `headless model.ts`               | Watch source files with a headless Chromium viewer.                                    |
| `serve model.ts`                  | Watch and serve the viewer; print its URL without opening a browser.                   |
| `open model.ts`                   | Watch with an intentionally visible Chromium viewer.                                   |
| `help` or `--help` / `-h`         | Print the short command reference.                                                     |

Batch commands (`inspect`, `build`, `screenshot`, `imposter`, `export`) exit
after finishing. Live commands (`headless`, `serve`, `open`) run until Ctrl+C;
their initial success message means the session started, not that the model
passed inspection.

In the live viewer, press `F` to refit, use WASD to move, Q/E to descend/ascend,
and Shift for faster movement. Middle-drag orbits; Shift + middle-drag or
right-drag pans; scrolling zooms. Closing a managed browser also ends its
session.

| Option                    | Behavior / default                                                                                                     |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| `--force`                 | Replace an existing generated `types` bundle; refuses unrelated directories.                                           |
| `--json`                  | One JSON result on stdout; diagnostics on stderr.                                                                      |
| `--software`              | Use CPU rendering; useful on servers without a GPU.                                                                    |
| `--gpu`                   | Require hardware rendering; mutually exclusive with `--software`.                                                      |
| `--width N --height N`    | Browser viewport / preview size; default 1280 × 900, each 1–16384.                                                     |
| `--view VIEW`             | Batch camera: `iso`, `front`, `back`, `left`, `right`, `top`, `bottom`; default authored camera or fitted perspective. |
| `--timeout MS`            | Batch deadline in milliseconds; default 30000, or 120000 for `imposter`, positive integer.                             |
| `--port N`                | Local server port; default 0 selects a free port, maximum 65535.                                                       |
| `--headed` / `--headless` | Override browser mode; batch defaults to headless, `open` to headed.                                                   |
| `--`                      | Treat remaining arguments as paths, including paths starting with `-`.                                                 |

Renderer selection defaults to automatic, with software fallback when hardware
is unavailable. `headless --headed` and browser mode flags on `serve` are
invalid. Preview, renderer, port, and timeout options concern commands that
start a viewer or server; `init` only creates source and `types` only writes the
declaration bundle. Builds replace existing artifacts and create output
directories as needed.

## Authoring contract

Export a default function returning a Three.js `Object3D` (usually a `Group`).
Async functions are supported. Await every required texture or GLTF load before
returning. Each call should return fresh objects. Use browser APIs; this code
runs inside Chromium and has no `Deno` or Node filesystem access.

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
Y-up, and descriptive mesh/material names. Use groups to organize related parts.
Primitives, `Shape`/`ExtrudeGeometry`, `LatheGeometry`, curves, and custom
`BufferGeometry` support procedural modeling. Overlapping meshes are separate
surfaces until combined with `await union([...])`. The prelude also provides
subtraction, intersection, profile offsets, and profile bevels. Solid operations
require closed, manifold static input meshes; arbitrary scenes and exports are
not automatically fused or certified printable.

Import the prelude as `js3` or `js3/prelude`, Three.js as `three`, addons as
`three/addons/...`, and local helpers using relative `.ts`/`.js` paths. Place
assets beside the model; load `texture.png` as `/assets/texture.png`. Await
`TextureLoader.loadAsync` or `GLTFLoader.loadAsync`. Each batch run reads fresh
assets. In a live session, save a source file after changing an asset to trigger
a reload. Imported source files trigger rebuilds; assets alone do not. Camera
position is preserved on hot reload, so refit or restart the viewer after
changing dimensions or authored camera settings. Use a fresh batch build for the
final preview.

## Modeling prelude

Import helpers from `js3` (or the equivalent `js3/prelude`). The exported
`THREE` namespace gives access to the complete Three.js API. The helpers create
ordinary meshes, materials, and groups; they do not introduce a separate scene
format. Use descriptive names so the inspection report identifies each part.

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
| `stairs(options)`, `ramp(options)`                           | Create a flight of steps or a sloped wedge, climbing along +Z.                                                 |
| `arch(options)`, `wall(options)`                             | Create an archway or a wall with an optional rectangular opening.                                              |
| `column(options)`, `gableRoof(options)`                      | Create a column with base/capital or a roof with a ridge along Z.                                              |
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

See [`examples/architecture.ts`](../examples/architecture.ts) for a larger
composition. These helpers are included in `js3 types`; after updating the CLI,
refresh an existing bundle with `js3 types --force`.

### Containers, profiles, and assemblies

All of these helpers are exported from `js3` and included in `js3 types`. Most
take one optional options object with dimensions, `name`, `material`, and
transforms; path/profile helpers have the positional arguments shown below.
Angles use degrees. Invalid dimensions and impossible fits throw errors.

| Family                       | Helpers and key options                                                                                                                                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hollow containers            | `basin({ shape: "round"                                                                                                                                                                                            |
| Revolved forms               | `vase`, `bottle`, `urn`, `pedestal`, `knob`; use `lathe` for your own radius/height profile.                                                                                                                       |
| Caps and shells              | `dome`, `hemisphere`, `cone`, `funnel`, `canopy`; openings and wall thickness depend on the helper.                                                                                                                |
| Straight and curved sections | `pipe({ radius, wallThickness, length })`, `elbow({ radius, wallThickness, bendRadius, angle })`, `hose(path, options)`, `handrail(path, options)`, `gutter(options)`. A pipe/hose is hollow; a handrail is solid. |
| Custom profiles along paths  | `sweepProfile(profile, path, options)`, `molding(profile, path, options)`; profile is a `THREE.Shape` with optional holes or XY point tuples; path is XYZ point tuples or a Three.js curve.                        |
| Frames and panels            | `frame`, `doorframe`, `windowFrame`, `pictureFrame`, `recessedPanel`; frame sizing uses `openingWidth`, `openingHeight`, `thickness`, and `depth`. Window frames add `mullions`/`transoms`.                        |
| Supports and fittings        | `beamBetween(startXYZ, endXYZ, { width, depth })`, or `{ radius }` for a round beam; `bracket`, `flange`, `gusset`. Flanges support a center opening and bolt holes.                                               |
| Repeated assemblies          | `railing({ postCount, railCount })`, `fence({ slatCount, topProfile: "pointed" })`, `grille({ verticalCount, horizontalCount })`, `louvers({ count, angle })`, `shelving({ count, support: "posts"                 |

Containers and repeated assemblies use a bottom-center origin, with Y up.
`basin` defaults to round; `tray` defaults to a shallow rectangle. A basin's
`height` excludes its optional rim height, and a rim extends outward. Set both
`rimWidth` and `rimHeight` to enable one. `drainRadius` makes a real hole
through the floor. Walls and floors are actual geometry, not backface rendering
tricks.

Railing post counts include both endpoints; `postSpacing` instead sets a maximum
center-to-center distance. Fence `slatSpacing` and grille `verticalSpacing` /
`horizontalSpacing` instead specify maximum clear gaps, including edge gaps. Do
not supply both a count and its corresponding spacing. Louvers validate the
rotated slats against the frame's height and depth; reduce `slatDepth` or
`count` when they do not fit. Shelving offers separate shelf and support
materials.

Use [the detailed shape reference](new-shapes.md) for each helper's defaults,
local axes, thickness rules, part names, and fit constraints. See
[`examples/shapes.ts`](../examples/shapes.ts) for a gallery. Refresh
declarations with `js3 types --force` after updating the CLI.

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
not write this config automatically. `types` refuses an existing output
directory unless `--force` is provided and the directory is recognized as a
bundle owned by this command; it will not overwrite an unrelated directory.

## Review results

`inspection.bounds` contains world-space `min`, `max`, `size`, and `center` XYZ
arrays. `counts` includes objects, meshes, instances, unique geometries, unique
materials, vertices, and triangles. Mesh totals include instances; per-object
counts describe one copy of its geometry. Counts include full geometry even when
a draw range renders only part of it. Bounds include hidden authored objects;
viewer lights and grid are excluded. Inspect `warnings` for visibility,
instancing, or other qualifications. These are descriptive checks, not a proof
of correct topology or an exact count of what every exporter writes.

`--view front` looks from +Z, `right` from +X, and `top` from +Y. All standard
views fit the complete model. For an authored portrait or detail view, omit
`--view` and set `model.userData.preview` with `direction`, `target`, `radius`,
and `padding`; lighting, exposure, background, and grid are also configurable:

```ts
model.userData.preview = {
  direction: [1.2, 0.85, 1.5], // Direction from the target toward the camera.
  target: [0, 0.5, 0], // Optional; defaults to the model bounds center.
  radius: 2, // Optional framing radius; defaults to the model bounds radius.
  padding: 1.2, // Default 1.2, minimum 1.
  background: "#202522",
  grid: false,
  exposure: 1.4,
  lighting: { hemisphere: 2.4, key: 3, fill: 2 },
};
```

Explicit `--view` ignores authored camera settings while retaining lighting and
background. Camera positions are `front` +Z, `back` −Z, `left` −X, `right` +X,
`top` +Y, and `bottom` −Y, looking toward the target.

Prefer GLB for delivery. OBJ contains geometry and transforms but does not carry
materials, textures, skinning, or animation; skinned and instanced geometry is
not baked into its displayed pose. Export format follows the output extension:

```sh
js3 export chair.ts chair.glb --json
js3 export chair.ts chair.obj --json
js3 export chair.ts chair.blend --software --json
```

`.blend` export additionally requires Blender on `PATH` (or set `JS3_BLENDER` to
its executable). It imports a temporary GLB in a separate Blender process using
`--background --factory-startup`, packs textures, and saves the file. It never
connects to an existing Blender/MCP session or opens a Blender window. Supported
meshes, materials, hierarchy, rigs, and animation remain editable; procedural
instructions, modifier history, Geometry Nodes, constraints, and arbitrary
shaders are not reconstructed. The entry TypeScript source is included as a text
datablock for reference, but helper imports and assets are not a complete source
archive. Keep the original project for edits. The viewer's default lights, grid,
and camera are excluded. `build` continues to produce GLB/PNG/JSON without
Blender; `.blend` is a separate export.

Build or runtime errors return nonzero with `{ "ok": false, "error": "..." }`
when `--json` is used. Fix the source and repeat. Increase `--timeout` for large
assets (milliseconds; default 30000).

## Hair, fur, grass, and fibers

The prelude includes `fur(surface, options)`, `grass(surface, options)`, and
`hair(surface, { roots, groom, render })`. These distribute seeded roots over
static triangle surfaces and create groomed, tapered strands. `roots` controls
count, seed, density masks, and regions; `groom` controls guide interpolation,
length, clump, curl, frizz, flyaways, and static ellipsoid clearance; `render`
chooses batched tubes or crossed ribbons, colors, material, and transforms.

Use `sampleRoots`, `groom`, and `strands` separately to retain the same root
positions while changing hairstyles or other strand shapes. Sampled mesh
coordinates include world transforms; do not apply the emitter transform twice.
For grass, use upward-facing emitter normals. Skinning and morphing must be
baked before root sampling.

The [strand reference](strands.md), also appended by `js3 guide`, contains
complete examples and controls. Try `examples/strand-fur.ts` and
`examples/strand-garden.ts`. Both work with ordinary build, screenshot, export,
and imposter commands. Counts increase density; segment counts improve strand
curvature. Tube side counts and ribbon planes change geometry cost separately.

GLB/OBJ exports use the preview meshes. `.blend` also reconstructs editable
native Hair Curves and hidden guides. Tube previews are hidden in favor of
native curves with a Principled Hair shader and Cycles; ribbon preview meshes
stay visible, with their editable centerlines hidden. Native strand export
requires Blender's `hair_curves.add_curves` API (verified with Blender 5.2).
These are static grooms, not attached scalp systems or particle dynamics.

For an editable source shared by strands, cards, and baked maps, use
`createGroom()`, `compileGroom()`, and `renderGroom()`; `buildGroom()` combines
those stages. Named layers control undercoat, guard hairs, and flyaways.
`buildGroomLODs()` adds distance-based detail switching. `js3 build` exports
each source as `groom.json` with its five baked PNG maps and a manifest. The
[editable groom guide](grooms.md), also included by `js3 guide`, covers the
dedicated hair shader, memory budgets, portable material fallback, and research
limitations. `examples/groom-fur.ts` demonstrates a layered coat.

### Human haircut examples

`js3 open examples/haircuts.ts` previews a default human head and eight
interchangeable wigs. Use `examples/haircut.ts` for a single head with hair, or
`examples/wig.ts` for a detached wig; edit the `STYLE` constant to select buzz,
crop, side-part, bob, waves, curls, ponytail, or braids. A `bald` reference is
also available in the catalog. Each head and wig share the same fitting frame.
`examples/hair-bun.ts` is a separate authored updo with an uneven fringe and
loose temple strands, built through the editable groom pipeline.
`examples/hair-bun-lod.ts` demonstrates its detail levels.

The [haircut guide](haircuts.md) describes the reusable source helpers in
`examples/haircuts/`, the shared fitting dimensions, and export commands. The
styles use a licensed anatomical head, layered alpha hair cards and separate
editable strands. `buildHaircut()` and `buildHead()` are asynchronous because
they load the bundled head asset. `buildWig()` is synchronous.

Use `hairCards(guides, options)` for portable, textured card grooms. Each guide
specifies centerline `points`, full `width`, and optional facing `normals`. The
[card guide](hair-cards.md), included below, covers atlas controls and exports.

## Octahedral imposter baking

Use `imposter` to capture many orthographic views in one headless browser
session:

```sh
js3 imposter tree.ts output/tree-imposter --coverage 180 --software --json
js3 imposter rock.ts output/rock-imposter --coverage 360 --grid 9 --tile-size 256 --gutter 2 --padding 1.05 --software --json
```

Both commands write transparent `atlas.png` and `manifest.json`; omitting the
output directory uses `output/imposter`. Coverage `180` means the upper
hemisphere: every azimuth, from the horizon to directly above. It suits objects
whose underside is never visible. Coverage `360` includes both hemispheres and
the bottom pole. It suits objects that can be viewed from below. Coverage does
not restrict horizontal rotation to 180 degrees.

| Imposter option       | Behavior / default                                                            |
| --------------------- | ----------------------------------------------------------------------------- |
| `--coverage 180\|360` | Upper hemisphere or full sphere; default 180.                                 |
| `--grid N`            | Tiles per row and column; odd integer 3–33, default 9.                        |
| `--tile-size N`       | Complete square tile size in pixels, including internal gutters; default 256. |
| `--gutter N`          | Transparent inset in pixels on every tile edge; default 2.                    |
| `--padding N`         | Extra framing space around the common model bounds; default 1.05.             |
| `--timeout MS`        | Total batch deadline; default 120000 for this command.                        |

The square atlas has side length `grid * tile-size`, at most 8192 pixels. The
odd grid samples exact poles and horizon directions. More tiles improve angular
coverage; larger tiles improve each view's detail. For a faster first check, use
`--grid 3 --tile-size 128`. `--view`, `--width`, and `--height` are incompatible
with `imposter`; choose the atlas dimensions with its own options.

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
  after updating the CLI.
- **Model fails to build:** read stderr or the JSON `error`; fix syntax,
  imports, or the default export. Return an Object3D containing finite geometry
  and await required asset loads. Quote paths containing spaces.
- **Texture edit did not appear:** save a source file to trigger hot reload, or
  rerun the batch command. Assets are confined to the model's directory.
- **Timeout:** check for unresolved loading promises or missing assets before
  increasing `--timeout`. Use the exit code and `ok` field to establish success;
  an unsuccessful build can leave artifacts from an earlier or partial build.
