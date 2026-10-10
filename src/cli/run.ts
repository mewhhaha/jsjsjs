import { dirname, extname, resolve } from "node:path";
import { Buffer } from "node:buffer";
import { type ModelServer, startServer } from "../server.ts";
import { exportBlend } from "../blender.ts";
import { frameTimes } from "../frame-times.ts";
import { launchViewer, waitForModel } from "../browser.ts";
import type { GroomExportGroup } from "../../web/api.ts";
import {
  commands,
  guideDocs,
  help,
  type ModelArgs,
  type ModelCommand,
  parseArgs,
} from "./args.ts";
import { receiveGLB, receiveGrooms, writeOutput } from "./output.ts";

type Viewer = Awaited<ReturnType<typeof launchViewer>>;
type BatchCommand = Exclude<
  ModelCommand,
  "init" | "inspect" | "headless" | "serve" | "open"
>;
type Report = Record<string, unknown>;

interface Session {
  args: ModelArgs;
  file: string;
  server: ModelServer;
  /** Absent only for serve. */
  viewer?: Viewer;
  signal: AbortSignal;
  /** Settles on Ctrl+C, SIGTERM, or when the browser closes. */
  stopped: Promise<void>;
}

interface Batch extends Session {
  viewer: Viewer;
  output: string;
  save(path: string, data: Uint8Array | string): Promise<void>;
  screenshot(): Promise<Uint8Array>;
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

function result(value: Report, json: boolean) {
  if (json) console.log(JSON.stringify(value));
  else if (value.command === "inspect") {
    console.log(JSON.stringify(value, null, 2));
  } else {
    console.log(
      value.output ? `Saved ${value.output}` : JSON.stringify(value, null, 2),
    );
  }
}

export async function main(argv: readonly string[]) {
  const args = parseArgs(argv);
  if (!args) {
    console.log(help);
    return;
  }
  if (args.command === "guide") {
    const docs = await Promise.all(
      guideDocs.map((path) =>
        Deno.readTextFile(new URL(`../../${path}`, import.meta.url))
      ),
    );
    const guide = [help, ...docs].map((text) => text.trimEnd()).join("\n\n");
    if (args.json) result({ ok: true, command: "guide", guide }, true);
    else console.log(guide);
    return;
  }
  if (args.command === "types") {
    const { emitTypes } = await import("../types.ts");
    const report = await emitTypes(args.directory, { force: args.force });
    result({ ok: true, command: "types", ...report }, args.json);
    return;
  }
  if (args.command === "init") {
    const file = resolve(args.file);
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
  if (commands[args.command].mode === "live") {
    await session(args, live);
    return;
  }
  const report = await session(args, batch);
  if (report) result(report, args.json);
}

/**
 * Serve the model and launch its browser, then run `work`. Batch work races
 * the deadline and interruption; everything is closed before returning.
 */
async function session<T>(
  args: ModelArgs,
  work: (session: Session) => Promise<T>,
): Promise<T | undefined> {
  const file = resolve(args.file);
  const deadline = commands[args.command].mode === "batch";
  const cancellation = new AbortController();
  const signal = cancellation.signal;
  const done = Promise.withResolvers<void>();
  const stop = () => done.resolve();
  const signals: Deno.Signal[] = Deno.build.os === "windows"
    ? ["SIGINT"]
    : ["SIGINT", "SIGTERM"];
  for (const name of signals) Deno.addSignalListener(name, stop);
  let server: ModelServer | undefined;
  let viewer: Viewer | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const task = (async () => {
    server = await startServer(file, args.port);
    if (signal.aborted) {
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
      if (signal.aborted) {
        await viewer.browser.close();
        return;
      }
      viewer.browser.on("disconnected", stop);
      viewer.page.on("close", stop);
    }
    return await work({
      args,
      file,
      server,
      viewer,
      signal,
      stopped: done.promise,
    });
  })();
  try {
    if (!deadline) return await task;
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () =>
            reject(new Error(`Operation timed out after ${args.timeout} ms.`)),
          args.timeout,
        );
      }),
      done.promise.then(() => {
        throw new Error(
          "Operation interrupted or browser closed before completion.",
        );
      }),
    ]);
  } finally {
    cancellation.abort();
    clearTimeout(timer);
    for (const name of signals) Deno.removeSignalListener(name, stop);
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
}

async function live({ args, file, server, viewer, stopped }: Session) {
  if (args.clip) {
    await waitForModel(viewer!.page, args.timeout);
    await viewer!.page.evaluate(
      ({ clip, time }) => window.modelViewer.sampleAnimation(clip, time),
      { clip: args.clip, time: args.time ?? 0 },
    );
  }
  result({
    ok: true,
    command: args.command,
    file,
    url: server.url,
    headless: viewer ? !args.headed : null,
  }, args.json);
  console.error("Ctrl+C to stop. Save the model or its imports to rebuild.");
  await stopped;
}

