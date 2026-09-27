import { assert, assertEquals, assertRejects } from "@std/assert";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import * as esbuild from "esbuild";
import { writeGLBOutput } from "../main.ts";
import { startServer } from "../src/server.ts";
import { launchViewer, waitForModel } from "../src/browser.ts";

Deno.test({
  name:
    "GLB chunks reproduce binary exports and preserve existing files on failed transfers",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const directory = await Deno.makeTempDir({
      prefix: "js3-glb-transfer-",
    });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    let viewer: Awaited<ReturnType<typeof launchViewer>> | undefined;
    try {
      const file = `${directory}/model.ts`;
      await Deno.writeTextFile(
        file,
        `import {THREE} from "js3";
export default () => new THREE.Mesh(new THREE.PlaneGeometry(2,2,320,320),
  new THREE.MeshStandardMaterial({color:"#65998a",side:THREE.DoubleSide}));`,
      );
      server = await startServer(file, 0);
      viewer = await launchViewer(server.url, {
        renderer: "software",
        width: 128,
        height: 128,
      });
      await waitForModel(viewer.page);
      const page = viewer.page;
      const output = `${directory}/model.glb`;
      const signal = new AbortController().signal;
      let expected: string;
      const digest = (bytes: Uint8Array) =>
        createHash("sha256").update(bytes).digest("hex");
      await t.step(
        "bounded chunks exactly match the existing public export",
        async () => {
          const transfer = await page.evaluate(() =>
            window.modelViewer.beginGLBExport()
          );
          assert(transfer.chunks >= 2);
          assert(transfer.chunkSize <= 8 * 1024 * 1024);
          await assertRejects(
            () => page.evaluate(() => window.modelViewer.beginGLBExport()),
            Error,
            "already active",
          );
          await assertRejects(
            () =>
              page.evaluate(
                (id) => window.modelViewer.readGLBExportChunk(id, -1),
                transfer.id,
              ),
            Error,
            "out of range",
          );
          await page.evaluate(
            (id) => window.modelViewer.endGLBExport(id),
            transfer.id,
          );
          await assertRejects(
            () =>
              page.evaluate(
                (id) => window.modelViewer.readGLBExportChunk(id, 0),
                transfer.id,
              ),
            Error,
            "expired",
          );
          await writeGLBOutput(page, output, signal);
          const bytes = await Deno.readFile(output);
          const header = new DataView(
            bytes.buffer,
            bytes.byteOffset,
            bytes.byteLength,
          );
          assertEquals(header.getUint32(0, true), 0x46546c67);
          assertEquals(header.getUint32(4, true), 2);
          assertEquals(header.getUint32(8, true), bytes.byteLength);
          assertEquals(bytes.byteLength, transfer.byteLength);
          const encoded = await page.evaluate(() =>
            window.modelViewer.exportGLB()
          );
          expected = await digest(Buffer.from(encoded, "base64"));
          assertEquals(await digest(bytes), expected);
        },
      );
      const originalRead = await page.evaluateHandle(() =>
        window.modelViewer.readGLBExportChunk
      );
      try {
        await t.step(
          "an empty later chunk cannot overwrite a valid output",
          async () => {
            await page.evaluate(() => {
              const read = window.modelViewer.readGLBExportChunk;
              window.modelViewer.readGLBExportChunk = (id, index) =>
                index === 1 ? "" : read(id, index);
            });
            await assertRejects(
              () => writeGLBOutput(page, output, signal),
              Error,
              "empty or incomplete",
            );
            assertEquals(await digest(await Deno.readFile(output)), expected);
            const temporaryFiles = [];
            for await (const entry of Deno.readDir(directory)) {
              if (entry.name.startsWith(".js3-")) {
                temporaryFiles.push(entry.name);
              }
            }
            assertEquals(temporaryFiles, []);
          },
        );
        await page.evaluate((read) => {
          window.modelViewer.readGLBExportChunk = read;
        }, originalRead);
        await t.step(
          "an invalid binary header cannot overwrite a valid output",
          async () => {
            await page.evaluate(() => {
              const read = window.modelViewer.readGLBExportChunk;
              window.modelViewer.readGLBExportChunk = (id, index) => {
                const encoded = read(id, index);
                return index === 0
                  ? btoa("BAD!" + atob(encoded).slice(4))
                  : encoded;
              };
            });
            await assertRejects(
              () => writeGLBOutput(page, output, signal),
              Error,
              "invalid header",
            );
            assertEquals(await digest(await Deno.readFile(output)), expected);
          },
        );
      } finally {
        await page.evaluate((read) => {
          window.modelViewer.readGLBExportChunk = read;
        }, originalRead);
        await originalRead.dispose();
      }
      const originalBegin = await page.evaluateHandle(() =>
        window.modelViewer.beginGLBExport
      );
      try {
        await t.step(
          "empty export metadata fails instead of reporting success",
          async () => {
            await page.evaluate(() => {
              window.modelViewer.beginGLBExport = () =>
                Promise.resolve({
                  id: "failed-export",
                  byteLength: 0,
                  chunkSize: 3 * 1024 * 1024,
                  chunks: 0,
                });
            });
            await assertRejects(
              () => writeGLBOutput(page, output, signal),
              Error,
              "invalid GLB transfer metadata",
            );
            assertEquals(await digest(await Deno.readFile(output)), expected);
          },
        );
      } finally {
        await page.evaluate((begin) => {
          window.modelViewer.beginGLBExport = begin;
        }, originalBegin);
        await originalBegin.dispose();
      }
    } finally {
      await viewer?.browser.close();
      await server?.close();
      esbuild.stop();
      await Deno.remove(directory, { recursive: true });
    }
  },
});
