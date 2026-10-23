// End-to-end acceptance test for the desktop shell. Drives the real launcher,
// the real Electron window and the real workbench UI over the Chromium
// DevTools protocol.
//
// Covers: open a folder, edit and save (verified on disk), restart and check
// that content and recovery drafts survive, the bridge's rejection of hostile
// requests, the API token guard, the content security policy, save conflicts
// (overwrite and load-from-disk), a WSL-style path argument, repeated
// invocation, switching folders (which must invalidate the old binding), and
// clean shutdown.
//
// Prerequisites (Linux):
//   - `bun run desktop:build`, with the Electron binary downloaded.
//   - A display: DISPLAY=:99 with Xvfb, or a real desktop session.
//   - Playwright client, without touching package.json or the lockfile:
//       bun add --no-save playwright-core
//   - Chromium refuses to run as root, so run the app as an unprivileged user:
//       LW_E2E_USER=lwtest node tests/desktop/acceptance.mjs
//     The user needs read access to this repository.
//
// Environment:
//   LW_E2E_USER       user to run the app as (optional; default: current user)
//   LW_E2E_HOME       that user's home directory (default: os.homedir())
//   DISPLAY           display to use (inherited)
//   LW_E2E_CDP_PORT   DevTools port for the app (default: 9333)
//   LW_E2E_CLI        command that starts the launcher (default: the repository's
//                     bin/local-workbench.mjs; for a packaged build use the
//                     packaged launcher, for example
//                     "ELECTRON_RUN_AS_NODE=1 <app>/local-workbench <app>/resources/app/bin/local-workbench.mjs")
//   LW_E2E_APP_BINARY executable of the app; its main process is identified by
//                     a command line that starts with this path (default: the
//                     Electron binary in node_modules)
//   WSL_DISTRO_NAME   distribution name used for the WSL-style path; set to
//                     simulate WSL on a non-WSL host (default: Ubuntu)

import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const LAUNCHER_CMD = (process.env.LW_E2E_CLI || `node ${path.join(REPO, "bin", "local-workbench.mjs")}`).split(" ");
const USER = process.env.LW_E2E_USER || null;
const HOME = process.env.LW_E2E_HOME || os.homedir();
const CDP_PORT = Number(process.env.LW_E2E_CDP_PORT || 9333);
const APP_BINARY = process.env.LW_E2E_APP_BINARY || path.join(REPO, "node_modules", "electron", "dist", "electron");
const WSL_DISTRO = process.env.WSL_DISTRO_NAME || "Ubuntu";
const STATE_DIR = path.join(HOME, ".config", "Local Workbench");
const stamp = Date.now();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lw-acceptance-"));
const PROJ = path.join(TMP, `acc-${stamp}`);
const NOTES = path.join(TMP, `notes-${stamp}`);

let chromium;
try {
  ({ chromium } = await import("playwright-core"));
} catch {
  console.error("Missing playwright-core. Install it with: bun add --no-save playwright-core");
  process.exit(2);
}

