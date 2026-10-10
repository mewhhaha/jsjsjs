import * as esbuild from "esbuild";
import { join, resolve } from "node:path";
import { type Browser, chromium, type Page } from "playwright";
import { blenderAvailable as blenderStarts } from "../src/blender.ts";
import { launchViewer, waitForModel } from "../src/browser.ts";
import { type ModelServer, startServer } from "../src/server.ts";

// Test files run in separate isolates but share the process environment, so
// each notice prints once per run.
function skipping(kind: string, reason: string) {
  const key = `JS3_SKIP_NOTICE_${kind.toUpperCase()}`;
  if (Deno.env.get(key)) return;
  Deno.env.set(key, "1");
  console.error(`Skipping ${kind} tests: ${reason}`);
}

function chromiumInstalled() {
  if (Deno.env.get("JS3_SKIP_BROWSER") === "1") {
    skipping("browser", "JS3_SKIP_BROWSER=1.");
    return false;
  }
  try {
    if (Deno.statSync(chromium.executablePath()).isFile) return true;
  } catch { /* not installed */ }
  skipping("browser", "Chromium is not installed; run `deno task setup`.");
  return false;
}

/** Playwright's Chromium is installed and JS3_SKIP_BROWSER is not 1. */
export const chromiumAvailable = chromiumInstalled();

/** Blender starts and JS3_SKIP_BLENDER is not 1. */
export function blenderAvailable(): boolean {
  if (Deno.env.get("JS3_SKIP_BLENDER") === "1") {
    skipping("Blender", "JS3_SKIP_BLENDER=1.");
    return false;
  }
  if (blenderStarts()) return true;
  skipping("Blender", "Blender is not installed.");
  return false;
}

interface Viewer {
  page: Page;
  server: ModelServer;
  /** A temporary directory, removed afterwards; inline models live here. */
  dir: string;
  file: string;
  /** Console errors logged since the page loaded. */
  errors: string[];
}

/**
 * Serve a model, inline source or an existing file, in headless Chromium,
 * wait for it to build, then run `fn`. Everything is closed and removed after.
 */
export async function withViewer(
  model: string | { file: string },
  fn: (viewer: Viewer) => Promise<void>,
  options: Parameters<typeof launchViewer>[1] & {
    prefix?: string;
    name?: string;
  } = {},
): Promise<void> {
  const { prefix = "js3-viewer-", name = "model.ts", ...launch } = options;
  const timeout = launch.timeout ?? 60_000;
  const dir = await Deno.makeTempDir({ prefix });
  let server: ModelServer | undefined;
  let browser: Browser | undefined;
  try {
    const file = typeof model === "string"
      ? join(dir, name)
      : resolve(model.file);
    if (typeof model === "string") await Deno.writeTextFile(file, model);
    server = await startServer(file, 0);
    const viewer = await launchViewer(server.url, {
      renderer: "software",
      ...launch,
      timeout,
    });
    browser = viewer.browser;
    const errors: string[] = [];
    viewer.page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });
    await waitForModel(viewer.page, timeout);
    await fn({ page: viewer.page, server, dir, file, errors });
  } finally {
    await browser?.close();
    await server?.close();
    esbuild.stop();
    await Deno.remove(dir, { recursive: true });
  }
}
