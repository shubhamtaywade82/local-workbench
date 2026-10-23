// Runs the production Next.js standalone server as a child process owned by the
// Electron main process, and tears it down on exit.
//
// Security properties enforced here:
//  - Binds 127.0.0.1 only. Next reads HOSTNAME with a 0.0.0.0 fallback, so the
//    inherited value is overridden explicitly.
//  - A fresh 256-bit token per launch, passed in WORKBENCH_DESKTOP_TOKEN. The
//    /api routes reject requests without it (src/proxy.ts).
//  - WORKSPACE_* is stripped. Desktop folders go through the native IPC bridge,
//    so the HTTP filesystem routes stay disabled.
//
// The port is remembered across launches. The renderer's IndexedDB and
// localStorage are scoped to the origin (scheme + host + port), so a new port
// on every start would silently discard recovery drafts and settings.

import { randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import net from "node:net";
import path from "node:path";
import { DESKTOP_TOKEN_ENV } from "../src/lib/desktop/contract";

/** The subset of Electron's UtilityProcess (and Node's ChildProcess) this module uses. */
export interface ServerProcess {
  readonly stdout?: NodeJS.ReadableStream | null;
  readonly stderr?: NodeJS.ReadableStream | null;
  kill(): boolean | void;
  on(event: "exit", listener: (code: number | null) => void): unknown;
}

export type SpawnServer = (
  serverEntry: string,
  options: { readonly cwd: string; readonly env: Record<string, string> }
) => ServerProcess;

export interface ServerManagerOptions {
  /** Directory containing the standalone `server.js`. */
  readonly standaloneDir: string;
  /** JSON file holding the remembered port. */
  readonly stateFile: string;
  readonly spawn: SpawnServer;
  readonly baseEnv: Readonly<Record<string, string | undefined>>;
  readonly log: (line: string) => void;
  /** Called when the server exits while the app is running (not during start or stop). */
  readonly onUnexpectedExit: (code: number | null) => void;
  readonly readyTimeoutMs?: number;
  readonly pollIntervalMs?: number;
}

export interface ServerStartResult {
  readonly origin: string;
  readonly port: number;
  readonly token: string;
}

interface PersistedState {
  readonly port?: number;
}

const DEFAULT_READY_TIMEOUT_MS = 30_000;
const DEFAULT_POLL_INTERVAL_MS = 150;
const PROBE_TIMEOUT_MS = 1_000;

export class ServerManager {
  private child: ServerProcess | null = null;
  private exitInfo: { readonly code: number | null } | null = null;
  private exited: Promise<void> = Promise.resolve();
  private ready = false;
  private stopping = false;

  constructor(private readonly options: ServerManagerOptions) {}

  async start(): Promise<ServerStartResult> {
    if (this.child) throw new Error("the local server is already running");

    const serverEntry = path.join(this.options.standaloneDir, "server.js");
    if (!(await isFile(serverEntry))) {
      throw new Error(`production server not found at ${serverEntry}; run "bun run build" first`);
    }

    const state = await readState(this.options.stateFile);
    const port = await choosePort(state.port);
    const token = randomBytes(32).toString("hex");
    const origin = `http://127.0.0.1:${port}`;

    this.exitInfo = null;
    this.ready = false;
    this.stopping = false;

    const child = this.options.spawn(serverEntry, {
      cwd: this.options.standaloneDir,
      env: buildServerEnv(this.options.baseEnv, { port, token }),
    });
    this.child = child;
    this.exited = new Promise<void>((resolve) => {
      child.on("exit", (code) => {
        this.exitInfo = { code };
        resolve();
        this.handleExit(child, code);
      });
    });
    forwardLines(child.stdout, "[server] ", this.options.log);
    forwardLines(child.stderr, "[server:err] ", this.options.log);

    try {
      await this.waitUntilReady(origin);
    } catch (err) {
      await this.stop(2_000);
      throw err;
    }

    this.ready = true;
    await writeState(this.options.stateFile, { port });
    this.options.log(`server ready at ${origin}`);
    return { origin, port, token };
  }

  /** Stops the server and waits (bounded) for it to exit. Safe to call repeatedly. */
  async stop(timeoutMs = 5_000): Promise<void> {
    const child = this.child;
    if (!child) return;
    this.stopping = true;
    this.child = null;
    try {
      child.kill();
    } catch (err) {
      this.options.log(`failed to signal server: ${(err as Error).message}`);
    }
    await Promise.race([this.exited, sleep(timeoutMs)]);
    if (this.exitInfo === null) this.options.log("server did not exit within the stop timeout");
  }

  private handleExit(child: ServerProcess, code: number | null): void {
    this.options.log(`server exited with code ${code ?? "null"}`);
    if (child !== this.child) return; // superseded or stopped on purpose
    this.child = null;
    if (this.stopping || !this.ready) return; // failures during start surface through start()
    this.options.onUnexpectedExit(code);
  }

  private async waitUntilReady(origin: string): Promise<void> {
    const timeoutMs = this.options.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS;
    const pollMs = this.options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
    const deadline = Date.now() + timeoutMs;

    for (;;) {
      if (this.exitInfo) {
        throw new Error(`local server exited before it was ready (code ${this.exitInfo.code ?? "null"})`);
      }
      if (await probe(origin)) return;
      if (Date.now() >= deadline) {
        throw new Error(`local server did not become ready within ${timeoutMs} ms`);
      }
      await Promise.race([sleep(pollMs), this.exited]);
    }
  }
}

/** Environment for the server process. Built from scratch for the vars that matter. */
export function buildServerEnv(
  baseEnv: Readonly<Record<string, string | undefined>>,
  options: { readonly port: number; readonly token: string }
): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(baseEnv)) {
    if (value === undefined) continue;
    if (key.startsWith("WORKSPACE_")) continue;
    env[key] = value;
  }
  return {
    ...env,
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    PORT: String(options.port),
    HOSTNAME: "127.0.0.1",
    [DESKTOP_TOKEN_ENV]: options.token,
  };
}

