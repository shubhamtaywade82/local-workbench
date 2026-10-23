// Electron main process: single-instance handling, window lifecycle, the
// native filesystem bridge, and ownership of the local Next.js server.
//
// Each window is bound to one workspace folder. The renderer never names a
// folder: it sends a relative path plus the binding token it was given, and
// the main process resolves that against the window's own root.

import { app, BrowserWindow, dialog, ipcMain, Menu, session, shell, utilityProcess, type IpcMainInvokeEvent, type WebContents } from "electron";
import { randomUUID } from "node:crypto";
import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import {
  DESKTOP_CHANNELS,
  DESKTOP_TOKEN_HEADER,
  type DesktopCommand,
  type DesktopErrorCode,
  type DesktopFsRequest,
  type DesktopFsResult,
  type DesktopLaunchTarget,
} from "../src/lib/desktop/contract";
import { ServerFsError } from "../src/lib/server-fs/paths";
import { parseCliArgs, resolveTarget, VERSION } from "./cli";
import { NativeWorkspace, openRoot, relativeWithin } from "./native-fs";
import { ServerManager, type ServerProcess } from "./server-manager";
import { externalUrlToOpen, isAppUrl, originOf } from "./window-policy";

const APP_NAME = "Local Workbench";

// Set before anything reads app.getPath(), because it determines userData.
app.setName(APP_NAME);

// Test hook: expose the Chromium DevTools protocol so an end-to-end test can
// drive the real window. Off unless explicitly requested.
if (process.env.LOCAL_WORKBENCH_REMOTE_DEBUG_PORT) {
  app.commandLine.appendSwitch("remote-debugging-port", process.env.LOCAL_WORKBENCH_REMOTE_DEBUG_PORT);
}

// Bun inlines __dirname as the source folder at bundle time, so it cannot locate
// the bundle. The running script path is correct in both development and packaged layouts.
const bundleDir = path.dirname(path.resolve(process.argv[1]));
/** Repository root in development (set by the launcher); the bundle's parent otherwise. */
const appRoot = process.env.LOCAL_WORKBENCH_HOME ?? path.resolve(bundleDir, "..");
/** Set to e.g. http://127.0.0.1:3000 to load `bun run dev` instead of the production server. */
const devServerUrl = process.env.LOCAL_WORKBENCH_DEV_URL;

interface WindowBinding {
  readonly window: BrowserWindow;
  workspace: NativeWorkspace | null;
  token: string | null;
  openFile: string | null;
}

const bindings = new Map<number, WindowBinding>();
let appOrigin: string | null = null;
let desktopToken: string | undefined;
let server: ServerManager | null = null;
let logFile: string | null = null;
let shuttingDown = false;

function log(line: string): void {
  const text = `${new Date().toISOString()} ${line}\n`;
  process.stderr.write(text);
  if (logFile) {
    try {
      appendFileSync(logFile, text);
    } catch {
      // Logging must never take the app down.
    }
  }
}

// ---------------------------------------------------------------------------
// Windows and bindings
// ---------------------------------------------------------------------------

function bindWorkspace(binding: WindowBinding, workspace: NativeWorkspace, openFile: string | null): void {
  binding.workspace = workspace;
  binding.token = randomUUID();
  binding.openFile = openFile;
}

function targetFor(binding: WindowBinding): DesktopLaunchTarget | null {
  if (!binding.workspace || !binding.token) return null;
  return {
    token: binding.token,
    name: binding.workspace.root.name,
    rootId: binding.workspace.root.id,
    openFile: binding.openFile,
  };
}

function findBindingForRoot(rootId: string): WindowBinding | undefined {
  for (const binding of bindings.values()) {
    if (binding.workspace?.root.id === rootId && !binding.window.isDestroyed()) return binding;
  }
  return undefined;
}

