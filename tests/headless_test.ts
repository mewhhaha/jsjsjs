import { assert, assertEquals } from "@std/assert";
import { chromiumAvailable } from "./support.ts";

Deno.test({
  name: "headless Chromium renders WebGL without a desktop display",
  ignore: !chromiumAvailable,
  async fn() {
    const browserModule = new URL("../src/browser.ts", import.meta.url).href;
    const source = `
    import { launchViewer } from ${JSON.stringify(browserModule)};
    const { browser, renderer } = await launchViewer("about:blank", {
      renderer: "software",
      timeout: 15000,
    });
    try {
      if (!renderer) throw new Error("No WebGL renderer");
    } finally {
      await browser.close();
    }
  `;
    const result = await new Deno.Command(Deno.execPath(), {
      args: ["eval", "-A", source],
      cwd: new URL("..", import.meta.url).pathname,
      env: {
        DISPLAY: ":no-such-display",
        WAYLAND_DISPLAY: "no-such-display",
        DEBUG: "pw:browser",
      },
      stdout: "piped",
      stderr: "piped",
    }).output();
    const decoder = new TextDecoder();
    const stderr = decoder.decode(result.stderr);
    assertEquals(result.code, 0, stderr);
    assert(stderr.includes("--headless"), stderr);
    if (Deno.build.os === "linux") {
      assert(stderr.includes("--ozone-platform=headless"), stderr);
    }
    assert(stderr.includes("Renderer:"), stderr);
    assertEquals(decoder.decode(result.stdout), "");
  },
});
