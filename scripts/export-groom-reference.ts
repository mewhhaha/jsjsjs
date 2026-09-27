/** Generate every source fiber and render a headless Cycles comparison. */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as THREE from "three";
import {
  generateGroomStrands,
  type GroomFiber,
  type GuideGroom,
  parseGroom,
  serializeGroom,
} from "../src/groom-data.ts";

export interface ReferenceAttachment {
  name: string;
  /** Column-major matrix in the source's Three.js Y-up frame. */
  matrixWorld: number[];
}

interface BufferSection {
  byteOffset: number;
  byteLength: number;
  count: number;
  components: number;
  type: "float32" | "uint32";
}

const identity = () => new THREE.Matrix4().toArray();

export function referenceAttachments(value: unknown): ReferenceAttachment[] {
  if (value === undefined) return [{ name: "groom", matrixWorld: identity() }];
  if (!Array.isArray(value) || !value.length || value.length > 256) {
    throw new RangeError("Reference attachments must contain 1–256 transforms");
  }
  const unique = new Map<string, ReferenceAttachment>();
  for (const item of value) {
    if (
      !item || typeof item.name !== "string" ||
      !Array.isArray(item.matrixWorld) || item.matrixWorld.length !== 16 ||
      !item.matrixWorld.every(Number.isFinite)
    ) throw new TypeError("Invalid groom attachment name or matrixWorld");
    const m = item.matrixWorld as number[];
    if (m[3] !== 0 || m[7] !== 0 || m[11] !== 0 || m[15] !== 1) {
      throw new RangeError("Groom attachment must be an affine matrix");
    }
    if (Math.abs(new THREE.Matrix4().fromArray(m).determinant()) < 1e-15) {
      throw new RangeError("Groom attachment matrix must be invertible");
    }
    // Live LOD exports repeat the same attachment for each representation.
    const key = JSON.stringify(m);
    if (!unique.has(key)) {
      unique.set(key, { name: item.name, matrixWorld: [...m] });
    }
  }
  return [...unique.values()];
}

