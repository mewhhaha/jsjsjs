import { dirname, extname, resolve } from "node:path";
import { Buffer } from "node:buffer";
import * as esbuild from "esbuild";
import type { Page } from "playwright";
import { startServer } from "./src/server.ts";
import { exportBlend } from "./src/blender.ts";
import { frameTimes } from "./src/frame-times.ts";
import {
  launchViewer,
  type RendererMode,
  waitForModel,
} from "./src/browser.ts";
import type { GroomExportGroup, ModelView } from "./web/api.ts";
import {
  type ImposterOptions,
  resolveImposterOptions,
} from "./web/imposter-layout.ts";

export const help = `js3 — build 3D models with TypeScript and Three.js

Usage: js3 <command> <model.ts> [output] [options]
       js3 guide [--json]
       js3 types [directory] [--force] [--json]
       deno run -A main.ts <command> <model.ts> [output] [options]

guide                                 Show setup and the complete modeling guide
types [directory]                     Emit portable declarations + tsconfig (.js3)
init model.ts                         Create an editable starter (never overwrites)
inspect model.ts                      Validate and report geometry as JSON
build model.ts [output/directory]      Write model.glb, preview.png, report.json + groom assets
screenshot model.ts [output/model.png] Render a PNG and exit
frames model.ts [output/directory]     Capture an animation as PNG frames + manifest.json
imposter model.ts [output/directory]   Bake octahedral atlas.png and manifest.json
export model.ts [output/model.glb]     Export .glb, .obj, or .blend and exit
headless model.ts                     Watch with a headless browser
serve model.ts                        Watch with server only; no browser
open model.ts                         Explicitly open a visible browser

Options:
  --json                   One JSON result on stdout; diagnostics on stderr
  --software | --gpu       CPU rendering or require hardware (default: auto)
  --width N --height N     Preview size (default: 1280 × 900)
  --view VIEW              iso, front (+Z), back, left, right, top, bottom
  --clip NAME              Select an animation (required for frames)
  --time SECONDS           Sample an exact animation time (default 0; requires --clip)
  --fps N                  Frames per second, up to 240 (frames only; default 24)
  --start SECONDS          First frame time (frames only; default 0)
  --duration SECONDS       Capture span (frames only; default: rest of clip)
  --coverage 180|360        Imposter: upper hemisphere or full sphere (default 180)
  --grid N                 Imposter: odd views per side, 3–33 (default 9)
  --tile-size N            Imposter: pixels per tile including gutter (default 256)
  --gutter N               Imposter: transparent inset per tile edge (default 2)
  --padding N              Imposter: framing multiplier, 1–4 (default 1.05)
  --timeout MS             Deadline (default: 120000 for imposter/frames, otherwise 30000)
  --port N                 Local server port (default: free port)
  --headed | --headless    Explicit browser mode (batch defaults to headless)
  --help                   Show this help

Model contract: export default a function returning a THREE.Object3D or Promise.
Use named meshes, browser APIs, three/addons imports, and /assets/ for local assets.
Agent loop: init → edit TypeScript → build --json → inspect preview → repeat.
Run just setup once to install Chromium; just install installs the js3 command.
Run js3 guide for setup, examples, options, and troubleshooting.
.blend export requires Blender on PATH (or set JS3_BLENDER to its executable).
`;

const commands = [
  "init",
  "inspect",
  "build",
  "open",
  "serve",
  "headless",
  "screenshot",
  "export",
  "imposter",
  "frames",
] as const;
const views = ["iso", "front", "back", "left", "right", "top", "bottom"];

