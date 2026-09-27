import * as esbuild from "esbuild";
import { createRequire } from "node:module";
import { basename, dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const require = createRequire(import.meta.url);
export interface BuildState {
  revision: number;
  error: string | null;
}

// A single Three.js instance is shared by the viewer and all model bundles.
const sharedThree: esbuild.Plugin = {
  name: "shared-three",
  setup(build) {
    build.onResolve(
      { filter: /^manifold-3d$/ },
      () => ({ path: "manifold-3d", external: true }),
    );
    // Model helpers resolve from the CLI checkout, even for external models.
    build.onResolve(
      { filter: /^(?:js3|threejs)(?:\/(?:prelude|api))?$/ },
      (args) => ({
        path: resolve(
          root,
          args.path.endsWith("/api") ? "web/api.ts" : "src/prelude.ts",
        ),
      }),
    );
    build.onResolve(
      { filter: /^three$/ },
      () => ({ path: "three", external: true }),
    );
    // Resolve addons from this project even when the model lives elsewhere.
    build.onResolve(
      { filter: /^three\// },
      (args) => ({ path: require.resolve(args.path) }),
    );
  },
};
const options: esbuild.BuildOptions = {
  bundle: true,
  write: false,
  format: "esm",
  platform: "browser",
  target: "es2022",
  sourcemap: "inline",
  logLevel: "silent",
  absWorkingDir: root,
};

export async function startServer(filename: string, port = 8000) {
  const file = resolve(filename);
  if (!(await Deno.stat(file)).isFile) {
    throw new Error(`Not a model file: ${file}`);
  }
  const state: BuildState = { revision: 0, error: null };
  let modelJS = "";
  const listeners = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const encoder = new TextEncoder();
  const publish = () => {
    const event = encoder.encode(`data: ${JSON.stringify(state)}\n\n`);
    for (const listener of listeners) {
      try {
        listener.enqueue(event);
      } catch {
        listeners.delete(listener);
      }
    }
  };
  const context = await esbuild.context({
    ...options,
    entryPoints: [file],
    plugins: [sharedThree, {
      name: "model-reload",
      setup(build) {
        build.onEnd(async (result) => {
          if (result.errors.length) {
            state.error = (await esbuild.formatMessages(result.errors, {
              kind: "error",
              color: false,
            })).join("\n");
            console.error(state.error);
          } else {
            modelJS = result.outputFiles![0].text;
            state.revision++;
            state.error = null;
            console.error(`Model built · revision ${state.revision}`);
          }
          publish();
        });
      },
    }],
  });
  try {
    const [viewer, three, html] = await Promise.all([
      esbuild.build({
        ...options,
        entryPoints: [resolve(root, "web/viewer.ts")],
        plugins: [sharedThree],
      }),
      esbuild.build({
        ...options,
        stdin: { contents: 'export * from "three";', resolveDir: root },
      }),
      Deno.readTextFile(resolve(root, "web/index.html")),
    ]);
    // A broken initial model still gets a working viewer and file watcher.
    await context.rebuild().catch(() => {});
    await context.watch();
    const abort = new AbortController();
    const server = Deno.serve({
      hostname: "127.0.0.1",
      port,
      signal: abort.signal,
      onListen() {},
    }, async (req) => {
      const url = new URL(req.url);
      const headers = { "cache-control": "no-store" };
      const js = (body: string) =>
        new Response(body, {
          headers: { ...headers, "content-type": "text/javascript" },
        });
      if (req.method !== "GET") {
        return new Response("Method not allowed", { status: 405 });
      }
      switch (url.pathname) {
        case "/":
          return new Response(html, {
            headers: { ...headers, "content-type": "text/html; charset=utf-8" },
          });
        case "/viewer.js":
          return js(viewer.outputFiles![0].text);
        case "/three.js":
          return js(three.outputFiles![0].text);
        case "/_js3/manifold.js":
          return js(
            await Deno.readTextFile(require.resolve("manifold-3d/manifold.js")),
          );
        case "/_js3/manifold.wasm":
          return new Response(
            await Deno.readFile(require.resolve("manifold-3d/manifold.wasm")),
            {
              headers: { ...headers, "content-type": "application/wasm" },
            },
          );
        case "/model.js":
          return modelJS
            ? js(modelJS)
            : new Response(state.error, { status: 503 });
        case "/meta":
          return Response.json({ filename: basename(file), ...state }, {
            headers,
          });
        case "/events": {
          let listener: ReadableStreamDefaultController<Uint8Array>;
          const stream = new ReadableStream<Uint8Array>({
            start(controller) {
              listener = controller;
              listeners.add(controller);
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify(state)}\n\n`),
              );
            },
            cancel() {
              listeners.delete(listener);
            },
          });
          return new Response(stream, {
            headers: { ...headers, "content-type": "text/event-stream" },
          });
        }
        case "/favicon.ico":
          return new Response(null, { status: 204 });
        default: {
          // Model-local textures and assets are available under /assets/.
          if (!url.pathname.startsWith("/assets/")) {
            return new Response("Not found", { status: 404 });
          }
          try {
            const assetRoot = await Deno.realPath(dirname(file));
            const asset = await Deno.realPath(
              resolve(assetRoot, decodeURIComponent(url.pathname.slice(8))),
            );
            const rel = relative(assetRoot, asset);
            if (rel.startsWith("..") || isAbsolute(rel)) {
              return new Response("Forbidden", { status: 403 });
            }
            return new Response(await Deno.readFile(asset), { headers });
          } catch {
            return new Response("Not found", { status: 404 });
          }
        }
      }
    });
    return {
      url: `http://127.0.0.1:${server.addr.port}`,
      state,
      async close() {
        for (const listener of listeners) {
          try {
            listener.close();
          } catch { /* already disconnected */ }
        }
        listeners.clear();
        abort.abort();
        await server.finished;
        await context.dispose();
      },
    };
  } catch (error) {
    await context.dispose();
    throw error;
  }
}
