#!/usr/bin/env node
// `local-workbench` launcher. Parses arguments with the same code the app uses,
// starts the Electron app detached, and returns the terminal. Calling it again
// while the app runs forwards the request to the running instance.

import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const appRoot = path.resolve(path.dirname(realpathSync(fileURLToPath(import.meta.url))), "..");
const distDir = path.join(appRoot, "dist-electron");

function fail(message, code = 1) {
  process.stderr.write(`local-workbench: ${message}\n`);
  process.exit(code);
}

if (!existsSync(path.join(distDir, "cli.cjs"))) {
  fail(`the desktop build is missing. Run "bun run desktop:build" in ${appRoot}.`);
}
const cli = require(path.join(distDir, "cli.cjs"));

const userArgs = process.argv.slice(2);
const request = cli.parseCliArgs(userArgs, process.cwd());

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

if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  fail("no display found (DISPLAY and WAYLAND_DISPLAY are unset); Local Workbench needs a desktop session.");
}

let electronBinary;
try {
  electronBinary = require("electron");
} catch (err) {
  fail(`the Electron binary is not installed: ${err.message}`);
}

// The app's own stdio is detached: once it is running, the terminal is free.
// Startup failures are written to the desktop log.
const child = spawn(electronBinary, [path.join(distDir, "main.cjs"), "--", ...userArgs], {
  cwd: process.cwd(),
  detached: true,
  stdio: "ignore",
  env: { ...process.env, LOCAL_WORKBENCH_HOME: appRoot },
});
child.once("error", (err) => fail(`could not start Electron: ${err.message}`));
child.once("spawn", () => child.unref());
