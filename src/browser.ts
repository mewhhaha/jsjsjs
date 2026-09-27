import { type Browser, chromium, type Page } from "playwright";
import "../web/api.ts";

const pageErrors = new WeakMap<Page, Error>();

export type RendererMode = "auto" | "gpu" | "software";

export async function launchViewer(
  url: string,
  options: {
    headless?: boolean;
    width?: number;
    height?: number;
    renderer?: RendererMode;
    timeout?: number;
  } = {},
): Promise<{ browser: Browser; page: Page; renderer: string }> {
  const mode = options.renderer ?? "auto";
  const headless = options.headless ?? true;
  const browser = await chromium.launch({
    headless,
    timeout: options.timeout,
    // A headless run must not connect to the user's desktop, even when
    // Chromium's GPU process is restarted during renderer fallback.
    ...(headless && Deno.build.os === "linux"
      ? {
        env: { ...Deno.env.toObject(), DISPLAY: "", WAYLAND_DISPLAY: "" },
      }
      : {}),
    args: [
      ...(headless && Deno.build.os === "linux"
        ? ["--ozone-platform=headless"]
        : []),
      ...(mode === "software"
        ? ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]
        : ["--enable-gpu"]),
    ],
  });
  try {
    const page = await browser.newPage({
      viewport: { width: options.width ?? 1280, height: options.height ?? 900 },
      deviceScaleFactor: 1,
    });
    const device = await page.evaluate(() => {
      const gl = document.createElement("canvas").getContext("webgl2", {
        powerPreference: "high-performance",
      });
      if (!gl) return null;
      const extension = gl.getExtension("WEBGL_debug_renderer_info");
      const name = extension
        ? String(gl.getParameter(extension.UNMASKED_RENDERER_WEBGL))
        : "WebGL2";
      gl.getExtension("WEBGL_lose_context")?.loseContext();
      return name;
    });
    if (!device) {
      await browser.close();
      if (mode === "auto") {
        console.error("GPU WebGL is unavailable; using software rendering.");
        return launchViewer(url, { ...options, renderer: "software" });
      }
      throw new Error(
        `No WebGL2 context for ${mode} rendering. Try --software or check the GPU driver.`,
      );
    }
    if (
      mode === "gpu" && /swiftshader|llvmpipe|lavapipe|software/i.test(device)
    ) {
      throw new Error(
        `Hardware rendering requested, but Chromium selected ${device}. Check the GPU driver or use --software.`,
      );
    }
    console.error(`Renderer: ${device}`);
    page.on("pageerror", (error) => {
      pageErrors.set(page, error);
      console.error(`Viewer error: ${error.message}`);
    });
    page.on("console", (message) => {
      if (message.type() === "error") console.error(message.text());
    });
    await page.goto(url, { timeout: options.timeout });
    return { browser, page, renderer: device };
  } catch (error) {
    await browser.close();
    throw error;
  }
}

export async function waitForModel(page: Page, timeout = 30000) {
  if (pageErrors.has(page)) throw pageErrors.get(page);
  const failed = Promise.withResolvers<never>();
  const onError = (error: Error) => failed.reject(error);
  page.on("pageerror", onError);
  try {
    await Promise.race([
      page.waitForFunction(
        () => window.modelViewer?.ready || window.modelViewer?.error,
        undefined,
        { timeout },
      ),
      failed.promise,
    ]);
  } finally {
    page.off("pageerror", onError);
  }
  const error = await page.evaluate(() => window.modelViewer.error);
  if (error) throw new Error(error);
  await page.evaluate(() => window.modelViewer.render());
}
