/** Repeatable visual review of a fitted hairstyle, using one headless browser. */
import * as esbuild from "esbuild";
import type * as THREE from "three";
import { dirname, resolve } from "node:path";
import { launchViewer, waitForModel } from "../src/browser.ts";
import { startServer } from "../src/server.ts";
import presets from "./hair-review-presets.json" with { type: "json" };

const usage = `Headless hairstyle review
deno run -A scripts/review-hair.ts model.ts output/directory [options]

  --views front,three-quarter,profile,back   Default: all four
  --presets studio,backlight,grazing         Default: all three
  --width N --height N                      Default: 800 × 1000
  --timeout N                              Default: 180000 milliseconds
  --hair-shadows on|off                     Default: on
  --hair-shadow-resolution N                Default: 96 (16–192)
  --hair-ao N                               Ambient occlusion amount, 0–1 (default 1)
  --hair-ao-resolution N                    Default: 64 (16–96)
  --hair-ao-distance N                      World units; default 12% of groom extent

Writes a PNG per view/light pair and review.json with the exact camera and lights.
Uses the shared anatomical head frame from scripts/hair-review-presets.json.
`;

type View = keyof typeof presets.views;
type Lighting = keyof typeof presets.lighting;

function names<T extends string>(value: string, choices: readonly T[]): T[] {
  const result = value.split(",");
  if (
    !result.length || new Set(result).size !== result.length ||
    result.some((name) => !choices.includes(name as T))
  ) {
    throw new Error(`Expected unique names from: ${choices.join(", ")}`);
  }
  return result as T[];
}

export function parseReviewArguments(args: string[]) {
  if (args.length < 2 || args[0].startsWith("-") || args[1].startsWith("-")) {
    throw new Error(usage);
  }
  const options = {
    file: resolve(args[0]),
    output: resolve(args[1]),
    views: Object.keys(presets.views) as View[],
    lighting: Object.keys(presets.lighting) as Lighting[],
    width: 800,
    height: 1000,
    timeout: 180000,
    hairShadows: true,
    hairShadowResolution: 96,
    hairAmbientOcclusion: 1,
    hairAmbientResolution: 64,
    hairAmbientDistance: undefined as number | undefined,
  };
  for (let i = 2; i < args.length; i += 2) {
    const key = args[i], value = args[i + 1];
    if (value === undefined) throw new Error(`${key} needs a value`);
    if (key === "--views") {
      options.views = names(value, Object.keys(presets.views) as View[]);
    } else if (key === "--presets") {
      options.lighting = names(
        value,
        Object.keys(presets.lighting) as Lighting[],
      );
    } else if (key === "--hair-shadows") {
      if (value !== "on" && value !== "off") {
        throw new Error("--hair-shadows must be on or off");
      }
      options.hairShadows = value === "on";
    } else if (key === "--hair-shadow-resolution") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 16 || n > 192) {
        throw new Error(
          "--hair-shadow-resolution must be an integer in [16, 192]",
        );
      }
      options.hairShadowResolution = n;
    } else if (key === "--hair-ao") {
      const n = Number(value);
      if (!Number.isFinite(n) || n < 0 || n > 1) {
        throw new Error("--hair-ao must be in [0, 1]");
      }
      options.hairAmbientOcclusion = n;
    } else if (key === "--hair-ao-resolution") {
      const n = Number(value);
      if (!Number.isInteger(n) || n < 16 || n > 96) {
        throw new Error("--hair-ao-resolution must be an integer in [16, 96]");
      }
      options.hairAmbientResolution = n;
    } else if (key === "--hair-ao-distance") {
      const n = Number(value);
      if (!Number.isFinite(n) || n <= 0) {
        throw new Error("--hair-ao-distance must be positive and finite");
      }
      options.hairAmbientDistance = n;
    } else if (["--width", "--height", "--timeout"].includes(key)) {
      const n = Number(value);
      const min = key === "--timeout" ? 1000 : 64;
      const max = key === "--timeout" ? 600000 : 4096;
      if (!Number.isInteger(n) || n < min || n > max) {
        throw new Error(`${key} must be an integer in [${min}, ${max}]`);
      }
      options[key.slice(2) as "width" | "height" | "timeout"] = n;
    } else throw new Error(`Unknown option: ${key}`);
  }
  return options;
}

