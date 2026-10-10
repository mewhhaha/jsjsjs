import { createRequire } from "node:module";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const format = "js3-types";
const manifestName = "manifest.json";

function shellQuote(value: string): string {
  return "'" + value.replaceAll("'", "'\\''") + "'";
}

export interface TypesReport {
  directory: string;
  config: string;
  files: number;
  declarations: number;
  dependencies: Record<string, string>;
}

interface Manifest {
  format: string;
  version: number;
  dependencies: Record<string, string>;
  files: string[];
}

async function filesUnder(directory: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(directory)) {
    const path = join(directory, entry.name);
    if (entry.isSymlink) throw new Error(`Refusing symbolic link: ${path}`);
    if (entry.isDirectory) {
      const children = await filesUnder(path);
      // Empty user directories still make a destination nonempty.
      if (!children.length) files.push(`${entry.name}/`);
      else files.push(...children.map((file) => `${entry.name}/${file}`));
    } else files.push(entry.name);
  }
  return files.sort();
}

async function checkDestination(directory: string, force: boolean) {
  let info: Deno.FileInfo;
  try {
    info = await Deno.lstat(directory);
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return;
    throw error;
  }
  if (!info.isDirectory || info.isSymlink) {
    throw new Error(`Types destination must be a directory: ${directory}`);
  }
  const files = await filesUnder(directory);
  if (!files.length) return;
  if (!force) {
    throw new Error(
      `Types destination is not empty: ${directory}. Use --force to replace a generated types bundle.`,
    );
  }
  let manifest: Manifest;
  try {
    manifest = JSON.parse(
      await Deno.readTextFile(join(directory, manifestName)),
    );
  } catch {
    throw new Error(
      `Refusing to replace a directory without a js3 types manifest: ${directory}`,
    );
  }
  if (
    manifest.format !== format ||
    manifest.version !== 1 ||
    !Array.isArray(manifest.files) ||
    files.some((file) =>
      file !== manifestName && !manifest.files.includes(file)
    )
  ) {
    throw new Error(
      `Refusing to replace a directory containing unrecognized files: ${directory}`,
    );
  }
}

interface PackageMetadata {
  name: string;
  version: string;
  dependencies?: Record<string, string>;
}

/** Copy declarations and their complete package dependency graph, never runtime binaries. */
async function vendorDeclarations(destination: string) {
  const dependencies: Record<string, string> = {};
  const visit = async (packageFile: string): Promise<void> => {
    packageFile = await Deno.realPath(packageFile);
    const metadata: PackageMetadata = JSON.parse(
      await Deno.readTextFile(packageFile),
    );
    if (dependencies[metadata.name]) {
      if (dependencies[metadata.name] !== metadata.version) {
        throw new Error(
          `Conflicting declaration dependency versions for ${metadata.name}`,
        );
      }
      return;
    }
    dependencies[metadata.name] = metadata.version;
    const source = dirname(packageFile);
    const target = join(destination, "vendor/node_modules", metadata.name);
    const copy = async (directory: string): Promise<void> => {
      for await (const entry of Deno.readDir(directory)) {
        if (entry.name === "node_modules" || entry.isSymlink) continue;
        const path = join(directory, entry.name);
        if (entry.isDirectory) await copy(path);
        else if (
          /\.d\.(?:ts|mts|cts)$/.test(entry.name) ||
          entry.name === "package.json" ||
          /^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(entry.name)
        ) {
          const output = join(target, relative(source, path));
          await Deno.mkdir(dirname(output), { recursive: true });
          await Deno.copyFile(path, output);
        }
      }
    };
    await copy(source);
    const require = createRequire(packageFile);
    for (const name of Object.keys(metadata.dependencies ?? {})) {
      // Some packages hide package.json in exports. Locate it by walking from
      // their resolved entry when necessary, preserving the installed version.
      let dependencyFile: string;
      try {
        dependencyFile = require.resolve(`${name}/package.json`);
      } catch {
        let directory = dirname(require.resolve(name));
        while (true) {
          const candidate = join(directory, "package.json");
          try {
            const json = JSON.parse(await Deno.readTextFile(candidate));
            if (json.name === name) {
              dependencyFile = candidate;
              break;
            }
          } catch (error) {
            if (!(error instanceof Deno.errors.NotFound)) throw error;
          }
          const parent = dirname(directory);
          if (directory === parent) {
            throw new Error(`Cannot locate declaration dependency ${name}`);
          }
          directory = parent;
        }
      }
      await visit(dependencyFile);
    }
  };
  await visit(
    createRequire(import.meta.url).resolve("@types/three/package.json"),
  );
  return Object.fromEntries(
    Object.entries(dependencies).sort(([a], [b]) => a.localeCompare(b)),
  );
}

