import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import * as esbuild from "esbuild";
import { parseArgs } from "../main.ts";
import { startServer } from "../src/server.ts";
import { launchViewer, waitForModel } from "../src/browser.ts";

Deno.test("CLI accepts quoted paths and validates options", () => {
  const args = parseArgs([
    "screenshot",
    "/tmp/a model.ts",
    "/tmp/a model.png",
    "--width",
    "1600",
    "--headed",
  ]);
  assert(args?.command === "screenshot");
  assertEquals(args.file, "/tmp/a model.ts");
  assertEquals(args.output, "/tmp/a model.png");
  assertEquals(args.width, 1600);
  assertEquals(args.headed, true);
  assertThrows(() => parseArgs(["open", "model.ts", "--port", "oops"]));
  assertThrows(() => parseArgs(["open", "model.ts", "--width", "0"]));
  assertThrows(() => parseArgs(["open"]));
});

Deno.test({
  name:
    "real browser: external TS, dependent imports, OBJ, PNG, hot reload and error recovery",
  sanitizeOps: false, // esbuild's shared service owns process pipes until stop().
  sanitizeResources: false,
  async fn(t) {
    const directory = await Deno.makeTempDir({ prefix: "model workshop " });
    const file = `${directory}/a model.ts`;
    const helper = `${directory}/dimensions.ts`;
    const source = `import * as THREE from "three";
import { size } from "./dimensions.ts";
export default async function buildModel() {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, 2, 3), new THREE.MeshStandardMaterial({color: "#b9db90"}));
  mesh.name = "test_box";
  mesh.position.x = 4;
  return mesh;
}`;
    await Deno.writeTextFile(helper, "export const size = 1;");
    await Deno.writeTextFile(file, "export default function (");
    const server = await startServer(file, 0);
    const { browser, page } = await launchViewer(server.url);
    try {
      await t.step(
        "a broken initial model can be fixed without restarting",
        async () => {
          await assertRejects(() => waitForModel(page));
          await Deno.writeTextFile(file, source);
          await page.waitForFunction(() =>
            window.modelViewer.ready && !window.modelViewer.error
          );
        },
      );
      await t.step(
        "exports transformed model geometry without the viewer grid",
        async () => {
          await waitForModel(page);
          const obj = await page.evaluate(() => window.modelViewer.exportOBJ());
          assert(obj.includes("o test_box"));
          assertEquals(
            obj.split("\n").filter((line) => line.startsWith("f ")).length,
            12,
          );
          assert(!obj.split("\n").some((line) => line.startsWith("l ")));
          const xs = obj.split("\n").filter((line) => line.startsWith("v "))
            .map((line) => Number(line.split(" ")[1]));
          assertEquals(Math.min(...xs), 3.5);
          assertEquals(Math.max(...xs), 4.5);
          const image = await page.locator("canvas").screenshot();
          assertEquals(Array.from(image.subarray(0, 8)), [
            137,
            80,
            78,
            71,
            13,
            10,
            26,
            10,
          ]);
          assert(image.length > 10000);
        },
      );
      await t.step("camera position survives a rebuild", async () => {
        const box = (await page.locator("canvas").boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        await page.mouse.down({ button: "middle" });
        await page.mouse.move(
          box.x + box.width / 2 + 100,
          box.y + box.height / 2 + 40,
          { steps: 8 },
        );
        await page.mouse.up({ button: "middle" });
        await page.waitForFunction(() =>
          document.querySelector("canvas")!.width === 1280
        );
        const before = await page.locator("canvas").screenshot();
        const revision = await page.evaluate(() => window.modelViewer.revision);
        await Deno.writeTextFile(
          file,
          source + "\n// Rebuild with identical geometry.",
        );
        await page.waitForFunction(
          (previous) =>
            window.modelViewer.ready && window.modelViewer.revision > previous,
          revision,
        );
        assertEquals(await page.locator("canvas").screenshot(), before);
      });
      await t.step(
        "relative dependency edits reload without a page navigation",
        async () => {
          const revision = await page.evaluate(() =>
            window.modelViewer.revision
          );
          const timeOrigin = await page.evaluate(() => performance.timeOrigin);
          await Deno.writeTextFile(helper, "export const size = 3;");
          await page.waitForFunction(
            (previous) =>
              window.modelViewer.ready &&
              window.modelViewer.revision > previous,
            revision,
          );
          assertEquals(
            await page.evaluate(() => performance.timeOrigin),
            timeOrigin,
          );
          const obj = await page.evaluate(() => window.modelViewer.exportOBJ());
          assert(obj.includes("v 2.5 "));
          assert(obj.includes("v 5.5 "));
        },
      );
      await t.step(
        "syntax errors preserve the last model and recover",
        async () => {
          const previous = await page.evaluate(() =>
            window.modelViewer.exportOBJ()
          );
          await Deno.writeTextFile(file, "export default function (");
          await page.waitForFunction(() => !!window.modelViewer.error);
          assertEquals(
            await page.evaluate(() => window.modelViewer.exportOBJ()),
            previous,
          );
          await assertRejects(() => waitForModel(page));
          await Deno.writeTextFile(file, source);
          await page.waitForFunction(() =>
            window.modelViewer.ready && !window.modelViewer.error
          );
        },
      );
      await t.step("runtime errors recover after an edit", async () => {
        await Deno.writeTextFile(
          file,
          'export default () => { throw new Error("intentional failure") };',
        );
        await page.waitForFunction(() =>
          window.modelViewer.error?.includes("intentional failure")
        );
        await Deno.writeTextFile(file, source);
        await page.waitForFunction(() =>
          window.modelViewer.ready && !window.modelViewer.error
        );
      });
      await t.step(
        "asset serving rejects symlinks outside the model directory",
        async () => {
          await Deno.writeTextFile(`${directory}/allowed.txt`, "local asset");
          assertEquals(
            await (await fetch(`${server.url}/assets/allowed.txt`)).text(),
            "local asset",
          );
          await Deno.symlink("/etc/hostname", `${directory}/outside.txt`);
          const response = await fetch(`${server.url}/assets/outside.txt`);
          await response.body?.cancel();
          assertEquals(response.status, 403);
        },
      );
    } finally {
      await browser.close();
      await server.close();
      esbuild.stop();
      await Deno.remove(directory, { recursive: true });
    }
  },
});