function createWindow(workspace: NativeWorkspace | null, openFile: string | null): BrowserWindow {
  if (!appOrigin) throw new Error("the local server is not running");

  const window = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: APP_NAME,
    webPreferences: {
      preload: path.join(bundleDir, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webviewTag: false,
      devTools: !app.isPackaged,
    },
  });

  const id = window.webContents.id;
  const binding: WindowBinding = { window, workspace: null, token: null, openFile: null };
  if (workspace) bindWorkspace(binding, workspace, openFile);
  bindings.set(id, binding);

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => bindings.delete(id));
  guardNavigation(window.webContents, appOrigin);

  window.loadURL(`${appOrigin}/`).catch((err: Error) => {
    log(`failed to load the workbench page: ${err.message}`);
  });
  return window;
}

function guardNavigation(contents: WebContents, origin: string): void {
  const openOutside = (url: string): void => {
    const safe = externalUrlToOpen(url);
    if (safe) void shell.openExternal(safe);
  };
  contents.setWindowOpenHandler(({ url }) => {
    openOutside(url);
    return { action: "deny" };
  });
  const blockForeign = (event: Electron.Event, url: string): void => {
    if (isAppUrl(url, origin)) return;
    event.preventDefault();
    openOutside(url);
  };
  contents.on("will-navigate", blockForeign);
  contents.on("will-redirect", blockForeign);
  contents.on("will-attach-webview", (event) => event.preventDefault());
}

function focus(window: BrowserWindow): void {
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
}

function sendCommand(window: BrowserWindow | null | undefined, command: DesktopCommand): void {
  const target = window ?? BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
  target?.webContents.send(DESKTOP_CHANNELS.command, command);
}

// ---------------------------------------------------------------------------
// Invocations (first launch and `local-workbench` run again)
// ---------------------------------------------------------------------------

/** Arguments after the `--` the launcher inserts; everything before it belongs to Electron. */
function userArgsFrom(argv: readonly string[]): string[] {
  const index = argv.indexOf("--");
  return index === -1 ? [] : argv.slice(index + 1);
}

async function handleInvocation(argv: readonly string[], cwd: string): Promise<void> {
  const request = parseCliArgs(userArgsFrom(argv), cwd);
  if (request.kind === "error") {
    log(`ignored invocation: ${request.message}`);
    return;
  }
  if (request.kind !== "open") return; // help and version are answered by the launcher

  if (request.targets.length === 0) {
    const current = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    if (current) focus(current);
    else createWindow(null, null);
    return;
  }

  for (const target of request.targets) {
    await openTarget(target, request.newWindow);
  }
}

/**
 * Routes a target to an existing window when one already covers it, and opens
 * a new window otherwise. Existing windows are never retargeted, so unsaved
 * edits in another folder are not disturbed.
 *
 *  - A file inside an open window's folder opens in that window.
 *  - A folder already open is focused.
 */
