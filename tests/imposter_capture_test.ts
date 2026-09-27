import { assert, assertEquals } from "@std/assert";
import * as esbuild from "esbuild";
import { startServer } from "../src/server.ts";
import { launchViewer, waitForModel } from "../src/browser.ts";

Deno.test({
  name:
    "imposter captures transparent lit 180/360 atlases without changing the viewer",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const directory = await Deno.makeTempDir({ prefix: "js3-imposter-" });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    let viewer: Awaited<ReturnType<typeof launchViewer>> | undefined;
    try {
      const source = `import * as THREE from "three";
export default function () {
  const red = new THREE.MeshStandardMaterial({ color: 0xff0000 });
  const green = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
  const blue = new THREE.MeshStandardMaterial({ color: 0x0000ff });
  const box = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2), [red, red, green, blue, red, red]);
  const model = new THREE.Group();
  model.name = "offset model";
  model.position.set(4, 2, -3);
  model.add(box);
  return model;
}`;
      const file = `${directory}/model.ts`;
      await Deno.writeTextFile(file, source);
      server = await startServer(file, 0);
      viewer = await launchViewer(server.url, { renderer: "software" });
      await waitForModel(viewer.page);
      const before = await viewer.page.evaluate(() => {
        window.modelViewer.setView("left");
        window.modelViewer.render();
        return {
          inspection: window.modelViewer.inspect(),
          screenshot: document.querySelector("canvas")!.toDataURL(),
        };
      });
      for (const coverage of [180, 360] as const) {
        const capture = await viewer.page.evaluate(async (coverage) => {
          const result = await window.modelViewer.captureImposter({
            coverage,
            grid: 3,
            tileSize: 64,
            gutter: 3,
          });
          const blob =
            await (await fetch(`data:image/png;base64,${result.png}`)).blob();
          const bitmap = await createImageBitmap(blob);
          const canvas = document.createElement("canvas");
          canvas.width = bitmap.width;
          canvas.height = bitmap.height;
          const context = canvas.getContext("2d")!;
          context.drawImage(bitmap, 0, 0);
          bitmap.close();
          const pixels =
            context.getImageData(0, 0, canvas.width, canvas.height).data;
          const tiles = result.manifest.tiles.map((tile) => {
            let gutterAlpha = 0;
            let opaquePixels = 0;
            const center = [
              tile.rect.x + tile.rect.width / 2,
              tile.rect.y + tile.rect.height / 2,
            ];
            for (let y = tile.rect.y; y < tile.rect.y + tile.rect.height; y++) {
              for (
                let x = tile.rect.x;
                x < tile.rect.x + tile.rect.width;
                x++
              ) {
                const alpha = pixels[(y * canvas.width + x) * 4 + 3];
                if (
                  x < tile.contentRect.x || y < tile.contentRect.y ||
                  x >= tile.contentRect.x + tile.contentRect.width ||
                  y >= tile.contentRect.y + tile.contentRect.height
                ) gutterAlpha += alpha;
                if (alpha === 255) opaquePixels++;
              }
            }
            const index = (center[1] * canvas.width + center[0]) * 4;
            return {
              direction: tile.direction,
              centerColor: Array.from(pixels.slice(index, index + 4)),
              gutterAlpha,
              opaquePixels,
            };
          });
          return { manifest: result.manifest, tiles };
        }, coverage);
        assertEquals(capture.manifest.center, [4, 2, -3]);
        assertEquals(capture.manifest.atlas.width, 192);
        assertEquals(capture.manifest.atlas.height, 192);
        assertEquals(capture.tiles.length, 9);
        for (const tile of capture.tiles) {
          assertEquals(tile.gutterAlpha, 0);
          assert(tile.opaquePixels > 100, "every camera should see the model");
          assertEquals(tile.centerColor[3], 255);
          const [red, green, blue] = tile.centerColor;
          if (tile.direction[1] === 1) {
            assert(
              green > red && green > blue,
              "top capture sees the green face",
            );
          } else if (tile.direction[1] === -1) {
            assertEquals(coverage, 360);
            assert(
              blue > red && blue > green,
              "bottom capture sees the blue face",
            );
          } else {
            assert(
              red > green && red > blue,
              "horizon capture sees a red side",
            );
          }
        }
        assertEquals(
          capture.tiles.some((tile) => tile.direction[1] < 0),
          coverage === 360,
        );
      }
      const after = await viewer.page.evaluate(() => {
        window.modelViewer.render();
        return {
          inspection: window.modelViewer.inspect(),
          screenshot: document.querySelector("canvas")!.toDataURL(),
        };
      });
      assertEquals(
        after,
        before,
        "capture preserves the model, camera, background, and grid",
      );
    } finally {
      await viewer?.browser.close();
      await server?.close();
      esbuild.stop();
      await Deno.remove(directory, { recursive: true });
    }
  },
});
