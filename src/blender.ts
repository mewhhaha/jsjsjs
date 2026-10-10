import { basename, dirname, join, resolve } from "node:path";

/** Blender from JS3_BLENDER, otherwise from PATH. */
export function blenderExecutable(): string {
  return Deno.env.get("JS3_BLENDER") || "blender";
}

/** Run a Python script in an isolated, windowless Blender with these args. */
export function blenderCommand(
  script: string,
  args: string[],
  options: Omit<Deno.CommandOptions, "args"> = {},
): Deno.Command {
  return new Deno.Command(blenderExecutable(), {
    ...options,
    args: [
      "--background",
      "--factory-startup",
      "--disable-autoexec",
      "--python-exit-code",
      "1",
      "--python",
      script,
      "--",
      ...args,
    ],
    env: { ...options.env, DISPLAY: "", WAYLAND_DISPLAY: "" },
  });
}

/** Whether Blender starts; optional integrations skip without it. */
export function blenderAvailable(): boolean {
  try {
    return new Deno.Command(blenderExecutable(), {
      args: ["--background", "--version"],
      env: { DISPLAY: "", WAYLAND_DISPLAY: "" },
      stdout: "null",
      stderr: "null",
    }).outputSync().success;
  } catch {
    return false;
  }
}

/** Convert glTF's portable scene data to a native Blender document. */
export async function exportBlend(
  glb: Uint8Array,
  output: string,
  options: { signal: AbortSignal; sourceFile?: string },
): Promise<void> {
  const { signal, sourceFile } = options;
  signal.throwIfAborted();
  const destination = resolve(output);
  await Deno.mkdir(dirname(destination), { recursive: true });
  // Keeping the staging file on the destination filesystem permits an atomic
  // rename and leaves an existing output untouched if import or saving fails.
  const temporary = await Deno.makeTempDir({
    dir: dirname(destination),
    prefix: ".js3-blend-",
  });
  try {
    const input = join(temporary, "model.glb");
    const staged = join(temporary, "model.blend");
    const script = join(temporary, "export-blend.py");
    await Deno.writeFile(input, glb);
    await Deno.copyFile(
      new URL("./export-blend.py", import.meta.url),
      script,
    );
    const sourceArgs: string[] = [];
    if (sourceFile) {
      const source = join(temporary, "source.ts");
      await Deno.copyFile(sourceFile, source);
      sourceArgs.push(source, basename(sourceFile));
    }
    signal.throwIfAborted();
    let child: Deno.ChildProcess;
    try {
      child = blenderCommand(script, [input, staged, ...sourceArgs], {
        stdin: "null",
        stdout: "piped",
        stderr: "piped",
      }).spawn();
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        throw new Error(
          `Blender executable not found: ${blenderExecutable()}. Install Blender and put it on PATH, or set JS3_BLENDER to its executable path.`,
        );
      }
      throw error;
    }
    let exited = false;
    const statusPromise = child.status.then((status) => {
      exited = true;
      return status;
    });
    const cancel = () => {
      if (exited) return;
      try {
        child.kill("SIGKILL");
      } catch (error) {
        // The process can terminate between the status check and kill call.
        if (
          !(error instanceof Deno.errors.NotFound) &&
          !(error instanceof TypeError &&
            error.message.includes("already terminated"))
        ) throw error;
      }
    };
    signal.addEventListener("abort", cancel, { once: true });
    if (signal.aborted) cancel();
    let diagnostics = "";
    const forward = async (stream: ReadableStream<Uint8Array>) => {
      const decoder = new TextDecoder();
      for await (const chunk of stream) {
        diagnostics = (diagnostics + decoder.decode(chunk, { stream: true }))
          .slice(-8000);
        let offset = 0;
        while (offset < chunk.length) {
          offset += await Deno.stderr.write(chunk.subarray(offset));
        }
      }
    };
    try {
      const [status] = await Promise.all([
        statusPromise,
        forward(child.stdout),
        forward(child.stderr),
      ]);
      signal.throwIfAborted();
      if (!status.success) {
        throw new Error(
          `Blender export failed (exit ${status.code}): ${diagnostics.trim()}`,
        );
      }
      const saved = await Deno.stat(staged);
      if (!saved.isFile || saved.size === 0) {
        throw new Error("Blender did not produce a .blend file.");
      }
      signal.throwIfAborted();
      await Deno.rename(staged, destination);
    } finally {
      signal.removeEventListener("abort", cancel);
      // Also reap Blender if forwarding diagnostics or saving the result fails.
      cancel();
      await statusPromise;
    }
  } finally {
    await Deno.remove(temporary, { recursive: true });
  }
}