export function parseArgs(args: string[]) {
  const [command, ...rest] = args;
  if (command === "guide") {
    const unknown = rest.find((arg) =>
      !["--json", "--help", "-h"].includes(arg)
    );
    if (unknown) throw new Error(`Unknown guide argument: ${unknown}`);
    return { command: "guide" as const, json: rest.includes("--json") };
  }
  if (
    !command || command === "help" || args.includes("--help") ||
    args.includes("-h")
  ) return null;
  if (command === "types") {
    let directory: string | undefined;
    let json = false;
    let force = false;
    let pathsOnly = false;
    for (const arg of rest) {
      if (!pathsOnly && arg === "--") {
        pathsOnly = true;
        continue;
      }
      if (!pathsOnly && arg === "--json") {
        json = true;
        continue;
      }
      if (!pathsOnly && arg === "--force") {
        force = true;
        continue;
      }
      if (!pathsOnly && arg.startsWith("-")) {
        throw new Error(`Unknown types option: ${arg}`);
      }
      if (directory !== undefined) {
        throw new Error("types accepts one output directory.");
      }
      directory = arg;
    }
    return {
      command: "types" as const,
      directory: directory ?? ".js3",
      json,
      force,
    };
  }
  if (!commands.some((candidate) => candidate === command)) {
    throw new Error(`Unknown command: ${command}`);
  }
  const positional: string[] = [];
  const options = {
    port: 0,
    width: 1280,
    height: 900,
    timeout: ["imposter", "frames"].includes(command) ? 120000 : 30000,
    headed: command === "open",
    renderer: "auto" as RendererMode,
    json: false,
    view: undefined as ModelView | undefined,
    imposter: {} as ImposterOptions,
    clip: undefined as string | undefined,
    time: undefined as number | undefined,
    frames: { fps: 24, start: 0, duration: undefined as number | undefined },
  };
  let browserMode: string | undefined;
  let rendererMode: string | undefined;
  while (rest.length) {
    const option = rest.shift()!;
    if (option === "--") {
      positional.push(...rest);
      break;
    }
    if (!option.startsWith("-")) {
      positional.push(option);
      continue;
    }
    if (option === "--json") {
      options.json = true;
      continue;
    }
    if (option === "--clip") {
      if (["init", "serve", "export"].includes(command)) {
        throw new Error(
          `--clip is not supported by ${command}; GLB/Blender export includes all clips.`,
        );
      }
      const name = rest.shift();
      if (!name?.trim() || name.startsWith("--")) {
        throw new Error("--clip requires an animation name.");
      }
      options.clip = name;
      continue;
    }
    if (["--time", "--fps", "--start", "--duration"].includes(option)) {
      if (option !== "--time" && command !== "frames") {
        throw new Error(`${option} is only supported by frames.`);
      }
      if (
        option === "--time" &&
        ["init", "serve", "export", "frames"].includes(command)
      ) {
        throw new Error(
          `--time is not supported by ${command}; use --start for frames.`,
        );
      }
      const raw = rest.shift(), value = Number(raw);
      if (
        !raw || raw.trim() !== raw || !Number.isFinite(value) || value < 0 ||
        (["--fps", "--duration"].includes(option) && value === 0) ||
        (option === "--fps" && value > 240)
      ) throw new Error(`Invalid value for ${option}`);
      if (option === "--time") options.time = value;
      else {options.frames[option.slice(2) as "fps" | "start" | "duration"] =
          value;}
      continue;
    }
    if (option === "--gpu" || option === "--software") {
      if (rendererMode && rendererMode !== option) {
        throw new Error("Choose either --gpu or --software.");
      }
      rendererMode = option;
      options.renderer = option === "--gpu" ? "gpu" : "software";
      continue;
    }
    if (option === "--headed" || option === "--headless") {
      if (browserMode && browserMode !== option) {
        throw new Error("Choose either --headed or --headless.");
      }
      browserMode = option;
      options.headed = option === "--headed";
      continue;
    }
    if (option === "--view") {
      if (command === "imposter") {
        throw new Error(
          "imposter chooses views from its octahedral grid; --view is not supported.",
        );
      }
      const value = rest.shift();
      if (!views.includes(value!)) {
        throw new Error(`Invalid --view; choose ${views.join(", ")}.`);
      }
      options.view = value as ModelView;
      continue;
    }
    if (
      ["--coverage", "--grid", "--tile-size", "--gutter", "--padding"].includes(
        option,
      )
    ) {
      if (command !== "imposter") {
        throw new Error(`${option} is only supported by imposter.`);
      }
      const raw = rest.shift();
      const value = Number(raw);
      if (!raw || !Number.isFinite(value) || raw.trim() !== raw) {
        throw new Error(`Invalid value for ${option}`);
      }
      const key = {
        "--coverage": "coverage",
        "--grid": "grid",
        "--tile-size": "tileSize",
        "--gutter": "gutter",
        "--padding": "padding",
      }[option]!;
      Object.assign(options.imposter, { [key]: value });
      continue;
    }
    if (command === "imposter" && ["--width", "--height"].includes(option)) {
      throw new Error(
        "Use --tile-size for imposter resolution, not --width or --height.",
      );
    }
    if (!["--port", "--width", "--height", "--timeout"].includes(option)) {
      throw new Error(`Unknown option: ${option}`);
    }
    const raw = rest.shift();
    const value = Number(raw);
    const min = option === "--port" ? 0 : 1;
    const max = option === "--port"
      ? 65535
      : option === "--timeout"
      ? 2147483647
      : 16384;
    if (
      !raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(value) ||
      value < min || value > max
    ) throw new Error(`Invalid value for ${option}`);
    options[option.slice(2) as "port" | "width" | "height" | "timeout"] = value;
  }
  const [file, suppliedOutput] = positional;
  if (!file) throw new Error("Supply a TypeScript model file.");
  if (options.time !== undefined && !options.clip) {
    throw new Error("--time requires --clip.");
  }
  if (command === "frames" && !options.clip) {
    throw new Error(
      "frames requires --clip; use inspect to list animation names.",
    );
  }
  if (
    command === "frames" && options.frames.duration !== undefined &&
    options.frames.duration * options.frames.fps > 3600 + 1e-9
  ) throw new Error("Capture supports at most 3600 frames.");
  const hasOutput = ["build", "screenshot", "export", "imposter", "frames"]
    .includes(
      command,
    );
  if (positional.length > (hasOutput ? 2 : 1)) {
    throw new Error(`Too many arguments for ${command}.`);
  }
  if (command === "headless" && options.headed) {
    throw new Error(
      "headless cannot be used with --headed. Use open for a visible window.",
    );
  }
  if (command === "serve" && browserMode) {
    throw new Error("serve does not launch a browser.");
  }
  const output = hasOutput
    ? suppliedOutput ??
      (command === "frames"
        ? "output/frames"
        : command === "imposter"
        ? "output/imposter"
        : command === "build"
        ? "output/model"
        : `output/model.${command === "export" ? "glb" : "png"}`)
    : undefined;
  if (
    command === "export" &&
    ![".obj", ".glb", ".blend"].includes(extname(output!).toLowerCase())
  ) throw new Error("Export output must end in .glb, .obj, or .blend.");
  if (command === "screenshot" && extname(output!).toLowerCase() !== ".png") {
    throw new Error("Screenshot output must end in .png.");
  }
  if (output && resolve(output) === resolve(file)) {
    throw new Error("Output must not overwrite the model source.");
  }
  return {
    command: command as typeof commands[number],
    file,
    output,
    ...options,
    imposter: resolveImposterOptions(options.imposter),
  };
}