function compilerConfig() {
  const three = "./vendor/node_modules/@types/three";
  return {
    compilerOptions: {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "Bundler",
      strict: true,
      noEmit: true,
      skipLibCheck: false,
      allowImportingTsExtensions: true,
      lib: ["ESNext", "DOM", "DOM.Iterable"],
      baseUrl: ".",
      paths: {
        "js3": ["./src/prelude.d.ts"],
        "js3/prelude": ["./src/prelude.d.ts"],
        "js3/api": ["./web/api.d.ts"],
        "three": [`${three}/index.d.ts`],
        "three/addons": [`${three}/examples/jsm/Addons.d.ts`],
        "three/addons/*": [`${three}/examples/jsm/*`],
        "three/examples/jsm/*": [`${three}/examples/jsm/*`],
        "three/src/*": [`${three}/src/*`],
        "three/webgpu": [`${three}/build/three.webgpu.d.ts`],
        "three/tsl": [`${three}/build/three.tsl.d.ts`],
      },
      typeRoots: ["./vendor/node_modules/@types"],
      types: ["webxr"],
    },
    include: ["../**/*.ts", "../**/*.tsx"],
    exclude: [
      "./**/*",
      "../**/node_modules/**",
      "../**/.git/**",
      "../**/.js3/**",
    ],
  };
}

/** Emit a movable, standalone declaration bundle for authoring models. */
export async function emitTypes(
  directory: string,
  options: { force?: boolean } = {},
): Promise<TypesReport> {
  const output = resolve(directory);
  await checkDestination(output, options.force ?? false);
  await Deno.mkdir(dirname(output), { recursive: true });
  const temporary = await Deno.makeTempDir({
    dir: dirname(output),
    prefix: ".js3-types-",
  });
  const stage = join(temporary, "bundle");
  await Deno.mkdir(stage);
  try {
    const dependencies = await vendorDeclarations(stage);
    const config = compilerConfig();
    const parsed = ts.parseJsonConfigFileContent(config, ts.sys, stage);
    const repository = fileURLToPath(new URL("../", import.meta.url));
    const roots = [
      join(repository, "src/prelude.ts"),
      join(repository, "web/api.ts"),
    ];
    const program = ts.createProgram(roots, {
      ...parsed.options,
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      rootDir: repository,
      outDir: stage,
    });
    const diagnostics = [...ts.getPreEmitDiagnostics(program)];
    if (diagnostics.length) {
      throw new Error(
        `Cannot emit model declarations:\n${
          ts.formatDiagnosticsWithColorAndContext(diagnostics, {
            getCanonicalFileName: (name) => name,
            getCurrentDirectory: () => repository,
            getNewLine: () => "\n",
          })
        }`,
      );
    }
    const emitted = program.emit();
    if (emitted.emitSkipped || emitted.diagnostics.length) {
      throw new Error("TypeScript declaration emit failed.");
    }
    await Deno.writeTextFile(
      join(stage, "tsconfig.json"),
      JSON.stringify(config, null, 2) + "\n",
    );
    await Deno.writeTextFile(
      join(stage, "README.md"),
      `# js3 model types\n\nThis directory contains generated model declarations and all Three.js core/addon declaration dependencies. It can be moved with your project; no source checkout or npm install is needed.\n\nFrom the parent directory, check models with:\n\n\`\`\`sh\ndeno run -A npm:typescript@5.9.3/tsc -p ${
        shellQuote(`${basename(output)}/tsconfig.json`)
      }\n\`\`\`\n\nOr extend this tsconfig from your own tsconfig.json and override include/exclude to select your model files. Import modeling helpers from "js3" or "js3/prelude", Three.js from "three", and addons from "three/addons/...". "js3/api" provides the viewer/report interfaces. These paths provide types only; use the js3 CLI to run and build models.\n\nRegenerate with \`js3 types ${
        shellQuote(basename(output))
      } --force\`. The CLI refuses to replace directories containing unrecognized files.\n`,
    );
    const files = await filesUnder(stage);
    const manifest: Manifest = { format, version: 1, dependencies, files };
    await Deno.writeTextFile(
      join(stage, manifestName),
      JSON.stringify(manifest, null, 2) + "\n",
    );
    // Recheck before replacement in case generation took time. Keep the old
    // bundle until the fully generated replacement is ready for a rename.
    await checkDestination(output, options.force ?? false);
    const backup = join(temporary, "previous");
    let previous = false;
    try {
      await Deno.rename(output, backup);
      previous = true;
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
    try {
      await Deno.rename(stage, output);
    } catch (error) {
      if (previous) await Deno.rename(backup, output);
      throw error;
    }
    return {
      directory: output,
      config: join(output, "tsconfig.json"),
      files: files.length + 1,
      declarations: files.filter((file) =>
        /\.d\.(?:ts|mts|cts)$/.test(file)
      ).length,
      dependencies,
    };
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
}
