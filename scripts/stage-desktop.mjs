// Assembles the app folder that electron-builder packages: the Electron main and
// preload bundles and the CLI launcher. The Next.js standalone server is shipped
// separately as an extra resource (see electron-builder.yml), because it has its
// own node_modules, which electron-builder would otherwise filter.
//
// Run `bun run desktop:build` first.

import { cp, mkdir, readFile, rm, writeFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const stage = path.join(root, "release", "app");

for (const required of [
  path.join(root, "dist-electron", "main.cjs"),
  path.join(root, ".next", "standalone", "server.js"),
]) {
  try {
    await access(required);
  } catch {
    console.error(`stage-desktop: missing ${path.relative(root, required)}; run "bun run desktop:build" first.`);
    process.exit(1);
  }
}

const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
// electron-builder needs the exact Electron version in the project it packages.
const electron = JSON.parse(await readFile(path.join(root, "node_modules", "electron", "package.json"), "utf8"));
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });

await cp(path.join(root, "dist-electron"), path.join(stage, "dist-electron"), { recursive: true });
await mkdir(path.join(stage, "bin"), { recursive: true });
await cp(path.join(root, "bin", "local-workbench.mjs"), path.join(stage, "bin", "local-workbench.mjs"));
// electron-builder resolves hooks and installer scripts inside the project folder only.
await mkdir(path.join(stage, "build"), { recursive: true });
await cp(path.join(root, "build", "after-pack.cjs"), path.join(stage, "build", "after-pack.cjs"));
await cp(path.join(root, "build", "linux"), path.join(stage, "build", "linux"), { recursive: true });

await writeFile(
  path.join(stage, "package.json"),
  JSON.stringify(
    {
      name: "local-workbench",
      productName: "Local Workbench",
      version: pkg.version,
      description: "Local Workbench: a workspace-aware document editor",
      author: "Local Workbench",
      homepage: "https://github.com/shubhamtaywade82/local-workbench",
      // Linux desktops match windows to launchers by this name (WM_CLASS).
      desktopName: "local-workbench.desktop",
      license: "UNLICENSED",
      private: true,
      main: "dist-electron/main.cjs",
      devDependencies: { electron: electron.version },
    },
    null,
    2
  ) + "\n"
);
console.log(`staged ${path.relative(root, stage)}/ (version ${pkg.version})`);