const starter = `import { box, group, material } from "js3";

// Edit dimensions, materials, and named parts; then run: js3 build model.ts
export default function buildModel() {
  const sage = material({ name: "sage", color: "#a8c98e", roughness: 0.65 });
  // Modeling units are arbitrary; use one consistent unit throughout.
  return group([
    box([2, 1, 3], { name: "body", material: sage, position: [0, 0.5, 0] }),
  ], { name: "model", preview: { grid: false, background: "#202522" } });
}
`;

function result(value: Record<string, unknown>, json: boolean) {
  if (json) console.log(JSON.stringify(value));
  else if (value.command === "inspect") {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(
      value.output ? `Saved ${value.output}` : JSON.stringify(value, null, 2),
    );
  }
}

// Replace outputs only once their complete contents have been generated.
async function writeOutput(
  path: string,
  data: Uint8Array | string | AsyncIterable<Uint8Array>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  await Deno.mkdir(dirname(path), { recursive: true });
  const temporary = await Deno.makeTempFile({
    dir: dirname(path),
    prefix: ".js3-",
  });
  try {
    if (typeof data === "string") await Deno.writeTextFile(temporary, data);
    else if (data instanceof Uint8Array) await Deno.writeFile(temporary, data);
    else {
      for await (const chunk of data) {
        signal.throwIfAborted();
        await Deno.writeFile(temporary, chunk, { append: true });
      }
    }
    signal.throwIfAborted();
    await Deno.rename(temporary, path);
  } finally {
    await Deno.remove(temporary).catch(() => {});
  }
}

