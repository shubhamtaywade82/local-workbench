// End-to-end acceptance test for the desktop shell. Drives the real launcher,
// the real Electron window and the real workbench UI over the Chromium
// DevTools protocol.
//
// Covers: open a folder, edit and save (verified on disk), restart and check
// that content and recovery drafts survive, the bridge's rejection of hostile
// requests, the API token guard, repeated invocation, and clean shutdown.
//
// Prerequisites (Linux):
//   - `bun run desktop:build`, which needs a populated node_modules with the
//     Electron binary downloaded.
//   - A display: DISPLAY=:99 with Xvfb, or a real desktop session.
//   - Playwright client, without touching package.json:
//       npm i --no-save playwright-core
//   - Chromium refuses to run as root, so run the app as an unprivileged user:
//       LW_E2E_USER=lwtest node tests/desktop/acceptance.cjs
//     The user needs read access to this repository.
//
// Environment:
//   LW_E2E_USER     user to run the app as (optional; default: current user)
//   LW_E2E_HOME     that user's home directory (default: os.homedir())
//   DISPLAY         display to use (inherited)
//   LW_E2E_CDP_PORT DevTools port for the app (default: 9333)

const { execFileSync, spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const REPO = path.resolve(__dirname, "..", "..");
const LAUNCHER = path.join(REPO, "bin", "local-workbench.mjs");
const USER = process.env.LW_E2E_USER || null;
const HOME = process.env.LW_E2E_HOME || os.homedir();
const CDP_PORT = Number(process.env.LW_E2E_CDP_PORT || 9333);
const STATE_DIR = path.join(HOME, ".config", "Local Workbench");
const stamp = Date.now();
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "lw-acceptance-"));
const PROJ = path.join(TMP, `acc-${stamp}`);
const NOTES = path.join(TMP, `notes-${stamp}`);

let chromium;
try {
  ({ chromium } = require("playwright-core"));
} catch {
  console.error("Missing playwright-core. Install it with: npm i --no-save playwright-core");
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

function mainPids() {
  const out = spawnSync("sh", ["-c", "ps -eo pid,args | grep '[d]ist-electron/main.cjs' | awk '{print $1}'"], {
    encoding: "utf8",
  });
  return out.stdout.split("\n").map((x) => x.trim()).filter(Boolean);
}

/** Runs the launcher the way a user would from a shell in `cwd`. */
function launcher(args, cwd) {
  const env = [
    `HOME=${HOME}`,
    `DISPLAY=${process.env.DISPLAY ?? ""}`,
    `LOCAL_WORKBENCH_REMOTE_DEBUG_PORT=${CDP_PORT}`,
  ];
  const command = ["env", ...env, "node", LAUNCHER, ...args];
  const [bin, binArgs] = USER ? ["runuser", ["-u", USER, "--", ...command]] : [command[0], command.slice(1)];
  return spawnSync(bin, binArgs, { cwd, encoding: "utf8" });
}

async function connect(timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  let browser;
  for (;;) {
    try {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`);
      break;
    } catch (err) {
      if (Date.now() > deadline) throw err;
      await sleep(300);
    }
  }
  return browser;
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

/** Playwright closing a page does not close an Electron window, so quit with SIGTERM. */
async function stopApp(browser) {
  await browser.close().catch(() => {});
  for (const pid of mainPids()) spawnSync("kill", ["-TERM", pid]);
  await waitFor(() => mainPids().length === 0, 20000, 300);
  return mainPids().length === 0;
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

  // ---- Phase 3: the bridge and the API guard reject hostile requests ----
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

  // ---- Phase 4: repeated invocation ----
  const again = launcher(["docs/plan.md"], PROJ);
  check("invoking with a file inside the open folder exits cleanly", again.status === 0, (again.stderr || "").trim());
  check(
    "the file opens in the window that already shows its folder",
    await waitFor(async () => (await editorText(page)).includes("step one"), 20000)
  );
  check("no second window is created for a file in an open folder", appPages(browser).length === 1, `${appPages(browser).length} window(s)`);

  launcher([NOTES], HOME);
  check("a different folder opens a separate window", await waitFor(() => appPages(browser).length === 2, 20000));
  const notes = appPages(browser).find((p) => p !== page);
  if (notes) {
    check("the new window shows the other folder", await waitFor(() => notes.getByText("ideas.md", { exact: true }).isVisible(), 15000));
  }

  // ---- Phase 5: clean shutdown ----
  check("all windows closed and the app process exited", await stopApp(browser), `${mainPids().length} process(es) left`);
}

run()
  .catch((err) => {
    console.error("ACCEPTANCE ERROR:", err);
    results.push({ name: "harness", ok: false });
  })
  .finally(() => {
    for (const pid of mainPids()) spawnSync("kill", ["-TERM", pid]);
    const failed = results.filter((r) => !r.ok).length;
    console.log(`\n${results.length - failed}/${results.length} checks passed`);
    fs.rmSync(TMP, { recursive: true, force: true });
    process.exit(failed ? 1 : 0);
  });
