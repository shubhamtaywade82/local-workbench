// Puts `local-workbench` on PATH by symlinking the launcher into ~/.local/bin.
// POSIX only for now. Windows needs a .cmd shim, which is not written yet.

import { existsSync, mkdirSync, realpathSync, symlinkSync, unlinkSync, lstatSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform === "win32") {
  console.error("install-cli: Windows is not supported yet. Run bin/local-workbench.mjs directly.");
  process.exit(1);
}

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launcher = path.join(root, "bin", "local-workbench.mjs");
if (!existsSync(path.join(root, "dist-electron", "cli.cjs"))) {
  console.error("install-cli: run `bun run desktop:build` first.");
  process.exit(1);
}

const binDir = path.join(os.homedir(), ".local", "bin");
const link = path.join(binDir, "local-workbench");
mkdirSync(binDir, { recursive: true });

if (existsSync(link) || lstatSync(link, { throwIfNoEntry: false })) {
  const existing = lstatSync(link, { throwIfNoEntry: false });
  if (existing?.isSymbolicLink() && realpathSync(link) === realpathSync(launcher)) {
    console.log(`already installed: ${link}`);
    process.exit(0);
  }
  if (!existing?.isSymbolicLink()) {
    console.error(`install-cli: ${link} exists and is not a symlink created by this script; not overwriting.`);
    process.exit(1);
  }
  unlinkSync(link);
}

symlinkSync(launcher, link);
console.log(`installed ${link} -> ${launcher}`);
if (!(process.env.PATH ?? "").split(path.delimiter).includes(binDir)) {
  console.log(`note: ${binDir} is not on PATH. Add it to your shell profile.`);
}