/** Download validated bounded chunks, replacing an existing file only on success. */
export async function writeGLBOutput(
  page: Page,
  path: string,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const transfer = await page.evaluate(() =>
    window.modelViewer.beginGLBExport()
  );
  try {
    if (
      !transfer || typeof transfer.id !== "string" || !transfer.id ||
      !Number.isSafeInteger(transfer.byteLength) || transfer.byteLength < 20 ||
      transfer.byteLength > 0xffffffff ||
      !Number.isSafeInteger(transfer.chunkSize) || transfer.chunkSize < 20 ||
      transfer.chunkSize > 8 * 1024 * 1024 ||
      transfer.chunks !== Math.ceil(transfer.byteLength / transfer.chunkSize)
    ) throw new Error("Viewer returned invalid GLB transfer metadata.");
    const chunks = async function* (): AsyncGenerator<Uint8Array> {
      for (let index = 0; index < transfer.chunks; index++) {
        signal.throwIfAborted();
        const encoded = await page.evaluate(
          ({ id, index }) => window.modelViewer.readGLBExportChunk(id, index),
          { id: transfer.id, index },
        );
        const expected = Math.min(
          transfer.chunkSize,
          transfer.byteLength - index * transfer.chunkSize,
        );
        if (
          typeof encoded !== "string" ||
          encoded.length !== Math.ceil(expected / 3) * 4
        ) {
          throw new Error(
            `GLB transfer chunk ${index} is empty or incomplete.`,
          );
        }
        const bytes = Buffer.from(encoded, "base64");
        if (bytes.byteLength !== expected) {
          throw new Error(
            `GLB transfer chunk ${index} has an invalid decoded length.`,
          );
        }
        if (index === 0) {
          const header = new DataView(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength,
          );
          if (
            header.getUint32(0, true) !== 0x46546c67 ||
            header.getUint32(4, true) !== 2 ||
            header.getUint32(8, true) !== transfer.byteLength ||
            header.getUint32(16, true) !== 0x4e4f534a
          ) throw new Error("GLB transfer has an invalid header.");
        }
        yield bytes;
      }
    };
    await writeOutput(path, chunks(), signal);
  } finally {
    if (transfer && typeof transfer.id === "string") {
      await page.evaluate(
        (id) => window.modelViewer.endGLBExport(id),
        transfer.id,
      )
        .catch(() => {});
    }
  }
}

