import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import * as THREE from "three";
import { inflateSync } from "node:zlib";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectGroomAssets,
  encodeGroomAssetFile,
  encodeGroomPNG,
  GROOM_ASSET_FILES,
  groomAssetManifest,
  registerGroomAssets,
} from "../src/hair/groom-assets.ts";
import { bakeGroomCards } from "../src/hair/groom-cards.ts";
import {
  generateGroomStrands,
  type GuideGroom,
  parseGroom,
} from "../src/hair/groom-data.ts";
import { buildGroom, buildGroomLODs } from "../src/hair/groom.ts";
import { receiveGrooms } from "../src/cli/output.ts";
import { chromiumAvailable, withViewer } from "./support.ts";

declare global {
  interface Window {
    resumeUpload?: () => void;
  }
}

function source(): GuideGroom {
  return {
    version: 1,
    seed: 38,
    name: "../A Coat / Preview",
    layers: [{
      id: "guard",
      kind: "guard",
      children: 12,
      radius: .005,
      frizz: .005,
    }],
    guides: [{
      id: "coat-01",
      layer: "guard",
      region: "left",
      points: [[0, 0, 0], [0, .2, .03], [.1, .7, 0]],
      width: [.12, .1, .06],
      normals: [[0, 0, 1], [0, 0, 1], [0, 0, 1]],
      root: {
        surfaceId: "scalp",
        triangleIndex: 20,
        barycentric: [.2, .3, .5],
      },
    }],
  };
}

function baked() {
  return bakeGroomCards(generateGroomStrands(source(), { segments: 8 }), {
    textureSize: 128,
    tileWidth: 16,
    tileHeight: 32,
  });
}

