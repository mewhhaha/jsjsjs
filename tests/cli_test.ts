import { assert, assertEquals, assertMatch, assertThrows } from "@std/assert";
import { parseArgs } from "../main.ts";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(
  fileURLToPath(new URL("../main.ts", import.meta.url)),
);
const decoder = new TextDecoder();

Deno.test("animation CLI validates clip selection, frame rates, and capture windows", () => {
  const args = parseArgs([
    "frames",
    "model.ts",
    "--clip",
    "walk",
    "--fps",
    "60",
    "--start",
    ".5",
    "--duration",
    "2",
  ]);
  assert(args?.command === "frames");
  assertEquals(args.frames, { fps: 60, start: .5, duration: 2 });
  assertEquals(args.headed, false);
  assertEquals(args.output, "output/frames");
  for (
    const options of [
      [],
      ["--clip"],
      ["--clip", "walk", "--fps", "0"],
      ["--clip", "walk", "--fps", "241"],
      ["--clip", "walk", "--start", "-1"],
      ["--clip", "walk", "--duration", "Infinity"],
      ["--clip", "walk", "--duration", "200"],
      ["--clip", "walk", "--time", "1"],
    ]
  ) assertThrows(() => parseArgs(["frames", "model.ts", ...options]));
  assertThrows(() => parseArgs(["screenshot", "model.ts", "--time", "1"]));
  assertThrows(() => parseArgs(["screenshot", "model.ts", "--fps", "24"]));
  assertThrows(() => parseArgs(["export", "model.ts", "--clip", "walk"]));
});

