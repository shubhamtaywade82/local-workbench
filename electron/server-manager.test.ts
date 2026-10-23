import { afterAll, beforeAll, afterEach, describe, expect, test } from "bun:test";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildServerEnv, ServerManager, type ServerManagerOptions } from "./server-manager";

// A stand-in for .next/standalone/server.js. It listens where the manager
// tells it to and reports the environment it was started with.
const FAKE_SERVER = `
const http = require("node:http");
const mode = process.env.FAKE_MODE || "serve";
if (mode === "exit-early") process.exit(3);
if (mode === "hang") setInterval(() => {}, 1000);
else {
  const server = http.createServer((req, res) => {
    if (req.url === "/env") {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({
        host: process.env.HOSTNAME,
        port: process.env.PORT,
        token: process.env.WORKBENCH_DESKTOP_TOKEN,
        nodeEnv: process.env.NODE_ENV,
        workspaceRoots: process.env.WORKSPACE_ROOTS ?? null,
      }));
      return;
    }
    if (req.url === "/crash") { res.end("bye"); setTimeout(() => process.exit(9), 10); return; }
    res.end("ok");
  });
  server.listen(Number(process.env.PORT), process.env.HOSTNAME);
  process.on("SIGTERM", () => process.exit(0));
}
`;

describe("buildServerEnv", () => {
  test("overrides HOSTNAME, sets the token and production mode, and drops WORKSPACE_*", () => {
    const env = buildServerEnv(
      { HOSTNAME: "my-laptop", WORKSPACE_ROOTS: "/home/me", WORKSPACE_ALLOWED_HOSTS: "x", PATH: "/bin" },
      { port: 4321, token: "t".repeat(64) }
    );
    expect(env.HOSTNAME).toBe("127.0.0.1");
    expect(env.PORT).toBe("4321");
    expect(env.WORKBENCH_DESKTOP_TOKEN).toBe("t".repeat(64));
    expect(env.NODE_ENV).toBe("production");
    expect(env.PATH).toBe("/bin");
    expect(env.WORKSPACE_ROOTS).toBeUndefined();
    expect(env.WORKSPACE_ALLOWED_HOSTS).toBeUndefined();
  });

  test("skips undefined values from the base environment", () => {
    const env = buildServerEnv({ GONE: undefined, KEEP: "1" }, { port: 1, token: "x" });
    expect("GONE" in env).toBe(false);
    expect(env.KEEP).toBe("1");
  });
});

describe("ServerManager", () => {
  let base: string;
  let standaloneDir: string;
  let stateFile: string;
  const managers: ServerManager[] = [];

  beforeAll(() => {
    base = mkdtempSync(path.join(tmpdir(), "lw-server-"));
    standaloneDir = path.join(base, "standalone");
    mkdirSync(standaloneDir);
    writeFileSync(path.join(standaloneDir, "server.js"), FAKE_SERVER);
    stateFile = path.join(base, "state", "desktop-state.json");
  });

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  afterEach(async () => {
    while (managers.length > 0) await managers.pop()!.stop(2_000);
  });

  function create(overrides: Partial<ServerManagerOptions> = {}, baseEnv: Readonly<Record<string, string>> = {}) {
    const unexpected: (number | null)[] = [];
    const logs: string[] = [];
    const manager = new ServerManager({
      standaloneDir,
      stateFile,
      spawn: (entry, opts) =>
        spawn(process.execPath, [entry], { cwd: opts.cwd, env: opts.env as NodeJS.ProcessEnv, stdio: "pipe" }),
      baseEnv: { PATH: process.env.PATH ?? "", ...baseEnv },
      log: (line) => logs.push(line),
      onUnexpectedExit: (code) => unexpected.push(code),
      readyTimeoutMs: 5_000,
      pollIntervalMs: 20,
      ...overrides,
    });
    managers.push(manager);
    return { manager, unexpected, logs };
  }

  test("serves on loopback with the per-launch token and a clean environment", async () => {
    const { manager } = create({}, { HOSTNAME: "laptop.lan", WORKSPACE_ROOTS: "/etc" });
    const started = await manager.start();

    expect(started.origin).toBe(`http://127.0.0.1:${started.port}`);
    expect(started.token).toMatch(/^[0-9a-f]{64}$/);

    const env = (await (await fetch(`${started.origin}/env`)).json()) as Record<string, unknown>;
    expect(env).toEqual({
      host: "127.0.0.1",
      port: String(started.port),
      token: started.token,
      nodeEnv: "production",
      workspaceRoots: null,
    });
  });

  test("issues a different token on every launch", async () => {
    const first = create();
    const a = await first.manager.start();
    await first.manager.stop();
    const second = create();
    const b = await second.manager.start();
    expect(a.token).not.toBe(b.token);
  });

  test("reuses the remembered port across launches so origin-scoped storage survives", async () => {
    const first = create();
    const a = await first.manager.start();
    await first.manager.stop();

    const second = create();
    const b = await second.manager.start();
    expect(b.port).toBe(a.port);
    expect(JSON.parse(readFileSync(stateFile, "utf8"))).toEqual({ port: a.port });
  });

  test("falls back to another port when the remembered one is busy", async () => {
    const seed = create();
    const first = await seed.manager.start();
    await seed.manager.stop();

    const blocker = net.createServer();
    await new Promise<void>((resolve) => blocker.listen(first.port, "127.0.0.1", () => resolve()));
    try {
      const next = create();
      const started = await next.manager.start();
      expect(started.port).not.toBe(first.port);
      expect(JSON.parse(readFileSync(stateFile, "utf8"))).toEqual({ port: started.port });
    } finally {
      await new Promise<void>((resolve) => blocker.close(() => resolve()));
    }
  });

  test("a second start while running is refused", async () => {
    const { manager } = create();
    await manager.start();
    await expect(manager.start()).rejects.toThrow(/already running/);
  });

  test("reports a server that exits before becoming ready, without treating it as a crash", async () => {
    const { manager, unexpected } = create({}, { FAKE_MODE: "exit-early" });
    await expect(manager.start()).rejects.toThrow(/exited before it was ready \(code 3\)/);
    expect(unexpected).toEqual([]);
  });

  test("times out when the server never listens, and kills the child", async () => {
    const { manager, unexpected } = create({ readyTimeoutMs: 400 }, { FAKE_MODE: "hang" });
    await expect(manager.start()).rejects.toThrow(/did not become ready within 400 ms/);
    expect(unexpected).toEqual([]);
  });

  test("reports an unexpected exit after the server was ready", async () => {
    const { manager, unexpected } = create();
    const started = await manager.start();
    await fetch(`${started.origin}/crash`).catch(() => undefined);
    await waitFor(() => unexpected.length === 1);
    expect(unexpected).toEqual([9]);
  });

  test("stop terminates the server and does not report it as unexpected", async () => {
    const { manager, unexpected } = create();
    const started = await manager.start();
    await manager.stop();
    await expect(fetch(`${started.origin}/`, { signal: AbortSignal.timeout(500) })).rejects.toThrow();
    expect(unexpected).toEqual([]);
  });

  test("stop is idempotent when nothing is running", async () => {
    const { manager } = create();
    await manager.stop();
    await manager.stop();
  });

  test("fails with a build hint when the standalone server is missing", async () => {
    const { manager } = create({ standaloneDir: path.join(base, "nowhere") });
    await expect(manager.start()).rejects.toThrow(/run "bun run build" first/);
  });
});

async function waitFor(condition: () => boolean, timeoutMs = 3_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error("condition not met in time");
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
