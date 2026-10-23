// Packages the desktop app: stages the app folder, then runs electron-builder
// with the staged folder as the project. Extra arguments go to electron-builder,
// for example `bun run desktop:package -- --linux dir`.
//
// Run `bun run desktop:build` first.

import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

execFileSync(process.execPath, [path.join(root, "scripts", "stage-desktop.mjs")], { stdio: "inherit" });
process.env.LOCAL_WORKBENCH_STANDALONE = path.join(root, ".next", "standalone");

const builderPkgPath = require.resolve("electron-builder/package.json");
const builderPkg = require(builderPkgPath);
const cli = path.join(path.dirname(builderPkgPath), builderPkg.bin["electron-builder"]);

execFileSync(
  process.execPath,
  [
    cli,
    "--config",
    path.join(root, "electron-builder.yml"),
    "--project",
    path.join(root, "release", "app"),
    ...process.argv.slice(2),
  ],
  { stdio: "inherit" }
);