/** Save editable grooms and every baked map through bounded, per-file transfers. */
export async function writeGroomOutputs(
  page: Page,
  directory: string,
  signal: AbortSignal,
): Promise<GroomExportGroup[]> {
  signal.throwIfAborted();
  const transfer = await page.evaluate(() =>
    window.modelViewer.beginGroomExport()
  );
  const names = [
    "groom.json",
    "manifest.json",
    "coverage.png",
    "normal.png",
    "tangent.png",
    "depth.png",
    "attributes.png",
  ];
  try {
    if (
      !transfer || typeof transfer.id !== "string" || !transfer.id ||
      !Array.isArray(transfer.grooms) || transfer.grooms.length > 64 ||
      !Array.isArray(transfer.files) ||
      transfer.files.length !== transfer.grooms.length * names.length
    ) throw new Error("Viewer returned invalid groom transfer metadata.");
    const paths = new Set<string>();
    for (const group of transfer.grooms) {
      if (
        typeof group.name !== "string" || typeof group.directory !== "string" ||
        !/^grooms\/\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/.test(group.directory) ||
        group.directory.length > 64 || !group.files ||
        Object.values(group.files).length !== names.length
      ) throw new Error("Viewer returned invalid groom output paths.");
      const expected = names.map((name) => `${group.directory}/${name}`);
      for (const path of Object.values(group.files)) {
        if (!expected.includes(path) || paths.has(path)) {
          throw new Error(
            "Viewer returned unsafe or duplicate groom output paths.",
          );
        }
        paths.add(path);
      }
    }
    const pending = new Set(paths);
    for (const file of transfer.files) {
      if (
        !pending.delete(file.path) ||
        file.kind !== (file.path.endsWith(".png") ? "png" : "json")
      ) throw new Error("Viewer returned invalid groom file metadata.");
    }
    for (let fileIndex = 0; fileIndex < transfer.files.length; fileIndex++) {
      signal.throwIfAborted();
      const file = transfer.files[fileIndex];
      const prepared = await page.evaluate(
        ({ id, fileIndex }) =>
          window.modelViewer.prepareGroomExportFile(id, fileIndex),
        { id: transfer.id, fileIndex },
      );
      if (
        !prepared || prepared.id !== transfer.id ||
        prepared.fileIndex !== fileIndex ||
        !Number.isSafeInteger(prepared.byteLength) || prepared.byteLength < 8 ||
        prepared.byteLength > 256 * 1024 * 1024 ||
        !Number.isSafeInteger(prepared.chunkSize) || prepared.chunkSize < 8 ||
        prepared.chunkSize > 8 * 1024 * 1024 ||
        prepared.chunks !== Math.ceil(prepared.byteLength / prepared.chunkSize)
      ) {
        throw new Error(
          "Viewer returned invalid groom file transfer metadata.",
        );
      }
      const chunks = async function* (): AsyncGenerator<Uint8Array> {
        for (let index = 0; index < prepared.chunks; index++) {
          signal.throwIfAborted();
          const encoded = await page.evaluate(
            ({ id, fileIndex, index }) =>
              window.modelViewer.readGroomExportChunk(id, fileIndex, index),
            { id: transfer.id, fileIndex, index },
          );
          const expected = Math.min(
            prepared.chunkSize,
            prepared.byteLength - index * prepared.chunkSize,
          );
          if (
            typeof encoded !== "string" ||
            encoded.length !== Math.ceil(expected / 3) * 4
          ) {
            throw new Error(
              `Groom file ${file.path} chunk ${index} is empty or incomplete.`,
            );
          }
          const bytes = Buffer.from(encoded, "base64");
          if (bytes.byteLength !== expected) {
            throw new Error(
              "Groom transfer chunk has an invalid decoded length.",
            );
          }
          if (index === 0) {
            if (file.kind === "png") {
              if (
                ![137, 80, 78, 71, 13, 10, 26, 10].every((value, at) =>
                  bytes[at] === value
                )
              ) {
                throw new Error("Groom PNG transfer has an invalid header.");
              }
            } else if (bytes[0] !== 123) {
              throw new Error("Groom JSON transfer has an invalid header.");
            }
          }
          yield bytes;
        }
      };
      await writeOutput(resolve(directory, file.path), chunks(), signal);
    }
    return transfer.grooms.map((group) => ({
      ...group,
      directory: resolve(directory, group.directory),
      files: {
        source: resolve(directory, group.files.source),
        manifest: resolve(directory, group.files.manifest),
        coverage: resolve(directory, group.files.coverage),
        normal: resolve(directory, group.files.normal),
        tangent: resolve(directory, group.files.tangent),
        depth: resolve(directory, group.files.depth),
        attributes: resolve(directory, group.files.attributes),
      },
    }));
  } finally {
    if (transfer && typeof transfer.id === "string") {
      await page.evaluate(
        (id) => window.modelViewer.endGroomExport(id),
        transfer.id,
      ).catch(() => {});
    }
  }
}

