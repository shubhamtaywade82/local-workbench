#!/usr/bin/env node
// `local-workbench` launcher. Parses arguments with the same code the app uses,
// starts the Electron app detached, and returns the terminal. Calling it again
// while the app runs forwards the request to the running instance.
//
// Runs in two modes:
//   - development: plain Node, Electron comes from node_modules
//   - packaged:    run by the Electron binary with ELECTRON_RUN_AS_NODE=1
//                  (see the wrapper that the Linux package installs)

import { spawn } from "node:child_process";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(realpathSync(fileURLToPath(import.meta.url))), "..");
const distDir = path.join(appRoot, "dist-electron");
const packaged = Boolean(process.versions.electron);

function fail(message, code = 1) {
  process.stderr.write(`local-workbench: ${message}\n`);
  process.exit(code);
}

function readText(file) {
  try {
    return readFileSync(file, "utf8").trim();
  } catch {
    return null;
  }
}

if (!existsSync(path.join(distDir, "cli.cjs"))) {
  fail(`the desktop build is missing. Run "bun run desktop:build" in ${appRoot}.`);
}
const cli = require(path.join(distDir, "cli.cjs"));

const wsl = cli.detectWsl({
  platform: process.platform,
  env: process.env,
  procVersion: readText("/proc/version") ?? undefined,
});

const userArgs = process.argv.slice(2);
const request = cli.parseCliArgs(userArgs, process.cwd(), wsl);

if (request.kind === "help") {
  process.stdout.write(cli.USAGE);
  process.exit(0);
}
if (request.kind === "version") {
  process.stdout.write(`local-workbench ${cli.VERSION}\n`);
  process.exit(0);
}
if (request.kind === "error") {
  fail(`${request.message}\n\n${cli.USAGE}`, 2);
}

if (process.platform === "linux" && !wsl?.hasDisplay && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  fail(
    wsl
      ? 'WSLg is not available (no DISPLAY or WAYLAND_DISPLAY). From Windows run "wsl --update" and "wsl --shutdown", then open a new WSL terminal.'
      : "no display found (DISPLAY and WAYLAND_DISPLAY are unset); Local Workbench needs a desktop session."
  );
}

let electronBinary;
if (packaged) {
  electronBinary = process.execPath;
} else {
  try {
    electronBinary = require("electron");
  } catch (err) {
    fail(`the Electron binary is not installed: ${err.message}`);
  }
}

if (process.platform === "linux") {
  const helperPath = path.join(path.dirname(electronBinary), "chrome-sandbox");
  const helper = (() => {
    try {
      return statSync(helperPath);
    } catch {
      return null;
    }
  })();
  const advice = cli.sandboxAdvice({
    apparmorRestrictsUserns: readText("/proc/sys/kernel/apparmor_restrict_unprivileged_userns"),
    maxUserNamespaces: readText("/proc/sys/user/max_user_namespaces"),
    helperPath,
    helperIsSetuidRoot: helper ? helper.uid === 0 && (helper.mode & 0o4000) !== 0 : null,
  });
  if (advice) process.stderr.write(`local-workbench: warning: ${advice}\n`);
}

// The app's own stdio is detached: once it is running, the terminal is free.
// Startup failures are written to the desktop log.
const childEnv = { ...process.env, LOCAL_WORKBENCH_HOME: appRoot };
// The launcher may itself be running under ELECTRON_RUN_AS_NODE; the app must not inherit it.
delete childEnv.ELECTRON_RUN_AS_NODE;

const entry = packaged ? [] : [path.join(distDir, "main.cjs")];
const child = spawn(electronBinary, [...entry, "--", ...userArgs], {
  cwd: process.cwd(),
  detached: true,
  stdio: "ignore",
  env: childEnv,
});
child.once("error", (err) => fail(`could not start Electron: ${err.message}`));
child.once("spawn", () => child.unref());