const results = [];
function check(name, ok, detail = "") {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? ` — ${detail}` : ""}`);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(fn, timeoutMs = 10000, interval = 150) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await fn()) return true;
    } catch {
      // keep polling
    }
    if (Date.now() > deadline) return false;
    await sleep(interval);
  }
}

function setupFixtures() {
  for (const dir of [PROJ, path.join(PROJ, "docs"), NOTES]) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(PROJ, "README.md"), "# Acceptance\n\nInitial readme.\n");
  fs.writeFileSync(path.join(PROJ, "docs", "plan.md"), "# Plan\n\n- step one\n");
  fs.writeFileSync(path.join(NOTES, "ideas.md"), "# Ideas\n");
  fs.symlinkSync("/etc/hostname", path.join(PROJ, "escape-link"));
  if (USER) execFileSync("chown", ["-R", `${USER}:${USER}`, TMP]);
}

/**
 * The app's main process. Matched by the executable at the start of the command
 * line, so a shell command that merely mentions the app is never a match.
 * Electron's helper processes carry --type= and are excluded.
 */
function mainPids() {
  const out = spawnSync("ps", ["-eo", "pid,args"], { encoding: "utf8" }).stdout;
  const pids = [];
  for (const line of out.split("\n")) {
    const match = /^\s*(\d+)\s+(.*)$/.exec(line);
    if (!match) continue;
    const [, pid, args] = match;
    if (args.startsWith(`${APP_BINARY} `) && !args.includes("--type=")) pids.push(pid);
  }
  return pids;
}

/** Runs the launcher the way a user would from a shell in `cwd`. */
function launcher(args, cwd, extraEnv = {}) {
  const env = [
    `HOME=${HOME}`,
    `DISPLAY=${process.env.DISPLAY ?? ""}`,
    `LOCAL_WORKBENCH_REMOTE_DEBUG_PORT=${CDP_PORT}`,
    `WSL_DISTRO_NAME=${WSL_DISTRO}`,
    ...Object.entries(extraEnv).map(([key, value]) => `${key}=${value}`),
  ];
  // LW_E2E_CLI may set ELECTRON_RUN_AS_NODE=1 as its first word; keep it in the environment.
  const cli = LAUNCHER_CMD.filter((word) => !word.includes("="));
  const leadingEnv = LAUNCHER_CMD.filter((word) => word.includes("="));
  const command = ["env", ...leadingEnv, ...env, ...cli, ...args];
  const [bin, binArgs] = USER ? ["runuser", ["-u", USER, "--", ...command]] : [command[0], command.slice(1)];
  return spawnSync(bin, binArgs, { cwd, encoding: "utf8" });
}

async function connect(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      return await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await sleep(300);
    }
  }
}

function appPages(browser) {
  return browser
    .contexts()
    .flatMap((c) => c.pages())
    .filter((p) => p.url().startsWith("http://127.0.0.1"));
}

/** The window that shows `text` in its explorer. Each folder is its own window. */
async function windowShowing(browser, text, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (const page of appPages(browser)) {
      if (await page.getByText(text, { exact: true }).first().isVisible().catch(() => false)) return page;
    }
    if (Date.now() > deadline) throw new Error(`no window shows ${text}`);
    await sleep(300);
  }
}

/** Monaco renders the space between words as U+00A0. */
async function editorText(page) {
  const text = await page.locator(".monaco-editor .view-lines").first().innerText();
  return text.replace(/ /g, " ");
}

/** Closing a page does not close an Electron window, so the app is stopped with SIGTERM. */
async function stopApp(browser) {
  await browser.close().catch(() => {});
  for (const pid of mainPids()) spawnSync("kill", ["-TERM", pid]);
  await waitFor(() => mainPids().length === 0, 20000, 300);
  return mainPids().length === 0;
}

/** Records CSP violations and dialogs for a page. Answers dialogs from a queue. */
function instrument(page, dialogAnswers) {
  const state = { violations: [], dialogs: [] };
  page.on("console", (message) => {
    const text = message.text();
    if (/Content Security Policy|Refused to (load|execute|connect|create)/i.test(text)) state.violations.push(text);
  });
  page.on("dialog", (dialog) => {
    state.dialogs.push(dialog.message());
    if (dialogAnswers.shift() === "accept") dialog.accept();
    else dialog.dismiss();
  });
  return state;
}

async function run() {
  setupFixtures();
  for (const pid of mainPids()) spawnSync("kill", ["-TERM", pid]);
  await waitFor(() => mainPids().length === 0, 10000, 300);
  check("no leftover app from an earlier run", mainPids().length === 0);

  // ---- Phase 1: open, edit, save, leave an unsaved draft, quit ----
  const started = launcher([PROJ], HOME);
  check("launcher starts the app", started.status === 0, (started.stderr || "").trim());
  let browser = await connect();
  let page = await windowShowing(browser, path.basename(PROJ));
  const dialogAnswers = [];
  let ui = instrument(page, dialogAnswers);

  const t0 = Date.now();
  await page.getByText("README.md", { exact: true }).first().click();
  const shown = await waitFor(async () => (await editorText(page)).includes("Initial readme"), 30000);
  check("README.md opens in the editor from disk", shown, `${Date.now() - t0} ms`);

  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nEdited by acceptance.");
  await page.keyboard.press("Control+s");
  check(
    "Ctrl+S persists the edit to disk",
    await waitFor(() => fs.readFileSync(path.join(PROJ, "README.md"), "utf8").includes("Edited by acceptance."))
  );
  check("preview pane renders the saved document", (await page.getByText("Edited by acceptance.").count()) >= 1);

  await page.keyboard.type("\nUnsaved draft.");
  await sleep(7000); // recovery drafts are flushed every 5 s
  check("the app quits cleanly on SIGTERM", await stopApp(browser));

  // ---- Phase 2: restart; disk content and recovery drafts must survive ----
  const log = fs.readFileSync(path.join(STATE_DIR, "logs", "desktop.log"), "utf8");
  const ports = new Set([...log.matchAll(/server ready at http:\/\/127\.0\.0\.1:(\d+)/g)].map((m) => m[1]));
  check("the server reuses one port across launches", ports.size === 1, `ports: ${[...ports].join(",")}`);

  launcher([PROJ], HOME);
  browser = await connect();
  page = await windowShowing(browser, path.basename(PROJ));
  ui = instrument(page, dialogAnswers);
  check(
    "disk content persisted across restart",
    fs.readFileSync(path.join(PROJ, "README.md"), "utf8").includes("Edited by acceptance.")
  );
  await page.getByText("README.md", { exact: true }).first().click();
  check(
    "unsaved draft is recovered after restart",
    await waitFor(async () => (await editorText(page)).includes("Unsaved draft."), 30000)
  );
  check("recovered draft is marked dirty", await waitFor(() => page.getByText(/^1 dirty$/).isVisible(), 5000));
  await page.keyboard.press("Control+s");
  await waitFor(() => fs.readFileSync(path.join(PROJ, "README.md"), "utf8").includes("Unsaved draft."));

  // ---- Phase 3: bridge, token guard and content security policy ----
  const probe = await page.evaluate(async () => {
    const target = await window.workbenchDesktop.getLaunchTarget();
    const call = (req) => window.workbenchDesktop.fs({ token: target.token, ...req });
    return {
      traversal: await call({ method: "read", path: "../../../../etc/passwd" }),
      absolute: await call({ method: "read", path: "/etc/passwd" }),
      symlinkEscape: await call({ method: "read", path: "escape-link" }),
      staleToken: await window.workbenchDesktop.fs({ method: "read", token: "00000000", path: "README.md" }),
      malformed: await window.workbenchDesktop.fs({ method: "write", token: target.token, path: "README.md" }),
      apiFromPage: (await fetch("/api/ai/models")).status,
    };
  });
  check("path traversal is rejected", probe.traversal.code === "INVALID_PATH", probe.traversal.message);
  check("absolute path is rejected", probe.absolute.code === "INVALID_PATH", probe.absolute.message);
  check("symlink that leaves the folder is forbidden", probe.symlinkEscape.code === "FORBIDDEN", probe.symlinkEscape.message);
  check("stale binding token is refused", probe.staleToken.code === "STALE_WORKSPACE", probe.staleToken.message);
  check("malformed request is refused", probe.malformed.code === "INVALID_PATH", probe.malformed.message);
  check("the page's own /api call succeeds (token injected by the shell)", probe.apiFromPage === 200, `status ${probe.apiFromPage}`);

  const origin = [...log.matchAll(/server ready at (http:\/\/127\.0\.0\.1:\d+)/g)].pop()[1];
  const outside = await fetch(`${origin}/api/ai/models`).then((r) => r.status);
  check("a local process without the token gets 403", outside === 403, `status ${outside}`);


  // ---- Phase 4: repeated invocation, WSL-style path, save conflicts ----
  const again = launcher(["docs/plan.md"], PROJ);
  check("invoking with a file inside the open folder exits cleanly", again.status === 0, (again.stderr || "").trim());
  check(
    "the file opens in the window that already shows its folder",
    await waitFor(async () => (await editorText(page)).includes("step one"), 20000)
  );
  check("no second window is created for a file in an open folder", appPages(browser).length === 1, `${appPages(browser).length} window(s)`);

  const wslPath = `\\\\wsl.localhost\\${WSL_DISTRO}${PROJ.replace(/\//g, "\\")}`;
  const wslRun = launcher([wslPath], HOME);
  check("a \\\\wsl.localhost path into this distribution is accepted", wslRun.status === 0, (wslRun.stderr || "").trim());
  await sleep(1500);
  check("the WSL-style path focuses the existing folder window", appPages(browser).length === 1, `${appPages(browser).length} window(s)`);

  // Conflict: the file changes on disk after it was opened in the editor.
  const planPath = path.join(PROJ, "docs", "plan.md");
  await page.getByText("plan.md", { exact: true }).first().click();
  await waitFor(async () => (await editorText(page)).includes("step one"), 15000);
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.press("Control+End");
  await page.keyboard.type("\nMy edit.");
  fs.writeFileSync(planPath, "external version\n");
  dialogAnswers.push("dismiss", "dismiss");
  await page.keyboard.press("Control+s");
  await waitFor(() => ui.dialogs.length >= 2, 10000);
  check("a conflicting save asks before writing", ui.dialogs.length >= 2, ui.dialogs[0] ?? "no dialog");
  check("declining both choices writes nothing", fs.readFileSync(planPath, "utf8") === "external version\n");
  check("the edit stays in the tab as a dirty draft", await waitFor(() => page.getByText(/^1 dirty$/).isVisible(), 5000));

  dialogAnswers.push("accept");
  await page.keyboard.press("Control+s");
  check(
    "choosing overwrite writes the tab's version",
    await waitFor(() => fs.readFileSync(planPath, "utf8").includes("My edit."), 8000)
  );

  fs.writeFileSync(planPath, "reloaded version\n");
  await page.locator(".monaco-editor .view-lines").first().click();
  await page.keyboard.type("\nDiscard me.");
  dialogAnswers.push("dismiss", "accept");
  await page.keyboard.press("Control+s");
  check(
    "choosing load-from-disk replaces the tab with the disk version",
    await waitFor(async () => (await editorText(page)).includes("reloaded version") && !(await editorText(page)).includes("Discard me."), 8000)
  );
  check("load-from-disk writes nothing and leaves the tab clean", fs.readFileSync(planPath, "utf8") === "reloaded version\n" && (await waitFor(() => page.getByText(/^0 dirty$/).isVisible(), 5000)));
  check("no Content Security Policy violations in the session", ui.violations.length === 0, ui.violations[0] ?? "");

  // The probes run inside the page's own origin. Cross-origin reachability is
  // tested against the same server on another hostname, which is reachable without
  // the policy, so a blocked result can only come from the policy.
  const header = await page.evaluate(async () => (await fetch(location.href)).headers.get("content-security-policy"));
  check("the document is served with a content security policy", /default-src 'self'/.test(header ?? ""), (header ?? "").slice(0, 60));
  const reach = await page.evaluate(async () => {
    const other = location.origin.replace("127.0.0.1", "localhost");
    const outcome = (url) => fetch(url, { mode: "no-cors" }).then(() => "reached", () => "blocked");
    return { sameOrigin: await outcome(`${location.origin}/`), otherOrigin: await outcome(`${other}/`) };
  });
  check("control: the same origin is reachable from the page", reach.sameOrigin === "reached", reach.sameOrigin);
  check("another origin is blocked by the policy (connect-src 'self')", reach.otherOrigin === "blocked", reach.otherOrigin);
  await sleep(500);
  check("the violation detector records the blocked request", ui.violations.length >= 1, `${ui.violations.length} violation(s)`);

  // ---- Phase 5: a second folder; the window for it is separate ----
  launcher([NOTES], HOME);
  check("a different folder opens a separate window", await waitFor(() => appPages(browser).length === 2, 20000));
  const notes = appPages(browser).find((p) => p !== page);
  if (notes) {
    check("the new window shows the other folder", await waitFor(() => notes.getByText("ideas.md", { exact: true }).isVisible(), 15000));
  }
  if (notes) await notes.close().catch(() => {});
  await waitFor(() => appPages(browser).length === 1, 5000);

  check("the app quits cleanly on SIGTERM", await stopApp(browser));

  // ---- Phase 6: switching folders from the UI invalidates the old binding ----
  launcher([PROJ], HOME, { LOCAL_WORKBENCH_TEST_PICK_DIRECTORY: NOTES });
  browser = await connect();
  page = await windowShowing(browser, path.basename(PROJ));
  instrument(page, []);
  const oldTarget = await page.evaluate(() => window.workbenchDesktop.getLaunchTarget());
  await page.locator('[title="Open folder…"]').first().click();
  const switched = await waitFor(() => page.getByText("ideas.md", { exact: true }).isVisible(), 15000);
  check("Open folder switches the window to the chosen folder", switched);
  const stale = await page.evaluate(
    (token) => window.workbenchDesktop.fs({ method: "read", token, path: "README.md" }),
    oldTarget.token
  );
  check("a request with the previous folder's token is refused", stale.ok === false && stale.code === "STALE_WORKSPACE", JSON.stringify(stale));
  check("the app quits cleanly after switching folders", await stopApp(browser));

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} checks passed`);
  return failed === 0;
}

run()
  .catch((err) => {
    console.error("ACCEPTANCE ERROR:", err);
    results.push({ name: "harness", ok: false });
  })
  .finally(() => {
    for (const pid of mainPids()) spawnSync("kill", ["-TERM", pid]);
    const failed = results.filter((r) => !r.ok).length;
    if (failed) console.log(`${failed} check(s) failed`);
    fs.rmSync(TMP, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  });
