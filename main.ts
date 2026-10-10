import * as esbuild from "esbuild";
import { main } from "./src/cli/run.ts";

if (import.meta.main) {
  try {
    await main(Deno.args);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (Deno.args.includes("--json")) {
      console.log(JSON.stringify({ ok: false, error: message }));
    }
    console.error(message);
    Deno.exitCode = 1;
  } finally {
    esbuild.stop();
  }
}