function decodePNG(bytes: Uint8Array) {
  assertEquals([...bytes.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = view.getUint32(16), height = view.getUint32(20);
  assertEquals(bytes[24], 8);
  assertEquals(bytes[25], 6);
  const data: Uint8Array[] = [];
  const types: string[] = [];
  for (let offset = 8; offset < bytes.length;) {
    const length = view.getUint32(offset);
    const type = new TextDecoder().decode(
      bytes.subarray(offset + 4, offset + 8),
    );
    types.push(type);
    if (type === "IDAT") {
      data.push(bytes.subarray(offset + 8, offset + 8 + length));
    }
    offset += length + 12;
  }
  const compressed = new Uint8Array(
    data.reduce((sum, part) => sum + part.length, 0),
  );
  let at = 0;
  for (const part of data) {
    compressed.set(part, at);
    at += part.length;
  }
  const rows = inflateSync(compressed);
  assertEquals(rows.length, height * (width * 4 + 1));
  const pixels = new Uint8Array(width * height * 4);
  for (let row = 0; row < height; row++) {
    assertEquals(rows[row * (width * 4 + 1)], 0);
    pixels.set(
      rows.subarray(row * (width * 4 + 1) + 1, (row + 1) * (width * 4 + 1)),
      row * width * 4,
    );
  }
  return { width, height, pixels, types };
}

Deno.test("groom assets deduplicate LOD atlases and preserve editable source and tile metadata", async () => {
  const groom = source(), cards = baked();
  const root = new THREE.Group();
  root.position.set(1, 2, 3);
  registerGroomAssets(root, groom, cards);
  root.add(registerGroomAssets(new THREE.Group(), groom, cards));
  const invisibleLOD = registerGroomAssets(new THREE.Group(), groom, cards);
  invisibleLOD.visible = false;
  root.add(invisibleLOD);
  const assets = collectGroomAssets(root);
  assertEquals(assets.length, 1);
  assertEquals(assets[0].directory, "grooms/001-a-coat-preview");
  assertEquals(assets[0].objects.length, 3);
  assertEquals(assets[0].objects[0].matrixWorld.slice(12, 15), [1, 2, 3]);
  assertEquals(root.userData, { threejsGroomAssets: true });
  const manifest = groomAssetManifest(assets[0]);
  assertEquals(manifest.atlas.textureFlipY, false);
  assertEquals(manifest.tiles[0].uv, cards.atlas.tiles[0]);
  assertEquals(manifest.tiles[0].depthMin, cards.tiles[0].depthMin);
  assertEquals(manifest.tiles[0].depthMax, cards.tiles[0].depthMax);
  assertEquals(manifest.cards, cards.guides);
  assert(manifest.maps.attributes.encoding.includes("root-to-tip"));
  const encoded = await encodeGroomAssetFile(assets[0], "groom.json");
  assertEquals(parseGroom(new TextDecoder().decode(encoded)), groom);
  const second = registerGroomAssets(new THREE.Group(), groom, baked());
  root.add(second);
  const separate = collectGroomAssets(root);
  assertEquals(separate.length, 2);
  assertEquals(separate[1].directory, "grooms/002-a-coat-preview");
  assertEquals(collectGroomAssets(new THREE.Group()), []);
});

Deno.test("all five exported PNGs losslessly preserve actual baked RGBA, including transparent RGB", async () => {
  const cards = baked();
  const [asset] = collectGroomAssets(
    registerGroomAssets(new THREE.Group(), source(), cards),
  );
  const maps = [
    cards.atlas.data,
    cards.atlas.normalData,
    cards.atlas.tangentData!,
    cards.atlas.depthData!,
    cards.atlas.attributeData!,
  ];
  for (let i = 0; i < maps.length; i++) {
    const filename = GROOM_ASSET_FILES[i + 2];
    const decoded = decodePNG(await encodeGroomAssetFile(asset, filename));
    assertEquals(decoded.width, cards.atlas.width);
    assertEquals(decoded.height, cards.atlas.height);
    assertEquals(decoded.pixels, maps[i]);
    assertEquals(decoded.types.includes("sRGB"), i === 0);
  }
  const pixels = new Uint8Array([255, 128, 31, 0, 15, 64, 224, 33]);
  assertEquals(decodePNG(await encodeGroomPNG(2, 1, pixels)).pixels, pixels);
});

Deno.test("groom asset collection rejects incomplete maps and mismatched registrations", () => {
  const cards = baked();
  cards.atlas.depthData = new Uint8Array(1);
  assertThrows(
    () =>
      collectGroomAssets(
        registerGroomAssets(new THREE.Group(), source(), cards),
      ),
    RangeError,
    "complete RGBA8",
  );
  const shared = baked(),
    root = registerGroomAssets(new THREE.Group(), source(), shared);
  const changed = source();
  changed.guides[0].points[1][0] = 5;
  root.add(registerGroomAssets(new THREE.Group(), changed, shared));
  assertThrows(
    () => collectGroomAssets(root),
    Error,
    "different editable sources",
  );
});

Deno.test("cloned and copied groom roots recover assets from shared geometry at the correct transform", () => {
  const options = {
    segments: 8,
    atlas: { textureSize: 128, tileWidth: 16, tileHeight: 32 },
    shading: "standard" as const,
  };
  const original = buildGroom(source(), options);
  const clone = original.clone();
  clone.position.set(2, 3, 4);
  const [clonedAsset] = collectGroomAssets(clone);
  assertEquals(clonedAsset.source, source());
  assertEquals(clonedAsset.objects.length, 1);
  assertEquals(clonedAsset.objects[0].matrixWorld.slice(12, 15), [2, 3, 4]);
  assertEquals(
    clonedAsset.baked.atlas,
    collectGroomAssets(original)[0].baked.atlas,
  );
  const copied = new THREE.Group().copy(original);
  assertEquals(collectGroomAssets(copied).length, 1);
  const empty = registerGroomAssets(new THREE.Group(), source(), baked());
  assertEquals(collectGroomAssets(empty.clone()).length, 1);
  assertEquals(collectGroomAssets(new THREE.Group().copy(empty)).length, 1);
  const lod = buildGroomLODs(source(), options).clone();
  lod.position.set(-4, 2, 1);
  const assets = collectGroomAssets(lod);
  assertEquals(assets.length, 1);
  assertEquals(assets[0].objects.length, 4);
  for (const attachment of assets[0].objects) {
    assertEquals(attachment.matrixWorld.slice(12, 15), [-4, 2, 1]);
  }
  original.traverse((child) => {
    const geometry = (child as THREE.Mesh).geometry;
    if (geometry) {
      assert(!JSON.stringify(geometry.userData).includes("normalData"));
    }
  });
});

Deno.test({
  name:
    "CLI build exports editable groom and every map headlessly alongside the GLB",
  ignore: !chromiumAvailable,
  async fn() {
    const directory = await Deno.makeTempDir({
      prefix: "threejs-groom-assets-",
    });
    const project = dirname(
      fileURLToPath(new URL("../main.ts", import.meta.url)),
    );
    try {
      const file = join(directory, "model.ts");
      await Deno.writeTextFile(
        file,
        `import {buildGroomLODs} from "js3";
export default () => buildGroomLODs(${
          JSON.stringify(source())
        },{segments:8,atlas:{textureSize:128,tileWidth:16,tileHeight:32},shading:"standard"}).clone();`,
      );
      const command = new Deno.Command(Deno.execPath(), {
        args: [
          "run",
          "-A",
          "main.ts",
          "build",
          file,
          join(directory, "out"),
          "--software",
          "--json",
          "--width",
          "96",
          "--height",
          "96",
          "--timeout",
          "60000",
        ],
        cwd: project,
        env: { DISPLAY: "", WAYLAND_DISPLAY: "" },
        stdout: "piped",
        stderr: "piped",
      }).spawn();
      const timeout = setTimeout(() => {
        try {
          command.kill("SIGKILL");
        } catch { /* already done */ }
      }, 70_000);
      let result;
      try {
        result = await command.output();
      } finally {
        clearTimeout(timeout);
      }
      const decoder = new TextDecoder();
      assertEquals(result.code, 0, decoder.decode(result.stderr));
      const report = JSON.parse(decoder.decode(result.stdout));
      assertEquals(report.ok, true);
      assertEquals(report.headless, true);
      assertEquals(report.outputs.grooms.length, 1);
      const groom = report.outputs.grooms[0];
      assertEquals(
        parseGroom(await Deno.readTextFile(groom.files.source)),
        source(),
      );
      const manifest = JSON.parse(
        await Deno.readTextFile(groom.files.manifest),
      );
      assertEquals(manifest.tiles.length, 1);
      assertEquals(manifest.cards[0].sourceGuideId, "coat-01");
      assertEquals(manifest.tiles[0].fiberCount, 12);
      const expected = baked().atlas;
      for (
        const [key, pixels] of [
          ["coverage", expected.data],
          ["normal", expected.normalData],
          ["tangent", expected.tangentData],
          ["depth", expected.depthData],
          ["attributes", expected.attributeData],
        ] as const
      ) {
        const png = decodePNG(await Deno.readFile(groom.files[key]));
        assertEquals(png.pixels, pixels);
      }
      assertEquals(
        JSON.parse(await Deno.readTextFile(report.outputs.report)),
        report,
      );
    } finally {
      await Deno.remove(directory, { recursive: true });
    }
  },
});

Deno.test({
  name:
    "groom uploads write every file and reject unsafe paths, bad headers, and model changes",
  ignore: !chromiumAvailable,
  sanitizeOps: false,
  sanitizeResources: false,
  async fn(t) {
    const model = `import {buildGroom} from "js3";
export default () => buildGroom(${
      JSON.stringify(source())
    },{segments:8,atlas:{textureSize:128,tileWidth:16,tileHeight:32},shading:"standard"});`;
    await withViewer(model, async ({ page, server, dir, file }) => {
      const out = join(dir, "out");
      const signal = new AbortController().signal;
      const groups = await receiveGrooms(server, page, out, signal);
      assertEquals(groups.length, 1);
      const groom = join(out, "grooms/001-a-coat-preview");
      assertEquals(groups[0].directory, groom);
      assertEquals(
        Object.values(groups[0].files),
        GROOM_ASSET_FILES.map((name) => join(groom, name)),
      );
      for (const path of Object.values(groups[0].files)) {
        assert((await Deno.stat(path)).size > 8);
      }
      const original = await Deno.readFile(groups[0].files.source);
      const unchanged = async () => {
        assertEquals(await Deno.readFile(groups[0].files.source), original);
        const leftovers: string[] = [];
        for (const folder of [out, groom]) {
          for await (const entry of Deno.readDir(folder)) {
            if (entry.name.startsWith(".js3-")) leftovers.push(entry.name);
          }
        }
        assertEquals(leftovers, []);
      };
      const uploadGrooms = await page.evaluateHandle(() =>
        window.modelViewer.uploadGrooms
      );
      const valid = {
        ...groups[0],
        directory: relative(out, groups[0].directory),
        files: Object.fromEntries(
          Object.entries(groups[0].files).map((
            [key, path],
          ) => [key, relative(out, path)]),
        ),
      };
      for (
        const [name, uploads, metadata, message] of [
          [
            "path traversal",
            [["grooms/../../outside/groom.json", "{}"]],
            [],
            "Unsafe or duplicate groom upload path",
          ],
          [
            "unexpected file",
            [["grooms/001-a-coat-preview/extra.json", "{}"]],
            [],
            "Unsafe or duplicate groom upload path",
          ],
          [
            "duplicate path",
            [["grooms/002-b/groom.json", "{}"], [
              "grooms/002-b/groom.json",
              "{}",
            ]],
            [],
            "Unsafe or duplicate groom upload path",
          ],
          [
            "bad PNG header",
            [["grooms/001-a-coat-preview/coverage.png", "{}"]],
            [],
            "invalid header",
          ],
          [
            "bad JSON header",
            [["grooms/001-a-coat-preview/groom.json", "[]"]],
            [],
            "invalid header",
          ],
          [
            "unsafe metadata",
            [],
            [{ ...valid, directory: "../outside" }],
            "invalid groom output paths",
          ],
          [
            "metadata without uploads",
            [],
            [valid],
            "do not match its metadata",
          ],
        ] as const
      ) {
        await t.step(`${name} is rejected`, async () => {
          await page.evaluate(({ uploads, metadata }) => {
            window.modelViewer.uploadGrooms = async (url) => {
              for (const [path, body] of uploads) {
                const target = new URL(url);
                target.searchParams.set("path", path);
                const response = await fetch(target, { method: "POST", body });
                if (!response.ok) throw new Error(await response.text());
              }
              return metadata as never;
            };
          }, { uploads, metadata });
          try {
            await assertRejects(
              () => receiveGrooms(server, page, out, signal),
              Error,
              message,
            );
          } finally {
            await page.evaluate((upload) => {
              window.modelViewer.uploadGrooms = upload;
            }, uploadGrooms);
          }
          await unchanged();
        });
      }
      await uploadGrooms.dispose();
      await t.step("a rebuild between files fails the export", async () => {
        await page.evaluate(() => {
          const send = globalThis.fetch;
          globalThis.fetch = async (...args) => {
            globalThis.fetch = send;
            const response = await send(...args);
            await new Promise<void>((resolve) => {
              window.resumeUpload = resolve;
            });
            return response;
          };
        });
        const revision = await page.evaluate(() => window.modelViewer.revision);
        const pending = receiveGrooms(server, page, out, signal);
        await page.waitForFunction(() => !!window.resumeUpload);
        await Deno.writeTextFile(file, model + "\n// rebuild");
        await page.waitForFunction(
          (previous) =>
            window.modelViewer.ready && window.modelViewer.revision > previous,
          revision,
        );
        await page.evaluate(() => window.resumeUpload!());
        await assertRejects(
          () => pending,
          Error,
          "Model changed during groom export",
        );
        await unchanged();
      });
    }, { width: 96, height: 96 });
  },
});
