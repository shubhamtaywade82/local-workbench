// Bundles the Electron main process, preload script and CLI parser into
// dist-electron/ as CommonJS. Requires Bun (uses Bun.build).
//
// Run `bun run build` first: the main process starts .next/standalone/server.js.

import { readFileSync, rmSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
const outdir = path.join(root, "dist-electron");
rmSync(outdir, { recursive: true, force: true });

const result = await Bun.build({
  entrypoints: [
    path.join(root, "electron", "main.ts"),
    path.join(root, "electron", "preload.ts"),
    path.join(root, "electron", "cli.ts"),
  ],
  outdir,
  target: "node",
  format: "cjs",
  external: ["electron"],
  naming: "[name].cjs",
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  sourcemap: "linked",
});

if (!result.success) {
  for (const message of result.logs) console.error(message);
  process.exit(1);
}
console.log(`bundled ${result.outputs.length} files into ${path.relative(root, outdir)}/`);
