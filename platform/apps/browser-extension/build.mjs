// esbuild bundle → dist/extension/ (the load-unpacked directory).
// tsc handles typecheck + the node-testable dist/; this script produces the
// browser bundles, resolving @bridge/core's dependency-free policy module
// into the worker so the extension and the API share one verdict function.
import { build } from "esbuild";
import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dir = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dir, "dist/extension");

mkdirSync(OUT, { recursive: true });
copyFileSync(resolve(__dir, "manifest.json"), resolve(OUT, "manifest.json"));
copyFileSync(resolve(__dir, "popup.html"), resolve(OUT, "popup.html"));

await build({
  entryPoints: [resolve(__dir, "src/background.ts"), resolve(__dir, "src/popup.ts")],
  outdir: OUT,
  bundle: true,
  platform: "browser",
  target: "chrome120",
  format: "esm",
  logLevel: "warning",
});

console.log(`[bridge-extension] built → ${OUT}`);
