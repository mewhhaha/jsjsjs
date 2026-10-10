import { extname, resolve } from "node:path";
import type { RendererMode } from "../browser.ts";
import type { ModelView } from "../../web/api.ts";
import {
  type ImposterOptions,
  resolveImposterOptions,
} from "../../web/imposter-layout.ts";

interface CommandSpec {
  /** Arguments shown after the command name in help. */
  synopsis: string;
  summary: string;
  /** local runs in-process, batch renders once, live watches until stopped. */
  mode: "local" | "batch" | "live";
  /** A leading "model" is the TypeScript model file. */
  positionals: readonly string[];
  /** Default for the optional output positional. */
  output?: string;
  extensions?: readonly string[];
  options: readonly string[];
  /** Specific errors for options this command rejects. */
  rejects?: Readonly<Record<string, string>>;
  timeout?: number;
  headed?: boolean;
}

const browser = ["--gpu", "--software", "--headed", "--headless"];
const server = ["--json", "--port", "--timeout"];
const size = ["--width", "--height"];
const animation = ["--clip", "--time"];

const table = {
  guide: {
    synopsis: "",
    summary: "Show this help, setup, and the complete modeling guide",
    mode: "local",
    positionals: [],
    options: ["--json"],
  },
  types: {
    synopsis: "[directory]",
    summary: "Emit portable declarations + tsconfig (.js3)",
    mode: "local",
    positionals: ["directory"],
    output: ".js3",
    options: ["--force", "--json"],
  },
  init: {
    synopsis: "model.ts",
    summary: "Create an editable starter (never overwrites)",
    mode: "local",
    positionals: ["model"],
    options: [...server, ...browser, ...size],
  },
  inspect: {
    synopsis: "model.ts",
    summary: "Validate and report geometry as JSON",
    mode: "batch",
    positionals: ["model"],
    options: [...server, ...browser, ...size, ...animation, "--view"],
  },
  build: {
    synopsis: "model.ts [output/directory]",
    summary: "Write model.glb, preview.png, report.json + groom assets",
    mode: "batch",
    positionals: ["model", "output"],
    output: "output/model",
    options: [...server, ...browser, ...size, ...animation, "--view"],
  },
  screenshot: {
    synopsis: "model.ts [output/model.png]",
    summary: "Render a PNG and exit",
    mode: "batch",
    positionals: ["model", "output"],
    output: "output/model.png",
    extensions: [".png"],
    options: [...server, ...browser, ...size, ...animation, "--view"],
  },
  frames: {
    synopsis: "model.ts [output/directory]",
    summary: "Capture an animation as PNG frames + manifest.json",
    mode: "batch",
    positionals: ["model", "output"],
    output: "output/frames",
    options: [
      ...server,
      ...browser,
      ...size,
      "--clip",
      "--fps",
      "--start",
      "--duration",
      "--view",
    ],
    timeout: 120000,
  },
  imposter: {
    synopsis: "model.ts [output/directory]",
    summary: "Bake octahedral atlas.png and manifest.json",
    mode: "batch",
    positionals: ["model", "output"],
    output: "output/imposter",
    options: [
      ...server,
      ...browser,
      ...animation,
      "--coverage",
      "--grid",
      "--tile-size",
      "--gutter",
      "--padding",
    ],
    rejects: {
      "--view":
        "imposter chooses views from its octahedral grid; --view is not supported.",
      "--width":
        "Use --tile-size for imposter resolution, not --width or --height.",
      "--height":
        "Use --tile-size for imposter resolution, not --width or --height.",
    },
    timeout: 120000,
  },
  export: {
    synopsis: "model.ts [output/model.glb]",
    summary: "Export .glb, .obj, or .blend and exit",
    mode: "batch",
    positionals: ["model", "output"],
    output: "output/model.glb",
    extensions: [".glb", ".obj", ".blend"],
    options: [...server, ...browser, ...size, "--view"],
  },
  headless: {
    synopsis: "model.ts",
    summary: "Watch with a headless browser",
    mode: "live",
    positionals: ["model"],
    options: [
      ...server,
      "--gpu",
      "--software",
      "--headless",
      ...size,
      ...animation,
    ],
    rejects: {
      "--headed":
        "headless cannot be used with --headed. Use open for a visible window.",
    },
  },
  serve: {
    synopsis: "model.ts",
    summary: "Watch with server only; no browser",
    mode: "live",
    positionals: ["model"],
    options: [...server, "--gpu", "--software", ...size],
    rejects: {
      "--headed": "serve does not launch a browser.",
      "--headless": "serve does not launch a browser.",
    },
  },
  open: {
    synopsis: "model.ts",
    summary: "Explicitly open a visible browser",
    mode: "live",
    positionals: ["model"],
    options: [...server, ...browser, ...size, ...animation],
    headed: true,
  },
} satisfies Record<string, CommandSpec>;

