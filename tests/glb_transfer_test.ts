import { assert, assertEquals, assertRejects } from "@std/assert";
import { Buffer } from "node:buffer";
import { createHash } from "node:crypto";
import { receiveGLB } from "../src/cli/output.ts";
import { chromiumAvailable, withViewer } from "./support.ts";

declare global {
  interface Window {
    uploadURL?: string;
    exportedGLB?: string;
  }
}

const digest = (bytes: Uint8Array) =>
  createHash("sha256").update(bytes).digest("hex");

async function until(condition: () => Promise<boolean>) {
  while (!(await condition())) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

Deno.test({
  name:
    "GLB uploads reproduce binary exports and preserve existing files on failed transfers",
  ignore: !chromiumAvailable,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    await withViewer(
      `import {THREE} from "js3";
export default () => new THREE.Mesh(new THREE.PlaneGeometry(2,2,160,160),
  new THREE.MeshStandardMaterial({color:"#65998a",side:THREE.DoubleSide}));`,
      async ({ page, server, dir: directory }) => {
        const output = `${directory}/model.glb`;
        const signal = new AbortController().signal;
        const temporaries = async () => {
          const names = [];
          for await (const entry of Deno.readDir(directory)) {
            if (entry.name.startsWith(".js3-")) names.push(entry.name);
          }
          return names;
        };
        const uploadGLB = await page.evaluateHandle(() =>
          window.modelViewer.uploadGLB
        );
        const restore = () =>
          page.evaluate((upload) => {
            window.modelViewer.uploadGLB = upload;
          }, uploadGLB);
        let expected = "";
        await t.step(
          "uploads exactly match the base64 export and close their receiver",
          async () => {
            await page.evaluate(() => {
              const upload = window.modelViewer.uploadGLB;
              window.modelViewer.uploadGLB = (url) => {
                window.uploadURL = url;
                return upload(url);
              };
            });
            await receiveGLB(server, page, output, signal);
            await restore();
            const bytes = await Deno.readFile(output);
            assert(bytes.byteLength > 1024 * 1024);
            const header = new DataView(
              bytes.buffer,
              bytes.byteOffset,
              bytes.byteLength,
            );
            assertEquals(header.getUint32(0, true), 0x46546c67);
            assertEquals(header.getUint32(4, true), 2);
            assertEquals(header.getUint32(8, true), bytes.byteLength);
            const encoded = await page.evaluate(async () =>
              window.exportedGLB = await window.modelViewer.exportGLB()
            );
            expected = digest(Buffer.from(encoded, "base64"));
            assertEquals(digest(bytes), expected);
            const url = await page.evaluate(() => window.uploadURL!);
            for (
              const target of [
                url,
                `${server.url}/_js3/upload/${crypto.randomUUID()}`,
              ]
            ) {
              const response = await fetch(`${target}?path=model.glb`, {
                method: "POST",
                body: bytes.subarray(0, 64),
              });
              await response.body?.cancel();
              assertEquals(response.status, 404);
            }
            assertEquals(await temporaries(), []);
          },
        );
        for (
          const [mode, message] of [
            ["header", "GLB upload has an invalid header."],
            ["truncated", "GLB upload length does not match its header."],
            ["path", "Unexpected GLB upload path: ../model.glb"],
            ["duplicate", "Unexpected GLB upload path: model.glb"],
            ["missing", "Viewer did not upload model.glb."],
            ["ignored", "GLB upload has an invalid header."],
          ]
        ) {
          await t.step(
            `a ${mode} upload cannot overwrite a valid output`,
            async () => {
              await page.evaluate((mode) => {
                const bytes = Uint8Array.from(
                  atob(window.exportedGLB!),
                  (char) => char.charCodeAt(0),
                );
                if (mode === "header" || mode === "ignored") {
                  bytes.set([66, 65, 68, 33]);
                }
                const body = mode === "truncated"
                  ? bytes.subarray(0, bytes.byteLength - 4)
                  : bytes;
                window.modelViewer.uploadGLB = async (url) => {
                  if (mode === "missing") return;
                  const target = new URL(url);
                  target.searchParams.set(
                    "path",
                    mode === "path" ? "../model.glb" : "model.glb",
                  );
                  for (const _ of mode === "duplicate" ? [0, 1] : [0]) {
                    const response = await fetch(target, {
                      method: "POST",
                      body,
                    });
                    const text = await response.text();
                    if (!response.ok && mode !== "ignored") {
                      throw new Error(text);
                    }
                  }
                };
              }, mode);
              try {
                await assertRejects(
                  () => receiveGLB(server, page, output, signal),
                  Error,
                  message,
                );
              } finally {
                await restore();
              }
              assertEquals(digest(await Deno.readFile(output)), expected);
              assertEquals(await temporaries(), []);
            },
          );
        }
        await t.step(
          "receivers bound uploads and require a path",
          async () => {
            const receiver = server.receive(async (_, body) => {
              for await (const _ of body) { /* drain */ }
            }, { limit: 16 });
            try {
              for (
                const [path, body, status] of [
                  ["a", new Uint8Array(17), 413],
                  [
                    "a",
                    ReadableStream.from([new Uint8Array(9), new Uint8Array(9)]),
                    413,
                  ],
                  ["", new Uint8Array(1), 400],
                  ["a", new Uint8Array(16), 204],
                ] as const
              ) {
                const response = await fetch(`${receiver.url}?path=${path}`, {
                  method: "POST",
                  body,
                });
                await response.body?.cancel();
                assertEquals(response.status, status);
              }
            } finally {
              await receiver.close();
            }
          },
        );
        await t.step(
          "aborting mid-upload removes partial files and keeps the output",
          async () => {
            await page.evaluate(() => {
              window.uploadURL = undefined;
              window.modelViewer.uploadGLB = (url) => {
                window.uploadURL = url;
                return new Promise(() => {});
              };
            });
            const controller = new AbortController();
            const pending = receiveGLB(server, page, output, controller.signal);
            const url = await (await page.waitForFunction(() =>
              window.uploadURL
            ))
              .jsonValue();
            const { readable, writable } = new TransformStream<
              Uint8Array,
              Uint8Array
            >();
            const writer = writable.getWriter();
            const request = fetch(`${url}?path=model.glb`, {
              method: "POST",
              body: readable,
            }).catch((error: unknown) => error);
            await writer.write(
              (await Deno.readFile(output)).subarray(0, 65536),
            );
            await until(async () => (await temporaries()).length > 0);
            controller.abort();
            await assertRejects(() => pending);
            assertEquals(await temporaries(), []);
            assertEquals(digest(await Deno.readFile(output)), expected);
            await writer.abort().catch(() => {});
            const response = await request;
            if (response instanceof Response) {
              await response.body?.cancel();
              assertEquals(response.status, 400);
            }
            await restore();
          },
        );
        await uploadGLB.dispose();
      },
      { width: 128, height: 128 },
    );
  },
});