/** Uses the remembered port when it is free, otherwise asks the OS for one. */
export async function choosePort(preferred: number | undefined): Promise<number> {
  if (preferred !== undefined && (await isPortFree(preferred))) return preferred;
  return ephemeralPort();
}

function listenOn(port: number): Promise<net.Server> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen({ port, host: "127.0.0.1", exclusive: true }, () => resolve(server));
  });
}

async function isPortFree(port: number): Promise<boolean> {
  try {
    const server = await listenOn(port);
    await new Promise<void>((resolve) => server.close(() => resolve()));
    return true;
  } catch {
    return false;
  }
}

async function ephemeralPort(): Promise<number> {
  const server = await listenOn(0);
  const address = server.address();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (address === null || typeof address === "string") throw new Error("could not allocate a local port");
  return address.port;
}

async function probe(origin: string): Promise<boolean> {
  try {
    const res = await fetch(`${origin}/`, {
      redirect: "manual",
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    await res.body?.cancel();
    return res.status < 500;
  } catch {
    return false;
  }
}

async function readState(file: string): Promise<PersistedState> {
  try {
    const parsed = JSON.parse(await fs.readFile(file, "utf8")) as unknown;
    const port = (parsed as PersistedState | null)?.port;
    return Number.isInteger(port) && (port as number) > 0 && (port as number) < 65536 ? { port } : {};
  } catch {
    return {};
  }
}

async function writeState(file: string, state: PersistedState): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(state, null, 2));
  await fs.rename(tmp, file);
}

async function isFile(file: string): Promise<boolean> {
  try {
    return (await fs.stat(file)).isFile();
  } catch {
    return false;
  }
}

function forwardLines(
  stream: NodeJS.ReadableStream | null | undefined,
  prefix: string,
  log: (line: string) => void
): void {
  if (!stream) return;
  let pending = "";
  stream.on("data", (chunk: Buffer | string) => {
    pending += chunk.toString();
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) if (line.length > 0) log(`${prefix}${line}`);
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