export type CommandName = keyof typeof table;
export type ModelCommand = Exclude<CommandName, "guide" | "types">;
export const commands: Readonly<Record<CommandName, CommandSpec>> = table;
const names = Object.keys(commands) as CommandName[];
const modelCommands = names.filter((name) =>
  commands[name].positionals[0] === "model"
) as ModelCommand[];
const defaultTimeout = 30000;
const views = ["iso", "front", "back", "left", "right", "top", "bottom"];

/** Documentation printed by `js3 guide`, in order. */
export const guideDocs = [
  "agent-guide",
  "new-shapes",
  "strands",
  "grooms",
  "rigging",
].map((name) => `docs/${name}.md`);

const longer = modelCommands.filter((name) => commands[name].timeout);
const optionHelp: readonly (readonly [string, string])[] = [
  ["--json", "One JSON result on stdout; diagnostics on stderr"],
  ["--software | --gpu", "CPU rendering or require hardware (default: auto)"],
  ["--width N --height N", "Preview size (default: 1280 × 900)"],
  ["--view VIEW", "iso, front (+Z), back, left, right, top, bottom"],
  ["--clip NAME", "Select an animation (required for frames)"],
  [
    "--time SECONDS",
    "Sample an exact animation time (default 0; requires --clip)",
  ],
  ["--fps N", "Frames per second, up to 240 (frames only; default 24)"],
  ["--start SECONDS", "First frame time (frames only; default 0)"],
  ["--duration SECONDS", "Capture span (frames only; default: rest of clip)"],
  [
    "--coverage 180|360",
    "Imposter: upper hemisphere or full sphere (default 180)",
  ],
  ["--grid N", "Imposter: odd views per side, 3–33 (default 9)"],
  ["--tile-size N", "Imposter: pixels per tile including gutter (default 256)"],
  ["--gutter N", "Imposter: transparent inset per tile edge (default 2)"],
  ["--padding N", "Imposter: framing multiplier, 1–4 (default 1.05)"],
  [
    "--timeout MS",
    `Deadline (default: ${commands[longer[0]].timeout} for ${
      longer.join("/")
    }, otherwise ${defaultTimeout})`,
  ],
  ["--port N", "Local server port (default: free port)"],
  [
    "--headed | --headless",
    "Explicit browser mode (batch defaults to headless)",
  ],
  ["--force", "Replace a generated types bundle (types only)"],
  ["--help", "Show this help"],
];

function columns(rows: readonly (readonly [string, string])[]) {
  const width = Math.max(...rows.map(([left]) => left.length)) + 2;
  return rows.map(([left, right]) => `  ${left.padEnd(width)}${right}`)
    .join("\n");
}

const usage = [
  "js3 <command> <model.ts> [output] [options]",
  ...names.filter((name) => commands[name].positionals[0] !== "model").map((
    name,
  ) =>
    [
      `js3 ${name}`,
      commands[name].synopsis,
      ...commands[name].options.map((option) => `[${option}]`),
    ].filter(Boolean).join(" ")
  ),
  "deno run -A main.ts <command> <model.ts> [output] [options]",
];

export const help = `js3 — build 3D models with TypeScript and Three.js

Usage: ${usage.join("\n       ")}

Commands:
${
  columns(
    names.map((name) =>
      [
        `${name} ${commands[name].synopsis}`.trimEnd(),
        commands[name].summary,
      ] as const
    ),
  )
}

Options:
${columns(optionHelp)}

Model contract: export default a function returning a THREE.Object3D or Promise.
Use named meshes, browser APIs, three/addons imports, and /assets/ for local assets.
Agent loop: init → edit TypeScript → build --json → inspect preview → repeat.
Run just setup once to install Chromium; just install installs the js3 command.
Run js3 guide for setup, examples, options, and troubleshooting.
.blend export requires Blender on PATH (or set JS3_BLENDER to its executable).
`;

export interface ModelArgs {
  command: ModelCommand;
  file: string;
  output?: string;
  port: number;
  width: number;
  height: number;
  timeout: number;
  headed: boolean;
  renderer: RendererMode;
  json: boolean;
  view?: ModelView;
  clip?: string;
  time?: number;
  imposter: ReturnType<typeof resolveImposterOptions>;
  frames: { fps: number; start: number; duration?: number };
}

export type Args =
  | { command: "guide"; json: boolean }
  | { command: "types"; directory: string; json: boolean; force: boolean }
  | ModelArgs;

function rejection(command: ModelCommand, option: string): string {
  const supporting = modelCommands.filter((name) =>
    commands[name].options.includes(option)
  );
  if (!supporting.length) return `Unknown option: ${option}`;
  return commands[command].rejects?.[option] ??
    (option === "--clip"
      ? `--clip is not supported by ${command}; GLB/Blender export includes all clips.`
      : option === "--time"
      ? `--time is not supported by ${command}; use --start for frames.`
      : `${option} is only supported by ${supporting.join(", ")}.`);
}

