import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import * as THREE from "three";
import * as esbuild from "esbuild";
import { inflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  collectGroomAssets,
  encodeGroomAssetFile,
  encodeGroomPNG,
  GROOM_ASSET_FILES,
  groomAssetManifest,
  registerGroomAssets,
} from "../src/groom-assets.ts";
import { bakeGroomCards } from "../src/groom-cards.ts";
import {
  generateGroomStrands,
  type GuideGroom,
  parseGroom,
} from "../src/groom-data.ts";
import { buildGroom, buildGroomLODs } from "../src/groom.ts";
import { startServer } from "../src/server.ts";
import { launchViewer, waitForModel } from "../src/browser.ts";
import { writeGroomOutputs } from "../main.ts";

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

Deno.test("CLI build exports editable groom and every map headlessly alongside the GLB", async () => {
  const directory = await Deno.makeTempDir({ prefix: "threejs-groom-assets-" });
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
    const manifest = JSON.parse(await Deno.readTextFile(groom.files.manifest));
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
});

Deno.test({
  name:
    "groom transfers bound files and preserve existing outputs after incomplete data or unsafe paths",
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const directory = await Deno.makeTempDir({
      prefix: "js3-groom-transfer-",
    });
    let server: Awaited<ReturnType<typeof startServer>> | undefined;
    let viewer: Awaited<ReturnType<typeof launchViewer>> | undefined;
    try {
      const file = join(directory, "model.ts");
      await Deno.writeTextFile(
        file,
        `import {buildGroom} from "js3";
export default () => buildGroom(${
          JSON.stringify(source())
        },{segments:8,atlas:{textureSize:128,tileWidth:16,tileHeight:32},shading:"standard"});`,
      );
      server = await startServer(file, 0);
      viewer = await launchViewer(server.url, {
        renderer: "software",
        width: 96,
        height: 96,
      });
      await waitForModel(viewer.page);
      const page = viewer.page;
      const transfer = await page.evaluate(() =>
        window.modelViewer.beginGroomExport()
      );
      assertEquals(transfer.grooms.length, 1);
      assertEquals(transfer.files.length, 7);
      await assertRejects(
        () => page.evaluate(() => window.modelViewer.beginGroomExport()),
        Error,
        "already active",
      );
      const prepared = await page.evaluate(
        (id) => window.modelViewer.prepareGroomExportFile(id, 0),
        transfer.id,
      );
      assert(prepared.chunkSize <= 8 * 1024 * 1024);
      assertEquals(
        prepared.chunks,
        Math.ceil(prepared.byteLength / prepared.chunkSize),
      );
      await assertRejects(
        () =>
          page.evaluate(
            ({ id, count }) =>
              window.modelViewer.readGroomExportChunk(id, 0, count),
            {
              id: transfer.id,
              count: prepared.chunks,
            },
          ),
        Error,
        "out of range",
      );
      await page.evaluate(
        (id) => window.modelViewer.endGroomExport(id),
        transfer.id,
      );
      await assertRejects(
        () =>
          page.evaluate(
            (id) => window.modelViewer.readGroomExportChunk(id, 0, 0),
            transfer.id,
          ),
        Error,
        "expired",
      );
      const out = join(directory, "out");
      const groups = await writeGroomOutputs(
        page,
        out,
        new AbortController().signal,
      );
      const original = await Deno.readFile(groups[0].files.source);
      const read = await page.evaluateHandle(() =>
        window.modelViewer.readGroomExportChunk
      );
      try {
        await page.evaluate(() => {
          window.modelViewer.readGroomExportChunk = () => "";
        });
        await assertRejects(
          () => writeGroomOutputs(page, out, new AbortController().signal),
          Error,
          "empty or incomplete",
        );
        assertEquals(await Deno.readFile(groups[0].files.source), original);
      } finally {
        await page.evaluate((saved) => {
          window.modelViewer.readGroomExportChunk = saved;
        }, read);
        await read.dispose();
      }
      const begin = await page.evaluateHandle(() =>
        window.modelViewer.beginGroomExport
      );
      try {
        await page.evaluate(() => {
          const saved = window.modelViewer.beginGroomExport;
          window.modelViewer.beginGroomExport = () => {
            const transfer = saved();
            transfer.grooms[0].directory = "../outside";
            return transfer;
          };
        });
        await assertRejects(
          () => writeGroomOutputs(page, out, new AbortController().signal),
          Error,
          "invalid groom output paths",
        );
        assertEquals(await Deno.readFile(groups[0].files.source), original);
      } finally {
        await page.evaluate((saved) => {
          window.modelViewer.beginGroomExport = saved;
        }, begin);
        await begin.dispose();
      }
      const leftovers: string[] = [];
      for await (const entry of Deno.readDir(groups[0].directory)) {
        if (entry.name.startsWith(".js3-")) leftovers.push(entry.name);
      }
      assertEquals(leftovers, []);
    } finally {
      await viewer?.browser.close();
      await server?.close();
      esbuild.stop();
      await Deno.remove(directory, { recursive: true });
    }
  },
});
