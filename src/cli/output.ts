import { dirname, resolve } from "node:path";
import type { Page } from "playwright";
import type { ModelServer, UploadSink } from "../server.ts";
import type { GroomExportGroup } from "../../web/api.ts";

// Replace outputs only once their complete contents have been generated.
export async function writeOutput(
  path: string,
  data: Uint8Array | string | AsyncIterable<Uint8Array>,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  await Deno.mkdir(dirname(path), { recursive: true });
  const temporary = await Deno.makeTempFile({
    dir: dirname(path),
    prefix: ".js3-",
  });
  try {
    if (typeof data === "string") await Deno.writeTextFile(temporary, data);
    else if (data instanceof Uint8Array) await Deno.writeFile(temporary, data);
    else {
      const file = await Deno.open(temporary, { write: true, truncate: true });
      try {
        for await (const chunk of data) {
          signal.throwIfAborted();
          for (let offset = 0; offset < chunk.byteLength;) {
            offset += await file.write(chunk.subarray(offset));
          }
        }
      } finally {
        file.close();
      }
    }
    signal.throwIfAborted();
    await Deno.rename(temporary, path);
  } finally {
    await Deno.remove(temporary).catch(() => {});
  }
}

/** Reject on abort without waiting for work that cannot be cancelled. */
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    if (signal.aborted) abort();
    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() =>
      signal.removeEventListener("abort", abort)
    );
  });
}

/**
 * Open a one-time receiver, let the page upload into it, then close it. The
 * first rejected file fails the transfer even if the page ignored it.
 */
async function receive<T>(
  server: Pick<ModelServer, "receive">,
  limit: number,
  signal: AbortSignal,
  sink: UploadSink,
  upload: (url: string) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  let failure: unknown;
  const receiver = server.receive(async (path, body) => {
    try {
      await sink(path, body);
    } catch (error) {
      failure ??= error;
      throw error;
    }
  }, { limit });
  try {
    const result = await abortable(upload(receiver.url), signal);
    if (failure) throw failure;
    return result;
  } catch (error) {
    signal.throwIfAborted();
    throw failure ?? error;
  } finally {
    await receiver.close();
  }
}

/** Yield a stream unchanged once its first `size` bytes pass `check`. */
async function* checked(
  body: AsyncIterable<Uint8Array>,
  size: number,
  check: (head: DataView) => void,
): AsyncGenerator<Uint8Array> {
  let head = new Uint8Array(0);
  for await (const chunk of body) {
    if (head.byteLength >= size) {
      yield chunk;
      continue;
    }
    const joined = new Uint8Array(head.byteLength + chunk.byteLength);
    joined.set(head);
    joined.set(chunk, head.byteLength);
    head = joined;
    if (head.byteLength < size) continue;
    check(new DataView(head.buffer, 0, size));
    yield head;
  }
  if (head.byteLength < size) check(new DataView(head.buffer));
}

async function* glb(body: AsyncIterable<Uint8Array>) {
  let expected = 0, total = 0;
  for await (
    const chunk of checked(body, 20, (header) => {
      if (
        header.byteLength < 20 ||
        header.getUint32(0, true) !== 0x46546c67 ||
        header.getUint32(4, true) !== 2 ||
        header.getUint32(16, true) !== 0x4e4f534a
      ) throw new Error("GLB upload has an invalid header.");
      expected = header.getUint32(8, true);
    })
  ) {
    total += chunk.byteLength;
    if (total > expected) break;
    yield chunk;
  }
  if (total !== expected) {
    throw new Error("GLB upload length does not match its header.");
  }
}

/** Receive the viewer's GLB, replacing `path` only after a complete upload. */
export async function receiveGLB(
  server: Pick<ModelServer, "receive">,
  page: Page,
  path: string,
  signal: AbortSignal,
) {
  let accepted = false, written = false;
  await receive(server, 0xffffffff, signal, async (name, body) => {
    if (name !== "model.glb" || accepted) {
      throw new Error(`Unexpected GLB upload path: ${name}`);
    }
    accepted = true;
    await writeOutput(path, glb(body), signal);
    written = true;
  }, (url) => page.evaluate((url) => window.modelViewer.uploadGLB(url), url));
  if (!written) throw new Error("Viewer did not upload model.glb.");
}

const groomFiles = {
  source: "groom.json",
  manifest: "manifest.json",
  coverage: "coverage.png",
  normal: "normal.png",
  tangent: "tangent.png",
  depth: "depth.png",
  attributes: "attributes.png",
};
const groomDirectory = /^grooms\/\d{3}-[a-z0-9]+(?:-[a-z0-9]+)*$/;
const png = [137, 80, 78, 71, 13, 10, 26, 10];

/** Receive editable grooms and every baked map below `directory`. */
export async function receiveGrooms(
  server: Pick<ModelServer, "receive">,
  page: Page,
  directory: string,
  signal: AbortSignal,
): Promise<GroomExportGroup[]> {
  const names = Object.values(groomFiles);
  const accepted = new Set<string>(), written = new Set<string>();
  const directories = new Set<string>();
  const valid = (path: string) => {
    const slash = path.lastIndexOf("/");
    const folder = path.slice(0, slash);
    return groomDirectory.test(folder) && folder.length <= 64 &&
      names.includes(path.slice(slash + 1));
  };
  const grooms = await receive(
    server,
    256 * 1024 * 1024,
    signal,
    async (path, body) => {
      if (!valid(path) || accepted.has(path)) {
        throw new Error(`Unsafe or duplicate groom upload path: ${path}`);
      }
      directories.add(dirname(path));
      if (directories.size > 64) throw new Error("Too many groom uploads.");
      accepted.add(path);
      const data = path.endsWith(".png")
        ? checked(body, 8, (header) => {
          if (
            header.byteLength < 8 ||
            !png.every((value, at) => header.getUint8(at) === value)
          ) throw new Error(`Groom PNG ${path} has an invalid header.`);
        })
        : checked(body, 1, (header) => {
          if (header.byteLength < 1 || header.getUint8(0) !== 123) {
            throw new Error(`Groom JSON ${path} has an invalid header.`);
          }
        });
      await writeOutput(resolve(directory, path), data, signal);
      written.add(path);
    },
    (url) => page.evaluate((url) => window.modelViewer.uploadGrooms(url), url),
  );
  if (!Array.isArray(grooms) || grooms.length > 64) {
    throw new Error("Viewer returned invalid groom metadata.");
  }
  const listed = new Set<string>();
  const result = grooms.map((group) => {
    if (
      typeof group?.name !== "string" ||
      typeof group.directory !== "string" ||
      !groomDirectory.test(group.directory) || !group.files ||
      Object.keys(group.files).length !== names.length
    ) throw new Error("Viewer returned invalid groom output paths.");
    const files = Object.fromEntries(
      Object.entries(groomFiles).map(([key, name]) => {
        const path = `${group.directory}/${name}`;
        if (
          group.files[key as keyof typeof groomFiles] !== path ||
          listed.has(path)
        ) throw new Error("Viewer returned invalid groom output paths.");
        listed.add(path);
        return [key, resolve(directory, path)];
      }),
    ) as GroomExportGroup["files"];
    return {
      ...group,
      directory: resolve(directory, group.directory),
      files,
    };
  });
  if (
    listed.size !== written.size ||
    [...listed].some((path) => !written.has(path))
  ) throw new Error("Viewer groom uploads do not match its metadata.");
  return result;
}