/** Parse CLI arguments; null means print help. */
export function parseArgs(argv: readonly string[]): Args | null {
  const [name, ...rest] = argv;
  if (name === "guide") {
    const unknown = rest.find((arg) =>
      !["--help", "-h", ...commands.guide.options].includes(arg)
    );
    if (unknown) throw new Error(`Unknown guide argument: ${unknown}`);
    return { command: "guide", json: rest.includes("--json") };
  }
  if (
    !name || name === "help" || argv.includes("--help") || argv.includes("-h")
  ) return null;
  if (!Object.hasOwn(commands, name)) {
    throw new Error(`Unknown command: ${name}`);
  }
  if (name === "types") {
    let directory: string | undefined;
    let pathsOnly = false;
    const flags = new Set<string>();
    for (const arg of rest) {
      if (!pathsOnly && arg === "--") {
        pathsOnly = true;
        continue;
      }
      if (!pathsOnly && arg.startsWith("-")) {
        if (!commands.types.options.includes(arg)) {
          throw new Error(`Unknown types option: ${arg}`);
        }
        flags.add(arg);
        continue;
      }
      if (directory !== undefined) {
        throw new Error("types accepts one output directory.");
      }
      directory = arg;
    }
    return {
      command: "types",
      directory: directory ?? table.types.output,
      json: flags.has("--json"),
      force: flags.has("--force"),
    };
  }
  const command = name as ModelCommand;
  const spec = commands[command];
  const positional: string[] = [];
  const options = {
    port: 0,
    width: 1280,
    height: 900,
    timeout: spec.timeout ?? defaultTimeout,
    headed: spec.headed ?? false,
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
    if (!spec.options.includes(option)) {
      throw new Error(rejection(command, option));
    }
    switch (option) {
      case "--json":
        options.json = true;
        break;
      case "--clip": {
        const name = rest.shift();
        if (!name?.trim() || name.startsWith("--")) {
          throw new Error("--clip requires an animation name.");
        }
        options.clip = name;
        break;
      }
      case "--time":
      case "--fps":
      case "--start":
      case "--duration": {
        const raw = rest.shift(), value = Number(raw);
        if (
          !raw || raw.trim() !== raw || !Number.isFinite(value) || value < 0 ||
          (["--fps", "--duration"].includes(option) && value === 0) ||
          (option === "--fps" && value > 240)
        ) throw new Error(`Invalid value for ${option}`);
        if (option === "--time") options.time = value;
        else {
          options.frames[option.slice(2) as "fps" | "start" | "duration"] =
            value;
        }
        break;
      }
      case "--gpu":
      case "--software":
        if (rendererMode && rendererMode !== option) {
          throw new Error("Choose either --gpu or --software.");
        }
        rendererMode = option;
        options.renderer = option === "--gpu" ? "gpu" : "software";
        break;
      case "--headed":
      case "--headless":
        if (browserMode && browserMode !== option) {
          throw new Error("Choose either --headed or --headless.");
        }
        browserMode = option;
        options.headed = option === "--headed";
        break;
      case "--view": {
        const value = rest.shift();
        if (!views.includes(value!)) {
          throw new Error(`Invalid --view; choose ${views.join(", ")}.`);
        }
        options.view = value as ModelView;
        break;
      }
      case "--coverage":
      case "--grid":
      case "--tile-size":
      case "--gutter":
      case "--padding": {
        const raw = rest.shift();
        const value = Number(raw);
        if (!raw || !Number.isFinite(value) || raw.trim() !== raw) {
          throw new Error(`Invalid value for ${option}`);
        }
        const key = option === "--tile-size" ? "tileSize" : option.slice(2);
        Object.assign(options.imposter, { [key]: value });
        break;
      }
      default: {
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
        options[option.slice(2) as "port" | "width" | "height" | "timeout"] =
          value;
      }
    }
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
  if (positional.length > spec.positionals.length) {
    throw new Error(`Too many arguments for ${command}.`);
  }
  const output = spec.output === undefined
    ? undefined
    : suppliedOutput ?? spec.output;
  if (
    output && spec.extensions &&
    !spec.extensions.includes(extname(output).toLowerCase())
  ) {
    throw new Error(
      `${command[0].toUpperCase()}${command.slice(1)} output must end in ${
        new Intl.ListFormat("en", { type: "disjunction" }).format(
          spec.extensions,
        )
      }.`,
    );
  }
  if (output && resolve(output) === resolve(file)) {
    throw new Error("Output must not overwrite the model source.");
  }
  return {
    command,
    file,
    output,
    ...options,
    imposter: resolveImposterOptions(options.imposter),
  };
}