/** Render once, then write the command's outputs. */
async function batch(session: Session): Promise<Report> {
  const { args, file, signal } = session;
  const viewer = session.viewer!;
  const page = viewer.page;
  await waitForModel(page, args.timeout);
  if (args.clip) {
    await page.evaluate(
      ({ clip, time }) => window.modelViewer.sampleAnimation(clip, time),
      {
        clip: args.clip,
        time: args.command === "frames" ? args.frames.start : args.time ?? 0,
      },
    );
  }
  if (args.view) {
    await page.evaluate((view) => window.modelViewer.setView(view), args.view);
  }
  const base: Report = {
    ok: true,
    command: args.command,
    file,
    headless: !args.headed,
    renderer: viewer.renderer,
    inspection: await page.evaluate(() => window.modelViewer.inspect()),
    ...(args.clip
      ? {
        animation: await page.evaluate(() =>
          window.modelViewer.animationState()
        ),
      }
      : {}),
  };
  if (args.command === "inspect") return base;
  return await handlers[args.command as BatchCommand]({
    ...session,
    viewer,
    output: resolve(args.output!),
    save: (path, data) => writeOutput(path, data, signal),
    screenshot: () =>
      page.locator("canvas").screenshot({
        type: "png",
        timeout: args.timeout,
        style: "#animation { visibility: hidden !important; }",
      }),
  }, base);
}

/** Write .glb, .obj, or .blend, chosen by extension. */
async function exportModel(context: Batch, path: string) {
  const { server, viewer, signal, file } = context;
  const extension = extname(path).toLowerCase();
  if (extension === ".obj") {
    await context.save(
      path,
      await viewer.page.evaluate(() => window.modelViewer.exportOBJ()),
    );
  } else if (extension === ".blend") {
    const intermediate = await Deno.makeTempFile({
      prefix: "js3-blend-",
      suffix: ".glb",
    });
    try {
      await receiveGLB(server, viewer.page, intermediate, signal);
      await exportBlend(await Deno.readFile(intermediate), path, {
        signal,
        sourceFile: file,
      });
    } finally {
      await Deno.remove(intermediate).catch(() => {});
    }
  } else await receiveGLB(server, viewer.page, path, signal);
}

const handlers: Record<
  BatchCommand,
  (context: Batch, base: Report) => Promise<Report>
> = {
  async build(context, base) {
    const { file, output, server, viewer, signal } = context;
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
    await exportModel(context, outputs.glb);
    await context.save(outputs.preview, await context.screenshot());
    const grooms = await receiveGrooms(server, viewer.page, output, signal);
    if (grooms.length) outputs.grooms = grooms;
    const report = { ...base, outputs };
    await context.save(outputs.report, JSON.stringify(report, null, 2) + "\n");
    signal.throwIfAborted();
    return report;
  },
  async screenshot(context, base) {
    await context.save(context.output, await context.screenshot());
    context.signal.throwIfAborted();
    return { ...base, output: context.output };
  },
  async export(context, base) {
    await exportModel(context, context.output);
    context.signal.throwIfAborted();
    return { ...base, output: context.output };
  },
  async imposter(context, base) {
    const { args, file, output, viewer, signal } = context;
    const outputs = {
      atlas: resolve(output, "atlas.png"),
      manifest: resolve(output, "manifest.json"),
    };
    if (Object.values(outputs).includes(file)) {
      throw new Error("Imposter output must not overwrite the model source.");
    }
    const capture = await viewer.page.evaluate(
      (options) => window.modelViewer.captureImposter(options),
      args.imposter,
    );
    signal.throwIfAborted();
    await context.save(outputs.atlas, Buffer.from(capture.png, "base64"));
    await context.save(
      outputs.manifest,
      JSON.stringify(capture.manifest, null, 2) + "\n",
    );
    return {
      ...base,
      outputs,
      coverage: args.imposter.coverage,
      views: args.imposter.grid ** 2,
    };
  },
  async frames(context, base) {
    const { args, file, output, viewer, signal } = context;
    const page = viewer.page;
    const state = await page.evaluate(() => ({
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
    const changed =
      "Model changed during frame capture; retry after the rebuild completes.";
    for (const frame of frames) {
      signal.throwIfAborted();
      await page.evaluate(({ clip, time, revision, changed }) => {
        if (
          !window.modelViewer.ready || window.modelViewer.revision !== revision
        ) throw new Error(changed);
        window.modelViewer.sampleAnimation(clip, time);
      }, {
        clip: args.clip!,
        time: frame.time,
        revision: state.revision,
        changed,
      });
      const png = await context.screenshot();
      const current = await page.evaluate(() => ({
        ready: window.modelViewer.ready,
        revision: window.modelViewer.revision,
      }));
      if (!current.ready || current.revision !== state.revision) {
        throw new Error(changed);
      }
      await context.save(resolve(output, frame.file), png);
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
    await context.save(manifestPath, JSON.stringify(manifest, null, 2) + "\n");
    return {
      ...base,
      outputs: { directory: output, manifest: manifestPath },
      frames: frames.length,
    };
  },
};