async function openTarget(absolutePath: string, newWindow: boolean): Promise<void> {
  try {
    const resolved = await resolveTarget(absolutePath);

    if (!newWindow && resolved.openFile) {
      const file = path.join(resolved.rootPath, resolved.openFile);
      for (const binding of bindings.values()) {
        const rel = binding.workspace ? relativeWithin(binding.workspace.root.realPath, file) : null;
        if (rel && !binding.window.isDestroyed()) {
          focus(binding.window);
          sendCommand(binding.window, { kind: "open-file", path: rel });
          return;
        }
      }
    }

    const workspace = new NativeWorkspace(await openRoot(resolved.rootPath));
    if (!newWindow) {
      const existing = findBindingForRoot(workspace.root.id);
      if (existing) {
        focus(existing.window);
        return;
      }
    }
    createWindow(workspace, resolved.openFile);
  } catch (err) {
    log(`cannot open ${absolutePath}: ${(err as Error).message}`);
    dialog.showErrorBox(APP_NAME, (err as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Filesystem bridge (renderer -> main)
// ---------------------------------------------------------------------------

const FS_METHODS = new Set(["list", "read", "write", "create", "mkdir", "rename", "delete"]);

/** Checks the shape of an untrusted request. Path validation happens in NativeWorkspace. */
function parseFsRequest(raw: unknown): DesktopFsRequest | null {
  if (typeof raw !== "object" || raw === null) return null;
  const request = raw as Record<string, unknown>;
  if (typeof request.method !== "string" || !FS_METHODS.has(request.method)) return null;
  if (typeof request.token !== "string" || typeof request.path !== "string") return null;
  if ((request.method === "write" || request.method === "create") && typeof request.contents !== "string") return null;
  if (request.method === "rename" && typeof request.newPath !== "string") return null;
  return raw as DesktopFsRequest;
}

/** Only the top frame of our own origin may call the bridge. */
function isTrustedSender(event: IpcMainInvokeEvent): boolean {
  const frame = event.senderFrame;
  if (!frame || appOrigin === null) return false;
  return frame.parent === null && originOf(frame.url) === appOrigin;
}

const STATUS_TO_CODE: Readonly<Record<number, DesktopErrorCode>> = {
  400: "INVALID_PATH",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "TOO_LARGE",
  415: "UNSUPPORTED",
};

function failure(code: DesktopErrorCode, message: string): DesktopFsResult {
  return { ok: false, code, message };
}

function fromError(err: unknown): DesktopFsResult {
  if (err instanceof ServerFsError) {
    return failure(STATUS_TO_CODE[err.status] ?? "INTERNAL", err.message);
  }
  log(`filesystem operation failed: ${err instanceof Error ? (err.stack ?? err.message) : String(err)}`);
  return failure("INTERNAL", "filesystem operation failed; see the desktop log");
}

async function runFsRequest(workspace: NativeWorkspace, request: DesktopFsRequest): Promise<DesktopFsResult> {
  switch (request.method) {
    case "list":
      return { ok: true, value: await workspace.list(request.path) };
    case "read":
      return { ok: true, value: await workspace.read(request.path) };
    case "write":
      await workspace.write(request.path, request.contents);
      return { ok: true, value: null };
    case "create":
      await workspace.create(request.path, request.contents);
      return { ok: true, value: null };
    case "mkdir":
      await workspace.mkdir(request.path);
      return { ok: true, value: null };
    case "rename":
      await workspace.rename(request.path, request.newPath);
      return { ok: true, value: null };
    case "delete":
      await workspace.delete(request.path);
      return { ok: true, value: null };
  }
}

function registerIpc(): void {
  ipcMain.handle(DESKTOP_CHANNELS.launchTarget, (event): DesktopLaunchTarget | null => {
    if (!isTrustedSender(event)) return null;
    const binding = bindings.get(event.sender.id);
    if (!binding) return null;
    const target = targetFor(binding);
    // The file to open is delivered once. A reload should not reopen it.
    binding.openFile = null;
    return target;
  });

  ipcMain.handle(DESKTOP_CHANNELS.chooseWorkspace, async (event): Promise<DesktopLaunchTarget | null> => {
    if (!isTrustedSender(event)) return null;
    const binding = bindings.get(event.sender.id);
    if (!binding) return null;

    const options: Electron.OpenDialogOptions = { title: "Open folder", properties: ["openDirectory"] };
    const parent = BrowserWindow.fromWebContents(event.sender);
    const picked = parent ? await dialog.showOpenDialog(parent, options) : await dialog.showOpenDialog(options);
    if (picked.canceled || picked.filePaths.length === 0) return null;

    try {
      bindWorkspace(binding, new NativeWorkspace(await openRoot(picked.filePaths[0])), null);
      return targetFor(binding);
    } catch (err) {
      dialog.showErrorBox(APP_NAME, (err as Error).message);
      return null;
    }
  });

  ipcMain.handle(DESKTOP_CHANNELS.fs, async (event, raw: unknown): Promise<DesktopFsResult> => {
    if (!isTrustedSender(event)) return failure("FORBIDDEN", "request did not come from the workbench page");
    const binding = bindings.get(event.sender.id);
    if (!binding?.workspace || !binding.token) return failure("STALE_WORKSPACE", "this window has no workspace");

    const request = parseFsRequest(raw);
    if (!request) return failure("INVALID_PATH", "malformed filesystem request");
    if (request.token !== binding.token) {
      return failure("STALE_WORKSPACE", "the workspace was replaced; reopen the folder");
    }

    try {
      return await runFsRequest(binding.workspace, request);
    } catch (err) {
      return fromError(err);
    }
  });
}

// ---------------------------------------------------------------------------
// Session, menu and server
// ---------------------------------------------------------------------------

function configureSession(origin: string, token: string | undefined): void {
  const ses = session.defaultSession;
  // The workbench does not need any browser permission. Deny everything requested.
  ses.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
  ses.setPermissionCheckHandler((_webContents, permission) => permission === "clipboard-sanitized-write");

  if (token) {
    ses.webRequest.onBeforeSendHeaders({ urls: [`${origin}/api/*`] }, (details, callback) => {
      callback({ requestHeaders: { ...details.requestHeaders, [DESKTOP_TOKEN_HEADER]: token } });
    });
  }
}

function buildMenu(): void {
  const isMac = process.platform === "darwin";
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: "appMenu" as const }] : []),
    {
      label: "File",
      submenu: [
        {
          label: "Open Folder…",
          accelerator: "CmdOrCtrl+O",
          click: (_item, window) =>
            sendCommand(window instanceof BrowserWindow ? window : null, { kind: "open-folder" }),
        },
        {
          label: "New Window",
          accelerator: "CmdOrCtrl+Shift+N",
          click: () => {
            if (appOrigin) createWindow(null, null);
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function reportFatal(err: unknown): void {
  const message = err instanceof Error ? err.message : String(err);
  log(`fatal: ${err instanceof Error ? (err.stack ?? message) : message}`);
  dialog.showErrorBox(APP_NAME, `${message}\n\nSee ${logFile ?? "the desktop log"} for details.`);
  app.exit(1);
}

async function startup(): Promise<void> {
  logFile = path.join(app.getPath("logs"), "desktop.log");
  mkdirSync(path.dirname(logFile), { recursive: true });
  log(`starting ${APP_NAME} ${VERSION} (app root: ${appRoot})`);

  if (devServerUrl) {
    appOrigin = originOf(devServerUrl);
    if (!appOrigin) throw new Error(`LOCAL_WORKBENCH_DEV_URL is not a valid URL: ${devServerUrl}`);
  } else {
    server = new ServerManager({
      standaloneDir: path.join(appRoot, ".next", "standalone"),
      stateFile: path.join(app.getPath("userData"), "desktop-state.json"),
      spawn: (entry, options) =>
        utilityProcess.fork(entry, [], {
          cwd: options.cwd,
          env: options.env,
          stdio: "pipe",
          serviceName: "local-workbench-server",
        }) as unknown as ServerProcess,
      baseEnv: process.env,
      log,
      onUnexpectedExit: (code) => {
        log(`local server stopped unexpectedly (code ${code ?? "null"})`);
        dialog.showErrorBox(APP_NAME, `The local server stopped unexpectedly. See ${logFile} for details.`);
        app.quit();
      },
    });
    const started = await server.start();
    appOrigin = started.origin;
    desktopToken = started.token;
  }

  configureSession(appOrigin ?? "", desktopToken);
  buildMenu();
  registerIpc();
  await handleInvocation(process.argv, process.cwd());
  if (BrowserWindow.getAllWindows().length === 0) createWindow(null, null);
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another instance owns the app and has received this invocation.
  app.quit();
} else {
  const started = app.whenReady().then(startup);
  started.catch(reportFatal);

  // A second invocation can arrive while the server is still starting; hold it until then.
  app.on("second-instance", (_event, argv, workingDirectory) => {
    void started
      .then(() => handleInvocation(argv, workingDirectory))
      .catch((err: unknown) => log(`invocation failed: ${String(err)}`));
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0 && appOrigin) createWindow(null, null);
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (shuttingDown || !server) return;
    event.preventDefault();
    shuttingDown = true;
    void server.stop().finally(() => app.quit());
  });

  // A terminal Ctrl+C or a plain `kill` quits through the same path as the menu:
  // before-quit stops the server before the process exits.
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, () => {
      log(`received ${signal}; quitting`);
      app.quit();
    });
  }

  process.on("uncaughtException", (err) => log(`uncaught exception: ${err.stack ?? err.message}`));
}
