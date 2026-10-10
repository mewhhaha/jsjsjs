# js3

An agent-friendly CLI for building 3D models with TypeScript and Three.js. A
model is a TypeScript function that returns Three.js objects. One headless
command turns it into a GLB, a PNG preview, and a geometry report. An agent
reads the report, looks at the preview, edits the source, and builds again.

js3 runs on Deno 2. Rendering uses Playwright's Chromium, headless by default.
Blender is optional and only needed for `.blend` export. No MCP server is
required. js3 is a code-driven modeling tool: it does not generate geometry from
natural language on its own.

## Install

Install [Deno 2](https://deno.com/), then from a checkout:

```sh
git clone git@github.com:mewhhaha/jsjsjs.git
cd jsjsjs
deno task setup   # Install Playwright's Chromium once
just install      # Install the js3 command into Deno's global bin directory
```

`just` is optional. Without it, run
`deno install --global --allow-all --force --name js3 --config deno.json main.ts`.
Put Deno's bin directory (usually `~/.deno/bin`) on your `PATH`. The installed
command runs from this checkout, so keep the checkout in place. You can also run
any command as `deno run -A main.ts <command> ...` from the checkout.

## Init, edit, build, review

```sh
js3 init output/chair.ts        # Create a starter model; never overwrites
js3 types output/.js3           # Emit portable declarations and a tsconfig
# Edit output/chair.ts.
deno run -A npm:typescript@5.9.3/tsc -p output/.js3/tsconfig.json
js3 build output/chair.ts output/chair --json
js3 screenshot output/chair.ts output/chair-front.png --view front --json
```

`build` writes `model.glb`, `preview.png`, and `report.json` to `output/chair/`.
With `--json`, stdout is a single JSON result: check `ok`, open the preview,
read the bounds and counts in `inspection`, then edit the source and repeat. GLB
keeps the materials, textures, skeletons, and animations that Three.js's
exporter supports.

Other commands export OBJ or `.blend`, capture animation frames, and bake
octahedral imposter atlases. `js3 --help` lists every command and option.
`js3 guide` prints the same list followed by the full documentation, and works
from any directory.

## A small model

The built-in `js3` prelude creates ordinary named Three.js meshes and groups in
fewer steps. Prelude rotations use degrees. `THREE` is exported for everything
the helpers don't cover.

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

The prelude also covers architectural parts, hollow containers, swept profiles,
solid booleans, hair and fur, grooms, rigs, and animation clips. The
[helper overview](docs/agent-guide.md#modeling-prelude) lists them all.

## Live viewer

```sh
js3 open examples/bracket.ts
```

`open` deliberately opens a visible Chromium window. `headless` keeps a hidden
viewer running, and `serve` only prints a URL to open in any browser. Saving the
model, or any TS/JS file it imports, rebuilds it without resetting the camera.
Build errors are printed while the last good model stays visible. Animated
models get clip selection, playback, and a time slider.

- **Middle-drag** orbits. **Shift + middle-drag** or **right-drag** pans.
  **Scroll** zooms.
- **WASD** moves, **Q/E** descends and ascends, and **Shift** moves faster.
- **F** refits the camera after the model changes size.

## Documentation

- [Agent guide](docs/agent-guide.md): setup, the JSON result contract, the
  authoring contract, the prelude helper overview, previews, exports, imposters,
  and troubleshooting.
- [Shape reference](docs/new-shapes.md): defaults, axes, and part names for
  containers, vessels, profiles, frames, connectors, and repeated assemblies.
- [Strands, cards, and sculpted locks](docs/strands.md): `hair`, `fur`, `grass`,
  `strands`, `hairCards`, and `hairLock`.
- [Editable grooms](docs/grooms.md): guide grooms, baked cards, detail levels,
  volume shadows, lookdev review, and Cycles references.
- [Rigging and animation](docs/rigging.md): skeletons, skinning, clips, IK,
  spring chains, and frame capture.

`js3 guide` prints all of these in order.

## Develop

```sh
just check           # Format check, lint, and typecheck
just test            # Run the test suite
deno task test:unit  # Skip the Chromium and Blender tests
```

The browser tests drive real headless Chromium, so run `deno task setup` first.
Without Chromium or Blender, their tests are skipped; `JS3_SKIP_BROWSER=1` and
`JS3_SKIP_BLENDER=1` skip them on purpose. `deno.lock` pins dependencies.
`output/` is ignored by Git.
