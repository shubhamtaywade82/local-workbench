// Puts `local-workbench` on PATH.
//
//   bun run desktop:install-cli            Linux/macOS: symlink into ~/.local/bin
//   bun run desktop:install-cli --windows  Run inside WSL: write local-workbench.cmd
//                                          to the Windows WindowsApps folder, so
//                                          `local-workbench` works in PowerShell and
//                                          cmd, forwarding to this WSL distribution.

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, symlinkSync, unlinkSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const launcher = path.join(root, "bin", "local-workbench.mjs");
const require = createRequire(import.meta.url);

function fail(message) {
  console.error(`install-cli: ${message}`);
  process.exit(1);
}

if (!existsSync(path.join(root, "dist-electron", "cli.cjs"))) {
  fail("run `bun run desktop:build` first.");
}
const cli = require(path.join(root, "dist-electron", "cli.cjs"));

function readText(file) {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return undefined;
  }
}

const wsl = cli.detectWsl({
  platform: process.platform,
  env: process.env,
  procVersion: readText("/proc/version"),
});

if (process.argv.includes("--windows")) {
  if (!wsl) fail("--windows must be run inside WSL.");
  installWindowsShim();
} else {
  if (process.platform === "win32") fail("on Windows, run this inside WSL with --windows.");
  installSymlink();
}

function installSymlink() {
  const binDir = path.join(os.homedir(), ".local", "bin");
  const link = path.join(binDir, "local-workbench");
  mkdirSync(binDir, { recursive: true });

  const existing = lstatSync(link, { throwIfNoEntry: false });
  if (existing) {
    if (existing.isSymbolicLink() && realpathSync(link) === realpathSync(launcher)) {
      console.log(`already installed: ${link}`);
      return;
    }
    if (!existing.isSymbolicLink()) {
      fail(`${link} exists and is not a symlink created by this script; not overwriting.`);
    }
    unlinkSync(link);
  }

  symlinkSync(launcher, link);
  console.log(`installed ${link} -> ${launcher}`);
  if (!(process.env.PATH ?? "").split(path.delimiter).includes(binDir)) {
    console.log(`note: ${binDir} is not on PATH. Add it to your shell profile.`);
  }
}

function installWindowsShim() {
  let windowsAppData;
  try {
    windowsAppData = execFileSync("cmd.exe", ["/c", "echo %LOCALAPPDATA%"], { encoding: "utf8" }).trim();
  } catch (err) {
    fail(`cannot run cmd.exe through WSL interop (${err.message}). Check that Windows interop is enabled.`);
  }
  const translated = cli.translateArgumentPath(windowsAppData, wsl);
  if (!translated.ok) fail(translated.message);

  const windowsApps = path.join(translated.path, "Microsoft", "WindowsApps");
  if (!existsSync(windowsApps)) fail(`${windowsApps} does not exist; create it or install the shim by hand.`);

  const shim = path.join(windowsApps, "local-workbench.cmd");
  writeFileSync(shim, cli.windowsCommandShim({ distro: wsl.distro }));
  console.log(`installed ${shim}`);
  console.log("open a new PowerShell or cmd window, then run: local-workbench C:\\path\\to\\folder");
}