Deno.test("CLI captures deterministic animation PNGs and timestamp manifest without a desktop", async () => {
  const directory = await Deno.makeTempDir({ prefix: "js3 frames " });
  try {
    const file = join(directory, "model.ts");
    await Deno.writeTextFile(
      file,
      `import {box,group,clip} from "js3";
export default () => {
 const model=group([box([.4,1,.4],{name:"moving"}),box([.1,.1,.1],{position:[0,-1,0]})],{preview:{grid:false,radius:2}});
 clip(model,"turn",[{target:"moving",property:"rotation",keys:[[0,[0,0,0]],[1,[0,0,90]]]}]);
 return model;
};`,
    );
    const result = await cli([
      "frames",
      file,
      join(directory, "frames"),
      "--clip",
      "turn",
      "--fps",
      "4",
      "--duration",
      ".75",
      "--software",
      "--width",
      "192",
      "--height",
      "192",
      "--json",
    ]);
    assertEquals(result.code, 0, result.stderr);
    const report = JSON.parse(result.stdout);
    assertEquals(report.headless, true);
    assertEquals(report.frames, 3);
    const manifest = JSON.parse(
      await Deno.readTextFile(report.outputs.manifest),
    );
    assertEquals(manifest.frames.map((frame: { time: number }) => frame.time), [
      0,
      .25,
      .5,
    ]);
    const images = await Promise.all(
      manifest.frames.map((frame: { file: string }) =>
        Deno.readFile(join(report.outputs.directory, frame.file))
      ),
    );
    assert(images[0].some((byte: number, i: number) => byte !== images[2][i]));
    const frame = join(directory, "half.png");
    const single = await cli([
      "screenshot",
      file,
      frame,
      "--clip",
      "turn",
      "--time",
      ".5",
      "--software",
      "--width",
      "192",
      "--height",
      "192",
      "--json",
    ]);
    assertEquals(single.code, 0, single.stderr);
    assertEquals(
      await Deno.readFile(frame),
      images[2],
      "Frame capture and exact-time screenshots must match",
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("imposter validates sampling and atlas sizes before launching", () => {
  const args = parseArgs([
    "imposter",
    "model.ts",
    "--coverage",
    "360",
    "--grid",
    "5",
    "--tile-size",
    "128",
  ]);
  assert(args?.command === "imposter");
  assertEquals(args.imposter.coverage, 360);
  assertEquals(args.imposter.grid, 5);
  assertEquals(args.imposter.tileSize, 128);
  assertEquals(args.timeout, 120000);
  assertEquals(args.output, "output/imposter");
  for (
    const options of [
      ["--coverage", "90"],
      ["--grid", "4"],
      ["--grid", "0"],
      ["--tile-size", "0"],
      ["--grid", "33", "--tile-size", "2048"],
      ["--gutter", "128"],
      ["--padding", ".9"],
      ["--padding", "Infinity"],
      ["--view", "front"],
      ["--width", "128"],
      ["--coverage"],
    ]
  ) assertThrows(() => parseArgs(["imposter", "model.ts", ...options]));
  assertThrows(() =>
    parseArgs(["screenshot", "model.ts", "--coverage", "360"])
  );
});

Deno.test("CLI writes a transparent octahedral atlas and matching manifest headlessly", async () => {
  const directory = await Deno.makeTempDir({ prefix: "js3 imposter " });
  try {
    const file = join(directory, "model.ts");
    await Deno.writeTextFile(
      file,
      'import {box} from "js3"; export default () => box([1,2,3]);',
    );
    const result = await cli([
      "imposter",
      file,
      join(directory, "bake"),
      "--coverage",
      "360",
      "--grid",
      "3",
      "--tile-size",
      "32",
      "--software",
      "--json",
    ]);
    assertEquals(result.code, 0, result.stderr);
    const envelope = JSON.parse(result.stdout);
    assertEquals(envelope.ok, true);
    assertEquals(envelope.headless, true);
    assertEquals(envelope.views, 9);
    const manifest = JSON.parse(
      await Deno.readTextFile(envelope.outputs.manifest),
    );
    assertEquals(manifest.tiles.length, 9);
    assertEquals(manifest.options.coverage, 360);
    assert(
      manifest.tiles.some((tile: { direction: number[] }) =>
        tile.direction[1] < -.99
      ),
    );
    const png = await Deno.readFile(envelope.outputs.atlas);
    assertEquals(Array.from(png.slice(0, 8)), [
      137,
      80,
      78,
      71,
      13,
      10,
      26,
      10,
    ]);
    const header = new DataView(png.buffer, png.byteOffset, png.byteLength);
    assertEquals(header.getUint32(16), 96);
    assertEquals(header.getUint32(20), 96);
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

async function cli(args: string[], deadlineMs = 90_000) {
  const child = new Deno.Command(Deno.execPath(), {
    args: ["run", "-A", "main.ts", ...args],
    cwd: projectRoot,
    stdout: "piped",
    stderr: "piped",
    // A successful build must work without access to the desktop session.
    env: { DISPLAY: "", WAYLAND_DISPLAY: "" },
  }).spawn();
  let exceededDeadline = false;
  const timeout = setTimeout(() => {
    exceededDeadline = true;
    child.kill("SIGKILL");
  }, deadlineMs);
  try {
    const result = await child.output();
    assert(
      !exceededDeadline,
      `CLI did not exit within ${deadlineMs} ms: ${args.join(" ")}`,
    );
    return {
      code: result.code,
      stdout: decoder.decode(result.stdout),
      stderr: decoder.decode(result.stderr),
    };
  } finally {
    clearTimeout(timeout);
  }
}

Deno.test("CLI creates a model and builds headless artifacts with JSON results", async (t) => {
  const directory = await Deno.makeTempDir({ prefix: "model cli " });
  const file = join(directory, "a model.ts");
  const outputDirectory = join(directory, "build output");
  try {
    await t.step(
      "init creates a usable starter and refuses overwrite",
      async () => {
        const result = await cli(["init", file, "--json"]);
        assertEquals(result.code, 0, result.stderr);
        const envelope = JSON.parse(result.stdout);
        assertEquals(envelope.ok, true);
        assertEquals(envelope.command, "init");
        assertEquals(envelope.file, file);
        const original = await Deno.readTextFile(file);
        assertMatch(original, /export default/);
        const repeated = await cli(["init", file, "--json"]);
        assert(repeated.code !== 0);
        assertEquals(JSON.parse(repeated.stdout).ok, false);
        assertEquals(await Deno.readTextFile(file), original);
      },
    );

    await t.step(
      "build writes GLB, PNG and a machine-readable report",
      async () => {
        const result = await cli([
          "build",
          file,
          outputDirectory,
          "--software",
          "--json",
          "--width",
          "320",
          "--height",
          "240",
        ]);
        assertEquals(result.code, 0, result.stderr);
        // Parsing the entire stdout also catches accidental diagnostic logging.
        const envelope = JSON.parse(result.stdout);
        assertEquals(envelope.ok, true);
        assertEquals(envelope.command, "build");
        assertEquals(envelope.file, file);
        assertEquals(envelope.outputs, {
          glb: join(outputDirectory, "model.glb"),
          preview: join(outputDirectory, "preview.png"),
          report: join(outputDirectory, "report.json"),
        });
        assert(envelope.inspection && typeof envelope.inspection === "object");
        const glb = await Deno.readFile(envelope.outputs.glb);
        assertEquals(decoder.decode(glb.subarray(0, 4)), "glTF");
        const header = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
        assertEquals(header.getUint32(4, true), 2);
        assertEquals(header.getUint32(8, true), glb.byteLength);
        const png = await Deno.readFile(envelope.outputs.preview);
        assertEquals(Array.from(png.subarray(0, 8)), [
          137,
          80,
          78,
          71,
          13,
          10,
          26,
          10,
        ]);
        const dimensions = new DataView(
          png.buffer,
          png.byteOffset,
          png.byteLength,
        );
        assertEquals(dimensions.getUint32(16), 320);
        assertEquals(dimensions.getUint32(20), 240);
        const report = JSON.parse(
          await Deno.readTextFile(envelope.outputs.report),
        );
        assertEquals(report, envelope);
      },
    );

    await t.step("inspect returns a single JSON result", async () => {
      const result = await cli(["inspect", file, "--software", "--json"]);
      assertEquals(result.code, 0, result.stderr);
      const envelope = JSON.parse(result.stdout);
      assertEquals(envelope.ok, true);
      assertEquals(envelope.command, "inspect");
      assertEquals(envelope.file, file);
      assert(envelope.inspection && typeof envelope.inspection === "object");
    });
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});

Deno.test("CLI validates arguments before launching and emits JSON errors", async () => {
  for (
    const args of [
      ["export", "/missing/model.ts", "/tmp/model.stl", "--json"],
      ["screenshot", "/missing/model.ts", "--width", "--json"],
      ["screenshot", "/missing/model.ts", "--json", "--port"],
      ["inspect", "--json"],
      ["unknown-command", "--json"],
    ]
  ) {
    const result = await cli(args);
    assert(result.code !== 0, `${args.join(" ")} unexpectedly succeeded`);
    const envelope = JSON.parse(result.stdout);
    assertEquals(envelope.ok, false);
    assert(typeof envelope.error === "string" && envelope.error.length > 0);
    if (args[0] === "export") {
      assertMatch(envelope.error, /extension|\.obj|\.glb|format/i);
      assert(!/not found|no such file|ENOENT/i.test(envelope.error));
    }
  }
});

Deno.test("CLI subcommands support help without a model file", async () => {
  for (const command of ["init", "inspect", "build", "screenshot", "export"]) {
    const result = await cli([command, "--help"]);
    assertEquals(result.code, 0, result.stderr);
    assertMatch(result.stdout, /Usage|usage|Options|options/);
    assert(result.stdout.includes(command));
  }
});

Deno.test("CLI model failures emit one JSON error and exit cleanly", async (t) => {
  const directory = await Deno.makeTempDir({ prefix: "model cli failures " });
  const file = join(directory, "model.ts");
  try {
    for (
      const failure of [
        {
          name: "runtime exception",
          source:
            'export default () => { throw new Error("intentional CLI failure"); };',
          error: /intentional CLI failure/,
        },
        {
          name: "malformed TypeScript",
          source: "export default function (",
          error: /build failed|expected|unexpected/i,
        },
      ]
    ) {
      await t.step(failure.name, async () => {
        await Deno.writeTextFile(file, failure.source);
        const result = await cli([
          "inspect",
          file,
          "--software",
          "--json",
          "--timeout",
          "10000",
        ], 15_000);
        assert(result.code !== 0);
        const envelope = JSON.parse(result.stdout);
        assertEquals(envelope.ok, false);
        assertMatch(envelope.error, failure.error);
      });
    }

    await t.step(
      "an unresolved factory times out and releases the process",
      async () => {
        await Deno.writeTextFile(
          file,
          "export default async () => await new Promise(() => {});",
        );
        const result = await cli([
          "inspect",
          file,
          "--software",
          "--json",
          "--timeout",
          "2000",
        ], 10_000);
        assert(result.code !== 0);
        // Parsing all stdout catches duplicate reports from cancelled work.
        const envelope = JSON.parse(result.stdout);
        assertEquals(envelope.ok, false);
        assertMatch(envelope.error, /timeout|timed out/i);
        assertMatch(envelope.error, /2000/);
      },
    );
  } finally {
    await Deno.remove(directory, { recursive: true });
  }
});