async function main() {
  const args = parseArgs(Deno.args);
  if (!args) {
    console.log(help);
    return;
  }
  if (args.command === "guide") {
    const guide = (await Promise.all(
      [
        "./docs/agent-guide.md",
        "./docs/new-shapes.md",
        "./docs/strands.md",
        "./docs/hair-cards.md",
        "./docs/grooms.md",
        "./docs/hair-lookdev.md",
        "./docs/rigging.md",
      ]
        .map((path) => Deno.readTextFile(new URL(path, import.meta.url))),
    )).join("\n\n");
    if (args.json) result({ ok: true, command: "guide", guide }, true);
    else console.log(guide.trimEnd());
    return;
  }
  if (args.command === "types") {
    const { emitTypes } = await import("./src/types.ts");
    const report = await emitTypes(args.directory, { force: args.force });
    result({ ok: true, command: "types", ...report }, args.json);
    return;
  }
  const file = resolve(args.file);
  if (args.command === "init") {
    await Deno.mkdir(dirname(file), { recursive: true });
    try {
      await Deno.writeTextFile(file, starter, { createNew: true });
    } catch (error) {
      if (error instanceof Deno.errors.AlreadyExists) {
        throw new Error(`Model already exists: ${file}`);
      }
      throw error;
    }
    result({ ok: true, command: args.command, file, output: file }, args.json);
    return;
  }
  const batch = [
    "inspect",
    "build",
    "screenshot",
    "export",
    "imposter",
    "frames",
  ]
    .includes(
      args.command,
    );
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let viewer: Awaited<ReturnType<typeof launchViewer>> | undefined;
  let stopping = false;
  const cancellation = new AbortController();
  const save = (path: string, data: Uint8Array | string) =>
    writeOutput(path, data, cancellation.signal);
  let completedResult: Record<string, unknown> | undefined;
  const done = Promise.withResolvers<void>();
  const stop = () => done.resolve();
  const signals: Deno.Signal[] = Deno.build.os === "windows"
    ? ["SIGINT"]
    : ["SIGINT", "SIGTERM"];
  for (const signal of signals) Deno.addSignalListener(signal, stop);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const work = async () => {
    server = await startServer(file, args.port);
    if (stopping) {
      await server.close();
      return;
    }
    console.error(`Model workshop: ${server.url}\nWatching ${file}`);
    if (args.command !== "serve") {
      viewer = await launchViewer(server.url, {
        headless: !args.headed,
        renderer: args.renderer,
        width: args.width,
        height: args.height,
        timeout: args.timeout,
      });
      if (stopping) {
        await viewer.browser.close();
        return;
      }
      viewer.browser.on("disconnected", stop);
      viewer.page.on("close", stop);
    }
    if (args.clip && !batch) {
      await waitForModel(viewer!.page, args.timeout);
      await viewer!.page.evaluate(
        ({ clip, time }) => window.modelViewer.sampleAnimation(clip, time),
        { clip: args.clip, time: args.time ?? 0 },
      );
    }
    if (!batch) {
      result({
        ok: true,
        command: args.command,
        file,
        url: server.url,
        headless: args.command === "serve" ? null : !args.headed,
      }, args.json);
      console.error(
        "Ctrl+C to stop. Save the model or its imports to rebuild.",
      );
      await done.promise;
      return;
    }
    await waitForModel(viewer!.page, args.timeout);
    if (args.clip) {
      await viewer!.page.evaluate(
        ({ clip, time }) => window.modelViewer.sampleAnimation(clip, time),
        {
          clip: args.clip,
          time: args.command === "frames" ? args.frames.start : args.time ?? 0,
        },
      );
    }
    if (args.view) {
      await viewer!.page.evaluate(
        (view) => window.modelViewer.setView(view),
        args.view,
      );
    }
    const inspection = await viewer!.page.evaluate(() =>
      window.modelViewer.inspect()
    );
    const base = {
      ok: true,
      command: args.command,
      file,
      headless: !args.headed,
      renderer: viewer!.renderer,
      inspection,
      ...(args.clip
        ? {
          animation: await viewer!.page.evaluate(() =>
            window.modelViewer.animationState()
          ),
        }
        : {}),
    };
    if (args.command === "inspect") {
      completedResult = base;
      return;
    }
    const output = resolve(args.output!);
    const screenshot = () =>
      viewer!.page.locator("canvas").screenshot({
        type: "png",
        timeout: args.timeout,
        style: "#animation { visibility: hidden !important; }",
      });
    if (args.command === "frames") {
      const state = await viewer!.page.evaluate(() => ({
        revision: window.modelViewer.revision,
        animation: window.modelViewer.animationState(),
      }));
      const times = frameTimes(state.animation.duration, args.frames);
      const frames = times.map((time, index) => ({
        index,
        time,
        file: `frame-${String(index).padStart(5, "0")}.png`,
      }));
      const manifestPath = resolve(output, "manifest.json");
      if (
        [manifestPath, ...frames.map((frame) => resolve(output, frame.file))]
          .includes(file)
      ) throw new Error("Frames must not overwrite the model source.");
      for (const frame of frames) {
        cancellation.signal.throwIfAborted();
        await viewer!.page.evaluate(({ clip, time, revision }) => {
          if (
            !window.modelViewer.ready ||
            window.modelViewer.revision !== revision
          ) {
            throw new Error(
              "Model changed during frame capture; retry after the rebuild completes.",
            );
          }
          window.modelViewer.sampleAnimation(clip, time);
        }, { clip: args.clip!, time: frame.time, revision: state.revision });
        const png = await screenshot();
        const current = await viewer!.page.evaluate(() => ({
          ready: window.modelViewer.ready,
          revision: window.modelViewer.revision,
        }));
        if (!current.ready || current.revision !== state.revision) {
          throw new Error(
            "Model changed during frame capture; retry after the rebuild completes.",
          );
        }
        await save(resolve(output, frame.file), png);
      }
      const manifest = {
        version: 1,
        source: file,
        revision: state.revision,
        clip: args.clip,
        clipDuration: state.animation.duration,
        fps: args.frames.fps,
        start: args.frames.start,
        duration: args.frames.duration ??
          state.animation.duration - args.frames.start,
        width: args.width,
        height: args.height,
        frames,
      };
      await save(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
      completedResult = {
        ...base,
        outputs: { directory: output, manifest: manifestPath },
        frames: frames.length,
      };
      return;
    }
    if (args.command === "imposter") {
      const outputs = {
        atlas: resolve(output, "atlas.png"),
        manifest: resolve(output, "manifest.json"),
      };
      if (Object.values(outputs).includes(file)) {
        throw new Error("Imposter output must not overwrite the model source.");
      }
      const capture = await viewer!.page.evaluate(
        (options) => window.modelViewer.captureImposter(options),
        args.imposter,
      );
      cancellation.signal.throwIfAborted();
      await save(
        outputs.atlas,
        Buffer.from(capture.png, "base64"),
      );
      await save(
        outputs.manifest,
        JSON.stringify(capture.manifest, null, 2) + "\n",
      );
      completedResult = {
        ...base,
        outputs,
        coverage: args.imposter.coverage,
        views: args.imposter.grid ** 2,
      };
      return;
    }
    const exportModel = async (path: string) => {
      const extension = extname(path).toLowerCase();
      if (extension === ".glb" || extension === ".blend") {
        if (extension === ".blend") {
          const intermediate = await Deno.makeTempFile({
            prefix: "js3-blend-",
            suffix: ".glb",
          });
          try {
            await writeGLBOutput(
              viewer!.page,
              intermediate,
              cancellation.signal,
            );
            await exportBlend(await Deno.readFile(intermediate), path, {
              signal: cancellation.signal,
              sourceFile: file,
            });
          } finally {
            await Deno.remove(intermediate).catch(() => {});
          }
        } else await writeGLBOutput(viewer!.page, path, cancellation.signal);
      } else {
        await save(
          path,
          await viewer!.page.evaluate(() => window.modelViewer.exportOBJ()),
        );
      }
    };
    if (args.command === "build") {
      const outputs: {
        glb: string;
        preview: string;
        report: string;
        grooms?: GroomExportGroup[];
      } = {
        glb: resolve(output, "model.glb"),
        preview: resolve(output, "preview.png"),
        report: resolve(output, "report.json"),
      };
      if (Object.values(outputs).includes(file)) {
        throw new Error("Build output must not overwrite the model source.");
      }
      await exportModel(outputs.glb);
      await save(outputs.preview, await screenshot());
      const grooms = await writeGroomOutputs(
        viewer!.page,
        output,
        cancellation.signal,
      );
      if (grooms.length) outputs.grooms = grooms;
      const report = { ...base, outputs };
      await save(outputs.report, JSON.stringify(report, null, 2) + "\n");
      cancellation.signal.throwIfAborted();
      completedResult = report;
    } else {
      if (args.command === "screenshot") {
        await save(output, await screenshot());
      } else await exportModel(output);
      cancellation.signal.throwIfAborted();
      completedResult = { ...base, output };
    }
  };
  const task = work();
  try {
    if (batch) {
      await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(`Operation timed out after ${args.timeout} ms.`),
              ),
            args.timeout,
          );
        }),
        done.promise.then(() => {
          throw new Error(
            "Operation interrupted or browser closed before completion.",
          );
        }),
      ]);
    } else await task;
  } finally {
    stopping = true;
    cancellation.abort();
    clearTimeout(timer);
    for (const signal of signals) Deno.removeSignalListener(signal, stop);
    try {
      await viewer?.browser.close();
    } finally {
      try {
        await server?.close();
      } finally {
        await task.catch(() => {});
      }
    }
  }
  if (completedResult) result(completedResult, args.json);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (Deno.args.includes("--json")) {
      console.log(JSON.stringify({ ok: false, error: message }));
    }
    console.error(message);
    Deno.exitCode = 1;
  } finally {
    esbuild.stop();
  }
}