/** No card atlas or render LOD is involved: density is always exactly one. */
export async function packGroomReference(
  source: GuideGroom,
  directory: string,
  options: { segments?: number; attachments?: ReferenceAttachment[] } = {},
) {
  const segments = options.segments ?? 24;
  const generated = generateGroomStrands(source, { density: 1, segments });
  const attachments = referenceAttachments(options.attachments);
  const grouped = new Map<string, GroomFiber[]>();
  for (const layer of generated.source.layers) grouped.set(layer.id, []);
  for (const fiber of generated.strands) grouped.get(fiber.layer)!.push(fiber);
  await Deno.mkdir(directory, { recursive: true });
  const binary = await Deno.open(join(directory, "fibers.bin"), {
    create: true,
    truncate: true,
    write: true,
  });
  let byteOffset = 0;
  const littleEndian = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1;
  const write = async (
    values: Float32Array | Uint32Array,
    components: number,
  ): Promise<BufferSection> => {
    const bytes = new Uint8Array(values.buffer);
    if (!littleEndian) {
      for (let i = 0; i < bytes.length; i += 4) {
        [bytes[i], bytes[i + 3]] = [bytes[i + 3], bytes[i]];
        [bytes[i + 1], bytes[i + 2]] = [bytes[i + 2], bytes[i + 1]];
      }
    }
    const section: BufferSection = {
      byteOffset,
      byteLength: bytes.length,
      count: values.length / components,
      components,
      type: values instanceof Uint32Array ? "uint32" : "float32",
    };
    let written = 0;
    while (written < bytes.length) {
      written += await binary.write(bytes.subarray(written));
    }
    byteOffset += bytes.length;
    return section;
  };
  const layers = [];
  let pointCount = 0;
  try {
    for (const layer of generated.source.layers) {
      const fibers = grouped.get(layer.id)!;
      if (!fibers.length) continue;
      const points = fibers.reduce(
        (sum, fiber) => sum + fiber.points.length,
        0,
      );
      const positions = new Float32Array(points * 3);
      const radii = new Float32Array(points);
      const sizes = new Uint32Array(fibers.length);
      const shades = new Float32Array(fibers.length);
      let cursor = 0;
      fibers.forEach((fiber, i) => {
        sizes[i] = fiber.points.length;
        shades[i] = fiber.shade;
        for (let j = 0; j < fiber.points.length; j++) {
          positions.set(fiber.points[j], cursor * 3);
          radii[cursor++] = fiber.radii[j];
        }
      });
      layers.push({
        id: layer.id,
        kind: layer.kind ?? "hair",
        fibers: fibers.length,
        points,
        material: {
          color: new THREE.Color(layer.color ?? "#463126").toArray(),
          tipColor: new THREE.Color(layer.tipColor ?? layer.color ?? "#463126")
            .toArray(),
          roughness: layer.roughness ?? .46,
          colorSpace: "linear-srgb",
        },
        positions: await write(positions, 3),
        radii: await write(radii, 1),
        sizes: await write(sizes, 1),
        shades: await write(shades, 1),
      });
      pointCount += points;
    }
  } finally {
    binary.close();
  }
  const manifest = {
    version: 1,
    format: "threejs-groom-reference",
    name: generated.source.name ?? "groom",
    source: "groom.json",
    binary: "fibers.bin",
    byteOrder: "little",
    coordinates: "Y-up, +Z forward; positions and radii in groom-local units",
    generation: { density: 1, segments, seed: generated.seed },
    counts: {
      guides: generated.source.guides.length,
      fibers: generated.strands.length,
      points: pointCount,
      instances: attachments.length,
      renderedFibers: generated.strands.length * attachments.length,
    },
    byteLength: byteOffset,
    layers,
    attachments,
  };
  await Deno.writeTextFile(
    join(directory, "groom.json"),
    serializeGroom(generated.source),
  );
  await Deno.writeTextFile(
    join(directory, "reference.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
  return manifest;
}

function argumentsFrom(args: string[]): Map<string, string> {
  const values = new Map<string, string>();
  const allowed = new Set([
    "source",
    "head",
    "output",
    "preset",
    "view",
    "resolution",
    "samples",
    "segments",
    "manifest",
    "target",
    "radius",
    "fov",
    "padding",
    "device",
  ]);
  for (let i = 0; i < args.length; i++) {
    const key = args[i].replace(/^--/, "");
    if (!args[i].startsWith("--") || !allowed.has(key)) {
      throw new Error(`Unknown argument ${args[i]}`);
    }
    if (!args[i + 1] || args[i + 1].startsWith("--")) {
      throw new Error(`Missing value for --${key}`);
    }
    if (values.has(key)) throw new Error(`Duplicate --${key}`);
    values.set(key, args[++i]);
  }
  return values;
}

export async function main(args = Deno.args): Promise<void> {
  if (args.includes("--help")) {
    console.log(
      `Render every generated source fiber with native Cycles Hair Curves.

deno run -A scripts/export-groom-reference.ts \\
  --source output/hair-bun/grooms/001-wig-messy-bun/groom.json \\
  --head examples/haircuts/assets/head.glb \\
  --output output/hair-bun/cycles-reference \\
  --preset studio --view three-quarter --resolution 800x1000 --samples 32

Required: --source <groom.json> --output <directory>
Optional: --head <head-only.glb>; --manifest <groom asset manifest>
  --preset studio|backlight|grazing (studio)
  --view front|profile|back|three-quarter|all (three-quarter; comma lists allowed)
  --resolution N|WIDTHxHEIGHT (800x1000); --samples N (32)
  --segments N (24); --target X,Y,Z (0,.69,-.07)
  --radius N (1.03); --fov N (38); --padding N (1.04)
  --device CPU|AUTO|CUDA|OPTIX|HIP|ONEAPI|METAL (CPU)
Sibling manifest.json transforms are applied automatically when present.
Writes packed/ source data, reference.blend, preset-view.png and report.json.
JS3_BLENDER can select the Blender executable. No window is opened.`,
    );
    return;
  }
  const values = argumentsFrom(args);
  if (!values.has("source") || !values.has("output")) {
    throw new Error("--source and --output are required; see --help");
  }
  const sourcePath = resolve(values.get("source")!);
  const output = resolve(values.get("output")!);
  const source = parseGroom(await Deno.readTextFile(sourcePath));
  const manifestPath = resolve(
    values.get("manifest") ?? join(dirname(sourcePath), "manifest.json"),
  );
  let attachments: ReferenceAttachment[] | undefined;
  try {
    const assets = JSON.parse(await Deno.readTextFile(manifestPath));
    if (assets.format !== "threejs-groom-assets") {
      throw new Error(`Unsupported groom asset manifest: ${manifestPath}`);
    }
    attachments = referenceAttachments(assets.objects);
  } catch (error) {
    if (!(error instanceof Deno.errors.NotFound) || values.has("manifest")) {
      throw error;
    }
  }
  const packed = join(output, "packed");
  const metadata = await packGroomReference(source, packed, {
    segments: Number(values.get("segments") ?? 24),
    attachments,
  });
  console.error(
    `Packed ${metadata.counts.fibers} full-density fibers ` +
      `(${metadata.counts.points} points, ${metadata.counts.instances} instance(s)).`,
  );
  const renderArgs = [
    "--background",
    "--factory-startup",
    "--disable-autoexec",
    "--python-exit-code",
    "1",
    "--python",
    fileURLToPath(new URL("./render-groom-reference.py", import.meta.url)),
    "--",
    "--source",
    join(packed, "reference.json"),
    "--output",
    output,
  ];
  for (
    const key of [
      "head",
      "preset",
      "view",
      "resolution",
      "samples",
      "target",
      "radius",
      "fov",
      "padding",
      "device",
    ]
  ) {
    const value = values.get(key);
    if (value !== undefined) {
      renderArgs.push(`--${key}`, key === "head" ? resolve(value) : value);
    }
  }
  const executable = Deno.env.get("JS3_BLENDER") ||
    Deno.env.get("THREEJS_BLENDER") || "blender";
  const child = new Deno.Command(executable, {
    args: renderArgs,
    env: { DISPLAY: "", WAYLAND_DISPLAY: "" },
    stdin: "null",
    stdout: "inherit",
    stderr: "inherit",
  }).spawn();
  let exited = false;
  const stop = () => {
    if (!exited) {
      try {
        child.kill("SIGTERM");
      } catch { /* The process may exit between status and cancellation. */ }
    }
  };
  Deno.addSignalListener("SIGINT", stop);
  Deno.addSignalListener("SIGTERM", stop);
  try {
    const status = await child.status;
    exited = true;
    if (!status.success) {
      throw new Error(`Cycles reference failed: ${status.code}`);
    }
  } finally {
    Deno.removeSignalListener("SIGINT", stop);
    Deno.removeSignalListener("SIGTERM", stop);
    stop();
    await child.status;
  }
  console.log(`Cycles reference saved in ${output}`);
}

if (import.meta.main) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    Deno.exit(1);
  }
}