export async function reviewHair(
  options: ReturnType<typeof parseReviewArguments>,
) {
  if (!(await Deno.stat(options.file)).isFile) {
    throw new Error("Model must be a file");
  }
  await Deno.mkdir(options.output, { recursive: true });
  // Place the temporary entry beside the original model so /assets stays rooted
  // in the same directory. Imported dependencies keep their original paths.
  const entry = await Deno.makeTempFile({
    dir: dirname(options.file),
    prefix: ".js3-review-",
    suffix: ".ts",
  });
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  let viewer: Awaited<ReturnType<typeof launchViewer>> | undefined;
  const captures: { view: View; lighting: Lighting; file: string }[] = [];
  try {
    await Deno.writeTextFile(
      entry,
      `import build from ${JSON.stringify(options.file)};
export default async () => {
  const root = await build();
  root.userData.preview = {...root.userData.preview, grid:false,
    background:${
        JSON.stringify(presets.background)
      }, exposure:${presets.exposure},
    target:${
        JSON.stringify(presets.camera.target)
      }, radius:${presets.camera.radius},
    padding:${presets.camera.padding}, direction:[0,0,1],
    lighting:{hemisphere:1.6,key:2,fill:.3,shadows:true,
      hairShadows:${options.hairShadows},hairShadowResolution:${options.hairShadowResolution},
      hairAmbientOcclusion:${options.hairAmbientOcclusion},
      hairAmbientResolution:${options.hairAmbientResolution},
      hairAmbientDistance:${options.hairAmbientDistance}}};
  Object.assign(window, {threejsHairReviewRoot: root});
  let hooked = false;
  root.traverse((mesh) => {
    if (!mesh.isMesh || hooked) return;
    hooked = true;
    const original = mesh.onBeforeRender;
    mesh.onBeforeRender = function (...args) {
      original.apply(this, args);
      Object.assign(window, {threejsHairReviewCamera: args[2]});
    };
  });
  return root;
};`,
    );
    server = await startServer(entry, 0);
    viewer = await launchViewer(server.url, {
      renderer: "software",
      headless: true,
      width: options.width,
      height: options.height,
      timeout: options.timeout,
    });
    await waitForModel(viewer.page, options.timeout);
    const revision = await viewer.page.evaluate(() =>
      window.modelViewer.revision
    );
    for (const lighting of options.lighting) {
      for (const view of options.views) {
        await viewer.page.evaluate(({ light, direction, revision, fov }) => {
          if (
            !window.modelViewer.ready || window.modelViewer.error ||
            window.modelViewer.revision !== revision
          ) {
            throw new Error(
              "Model changed during review; retry after editing completes",
            );
          }
          const root =
            (window as unknown as { threejsHairReviewRoot: THREE.Group })
              .threejsHairReviewRoot;
          const scene = root.parent!;
          const lights = scene.children.filter((object) =>
            object.type === "DirectionalLight"
          ) as THREE.DirectionalLight[];
          const hemisphere = scene.children.find((object) =>
            object.type === "HemisphereLight"
          ) as THREE.HemisphereLight;
          if (lights.length !== 2 || !hemisphere) {
            throw new Error("Expected the viewer's key/fill/hemisphere rig");
          }
          hemisphere.intensity = light.hemisphere;
          hemisphere.color.set(light.skyColor);
          hemisphere.groundColor.set(light.groundColor);
          for (
            const [lamp, intensity, color, incoming] of [
              [lights[0], light.key, light.keyColor, light.keyDirection],
              [lights[1], light.fill, light.fillColor, light.fillDirection],
            ] as const
          ) {
            const distance = lamp.position.distanceTo(lamp.target.position);
            lamp.position.set(...incoming as [number, number, number])
              .normalize()
              .multiplyScalar(distance).add(lamp.target.position);
            lamp.intensity = intensity;
            lamp.color.set(color);
            lamp.updateMatrixWorld(true);
            lamp.shadow.needsUpdate = true;
          }
          root.userData.preview.direction = direction;
          const camera = (window as unknown as {
            threejsHairReviewCamera: THREE.PerspectiveCamera;
          }).threejsHairReviewCamera;
          if (!camera?.isPerspectiveCamera) {
            throw new Error("Expected the viewer's perspective camera");
          }
          camera.fov = fov;
          window.modelViewer.fit();
          window.modelViewer.render();
        }, {
          light: presets.lighting[lighting],
          direction: presets.views[view],
          revision,
          fov: presets.camera.fov,
        });
        const file = `${lighting}-${view}.png`;
        await viewer.page.locator("canvas").screenshot({
          path: resolve(options.output, file),
          timeout: options.timeout,
        });
        captures.push({ view, lighting, file });
        console.error(`Saved ${file}`);
      }
    }
    const inspection = await viewer.page.evaluate((revision) => {
      if (
        !window.modelViewer.ready || window.modelViewer.error ||
        window.modelViewer.revision !== revision
      ) {
        throw new Error(
          "Model changed during review; retry after editing completes",
        );
      }
      return window.modelViewer.inspect();
    }, revision);
    const report = {
      version: 1,
      model: options.file,
      headless: true,
      renderer: viewer.renderer,
      width: options.width,
      height: options.height,
      settings: presets,
      hairShadows: options.hairShadows,
      hairShadowResolution: options.hairShadowResolution,
      hairAmbientOcclusion: options.hairAmbientOcclusion,
      hairAmbientResolution: options.hairAmbientResolution,
      hairAmbientDistance: options.hairAmbientDistance,
      note:
        "WebGL ACES preview. Shared light directions and camera aid comparison with Cycles; lighting and color management are not radiometrically identical.",
      captures,
      inspection,
    };
    await Deno.writeTextFile(
      resolve(options.output, "review.json"),
      JSON.stringify(report, null, 2) + "\n",
    );
    return { directory: options.output, captures: captures.length };
  } finally {
    await viewer?.browser.close();
    await server?.close();
    esbuild.stop();
    await Deno.remove(entry);
  }
}

if (import.meta.main) {
  if (Deno.args.includes("--help") || Deno.args.includes("-h")) {
    console.log(usage);
  } else {
    try {
      console.log(
        JSON.stringify(await reviewHair(parseReviewArguments(Deno.args))),
      );
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      Deno.exitCode = 1;
    }
  }
}
