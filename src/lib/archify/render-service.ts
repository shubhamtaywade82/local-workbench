// Server-only. Renders an Archify IR document into verified HTML.
//
// Each render runs Archify's own `deliver --json` pipeline, the same gate that
// `archify preview` uses: schema, layout, HTML/SVG and route checks. HTML is
// returned only when the delivery receipt reports `ok` and the digest of the
// written file matches the receipt. Everything runs in a private temporary
// directory that is removed afterwards. The draft never touches the user's
// workspace, so the browser workspace types (sample, local folder, server
// folder) all render the same way.

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { AcquireAbortedError, QueueFullError, Semaphore } from "./concurrency";
import { detectArchifyDiagramType } from "./detect";
import {
  ARCHIFY_MAX_SOURCE_BYTES,
  archifyRenderRequestSchema,
  type ArchifyDiagnostic,
  type ArchifyRenderFailure,
  type ArchifyRenderRequest,
  type ArchifyRenderResult,
  type ArchifyValidationSummary,
  type ArchifyWarningDetail,
} from "./contract";
import type { ArchifyRuntime } from "./runtime";

export interface ArchifyRendererOptions {
  readonly runtime: ArchifyRuntime;
  /** Wall-clock budget for one delivery run. */
  readonly timeoutMs?: number;
  readonly maxSourceBytes?: number;
  /** Deliveries that may run at once. */
  readonly maxConcurrent?: number;
  /** Deliveries that may wait for a slot before new ones are refused as `busy`. */
  readonly maxQueued?: number;
  /** Results kept for identical source, type and quality. */
  readonly cacheEntries?: number;
  /** Parent directory for per-render workspaces. Defaults to the OS temp directory. */
  readonly tempRoot?: string;
}

export interface ArchifyRenderer {
  render(input: unknown, options?: { readonly signal?: AbortSignal }): Promise<ArchifyRenderResult>;
}

export const DEFAULT_ARCHIFY_TIMEOUT_MS = 20_000;

const MAX_STDOUT_BYTES = 32 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;
const MAX_DIAGNOSTICS = 20;
const SPECIAL_STAGES = new Set(["request", "too-large", "busy", "timeout", "runtime", "aborted"]);

/**
 * JSON pointer of the first pinned remote brand capture, or null. Archify fetches
 * such URLs while it renders. The workbench renders drafts from any repository,
 * so it refuses that network access. Built-in brand IDs need no network and still work.
 */
export function findRemoteBrandCapture(source: string): string | null {
  let root: unknown;
  try {
    root = JSON.parse(source);
  } catch {
    return null; // Archify reports the syntax error itself.
  }
  const stack: { value: unknown; pointer: string }[] = [{ value: root, pointer: "" }];
  while (stack.length > 0) {
    const { value, pointer } = stack.pop() as { value: unknown; pointer: string };
    if (Array.isArray(value)) {
      value.forEach((entry, index) => stack.push({ value: entry, pointer: `${pointer}/${index}` }));
    } else if (typeof value === "object" && value !== null) {
      for (const [key, entry] of Object.entries(value)) {
        if (key === "brand" && typeof entry === "object" && entry !== null) return `${pointer}/brand`;
        stack.push({ value: entry, pointer: `${pointer}/${key}` });
      }
    }
  }
  return null;
}

function sha256Hex(bytes: string | Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function failure(stage: string, message: string, diagnostics: ArchifyDiagnostic[] = []): ArchifyRenderFailure {
  return { ok: false, stage, message, diagnostics, cached: false };
}

function runtimeFailure(message: string): { result: ArchifyRenderResult; cacheable: boolean } {
  return { result: failure("runtime", message), cacheable: false };
}

function redactPaths(text: string, replacements: readonly (readonly [string, string])[]): string {
  let out = text;
  for (const [absolute, label] of replacements) {
    if (absolute) out = out.split(absolute).join(label);
  }
  return out;
}

function sanitizeCode(value: unknown): string {
  return typeof value === "string" && /^[a-z0-9/_.-]{1,80}$/i.test(value) ? value : "archify/unknown";
}

function sanitizeStage(value: unknown): string {
  if (typeof value !== "string" || !/^[a-z-]{1,32}$/.test(value)) return "render";
  return SPECIAL_STAGES.has(value) ? "render" : value;
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function stringOr(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

/** Child environment. Only what Archify needs to run; the server's secrets stay out. */
function childEnv(): NodeJS.ProcessEnv {
  // Node's spawn accepts any string map; Bun's ProcessEnv type requires NODE_ENV, so cast at the boundary.
  const env: Record<string, string> = { ARCHIFY_UPDATE_CHECK_DISABLED: "1", NO_COLOR: "1" };
  for (const key of ["PATH", "TMPDIR", "TMP", "TEMP", "SYSTEMROOT", "LANG", "LC_ALL"]) {
    const value = process.env[key];
    if (value !== undefined) env[key] = value;
  }
  return env as NodeJS.ProcessEnv;
}

interface CliRun {
  readonly code: number | null;
  readonly signal: NodeJS.Signals | null;
  readonly stdout: string;
  readonly stderr: string;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly outputExceeded: boolean;
  readonly spawnError: Error | null;
}

function runArchifyCli(
  runtime: ArchifyRuntime,
  args: readonly string[],
  options: { cwd: string; timeoutMs: number; signal?: AbortSignal }
): Promise<CliRun> {
  return new Promise((resolve) => {
    const child = spawn(runtime.nodeBinary, [runtime.cli, ...args], {
      cwd: options.cwd,
      env: childEnv(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      // Own process group on POSIX, so a timeout also stops the renderer
      // processes that delivery spawns.
      detached: process.platform !== "win32",
    });

    let stdout = "";
    let stderr = "";
    let stdoutBytes = 0;
    let timedOut = false;
    let aborted = false;
    let outputExceeded = false;
    let settled = false;

    const kill = (): void => {
      try {
        if (process.platform !== "win32" && child.pid !== undefined) process.kill(-child.pid, "SIGKILL");
        else child.kill("SIGKILL");
      } catch {
        // The process already exited.
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, options.timeoutMs);
    const onAbort = (): void => {
      aborted = true;
      kill();
    };
    options.signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (run: CliRun): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      options.signal?.removeEventListener("abort", onAbort);
      resolve(run);
    };

    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdoutBytes += byteLength(chunk);
      if (stdoutBytes > MAX_STDOUT_BYTES) {
        outputExceeded = true;
        kill();
        return;
      }
      stdout += chunk;
    });
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      if (stderr.length < MAX_STDERR_BYTES) stderr += chunk.slice(0, MAX_STDERR_BYTES - stderr.length);
    });

    child.on("error", (error) => {
      finish({ code: null, signal: null, stdout, stderr, timedOut, aborted, outputExceeded, spawnError: error });
    });
    child.on("close", (code, signal) => {
      finish({ code, signal, stdout, stderr, timedOut, aborted, outputExceeded, spawnError: null });
    });
  });
}

function parseReceipt(stdout: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(stdout);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function toDiagnostic(
  entry: unknown,
  redact: (text: string) => string
): ArchifyDiagnostic {
  const record = (typeof entry === "object" && entry !== null ? entry : {}) as Record<string, unknown>;
  const severity = record.severity === "warning" || record.severity === "info" ? record.severity : "error";
  const fixes = Array.isArray(record.supportedFixes) ? record.supportedFixes : [];
  return {
    code: sanitizeCode(record.code),
    severity,
    message: redact(stringOr(record.message, "")).slice(0, 2000),
    supportedFixes: fixes
      .filter((fix): fix is string => typeof fix === "string")
      .slice(0, 8)
      .map((fix) => redact(fix).slice(0, 400)),
  };
}

function summarizeValidation(
  receipt: Record<string, unknown>,
  redact: (text: string) => string
): ArchifyValidationSummary {
  const validation = (typeof receipt.validation === "object" && receipt.validation !== null
    ? receipt.validation
    : {}) as Record<string, unknown>;
  const issues = Array.isArray(validation.compositionIssues) ? validation.compositionIssues : [];
  const warningDetails: ArchifyWarningDetail[] = issues
    .filter((issue): issue is Record<string, unknown> => typeof issue === "object" && issue !== null)
    .filter((issue) => issue.severity === "warning")
    .slice(0, MAX_DIAGNOSTICS)
    .map((issue) => ({
      code: sanitizeCode(issue.code),
      message: redact(stringOr(issue.detail, stringOr(issue.code, ""))).slice(0, 2000),
    }));
  return {
    checksPassed: numberOr(validation.checksPassed, 0),
    checkCount: numberOr(validation.checkCount, 0),
    compositionProfile: stringOr(validation.compositionProfile, "standard"),
    compositionStatus: stringOr(validation.compositionStatus, "unknown"),
    errors: numberOr(validation.errors, 0),
    warnings: numberOr(validation.warnings, warningDetails.length),
    warningDetails,
  };
}

/** Bounded LRU keyed by request digest. */
class LruCache<V> {
  private readonly entries = new Map<string, V>();

  constructor(private readonly capacity: number) {}

  get(key: string): V | undefined {
    const value = this.entries.get(key);
    if (value !== undefined) {
      this.entries.delete(key);
      this.entries.set(key, value);
    }
    return value;
  }

  set(key: string, value: V): void {
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.capacity) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.entries.delete(oldest.value);
    }
  }
}

export function createArchifyRenderer(options: ArchifyRendererOptions): ArchifyRenderer {
  const runtime = options.runtime;
  const timeoutMs = options.timeoutMs ?? DEFAULT_ARCHIFY_TIMEOUT_MS;
  const maxSourceBytes = options.maxSourceBytes ?? ARCHIFY_MAX_SOURCE_BYTES;
  const semaphore = new Semaphore(options.maxConcurrent ?? 2, options.maxQueued ?? 8);
  const cache = new LruCache<ArchifyRenderResult>(options.cacheEntries ?? 64);
  const tempRoot = options.tempRoot ?? os.tmpdir();

  async function deliverOnce(
    request: ArchifyRenderRequest,
    signal: AbortSignal | undefined
  ): Promise<{ result: ArchifyRenderResult; cacheable: boolean }> {
    let workdir: string | undefined;
    try {
      workdir = await fs.mkdtemp(path.join(tempRoot, "archify-render-"));
      const dir = workdir;
      const redact = (text: string): string =>
        redactPaths(text, [
          [dir, "<render-workspace>"],
          [runtime.root, "<archify>"],
        ]);

      const inputPath = path.join(dir, "input.json");
      const outputPath = path.join(dir, "diagram.html");
      await fs.writeFile(inputPath, request.source, { flag: "wx", mode: 0o600 });

      const run = await runArchifyCli(
        runtime,
        ["deliver", request.type, inputPath, outputPath, "--json", "--quality", request.quality],
        { cwd: dir, timeoutMs, signal }
      );

      if (run.aborted) return { result: failure("aborted", "The render was abandoned."), cacheable: false };
      if (run.timedOut) {
        return {
          result: failure("timeout", `Archify did not finish within ${Math.round(timeoutMs / 1000)} seconds.`),
          cacheable: false,
        };
      }
      if (run.spawnError) {
        return runtimeFailure(`Could not start Node.js for Archify: ${redact(run.spawnError.message)}`);
      }
      if (run.outputExceeded) {
        return runtimeFailure("Archify produced more output than the server accepts.");
      }

      const receipt = parseReceipt(run.stdout);
      if (!receipt) {
        const exit = run.code !== null ? `code ${run.code}` : `signal ${run.signal ?? "unknown"}`;
        const tail = redact(run.stderr.trim()).slice(-600);
        return runtimeFailure(`Archify exited with ${exit} without a delivery receipt.${tail ? `\n${tail}` : ""}`);
      }

      if (receipt.ok !== true || run.code !== 0) {
        const diagnostics = Array.isArray(receipt.diagnostics)
          ? receipt.diagnostics.slice(0, MAX_DIAGNOSTICS).map((entry) => toDiagnostic(entry, redact))
          : [];
        const message = redact(stringOr(receipt.error, "Archify rejected the diagram."));
        return {
          result: failure(sanitizeStage(receipt.stage), message.slice(0, 4000), diagnostics),
          cacheable: true,
        };
      }

      const html = await fs.readFile(outputPath);
      const digest = sha256Hex(html);
      const artifact = (typeof receipt.artifact === "object" && receipt.artifact !== null
        ? receipt.artifact
        : {}) as Record<string, unknown>;
      if (digest !== artifact.sha256 || html.byteLength !== artifact.bytes) {
        return runtimeFailure("Archify's receipt does not match the rendered file, so nothing was shown.");
      }

      return {
        result: {
          ok: true,
          type: request.type,
          quality: request.quality,
          html: html.toString("utf8"),
          sha256: digest,
          bytes: html.byteLength,
          cached: false,
          validation: summarizeValidation(receipt, redact),
        },
        cacheable: true,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return runtimeFailure(`Archify render failed: ${message}`);
    } finally {
      if (workdir !== undefined) {
        await fs.rm(workdir, { recursive: true, force: true }).catch(() => undefined);
      }
    }
  }

  return {
    async render(input, { signal } = {}) {
      const parsed = archifyRenderRequestSchema.safeParse(input);
      if (!parsed.success) {
        const diagnostics = parsed.error.issues.slice(0, MAX_DIAGNOSTICS).map((issue) => ({
          code: `request/${sanitizeCode(issue.code)}`,
          severity: "error" as const,
          message: `${issue.path.join(".") || "request"}: ${issue.message}`,
          supportedFixes: [],
        }));
        return failure("request", "The render request is malformed.", diagnostics);
      }
      const request = parsed.data;

      const bytes = byteLength(request.source);
      if (bytes > maxSourceBytes) {
        return failure("too-large", `The document is ${bytes} bytes; the limit is ${maxSourceBytes} bytes.`);
      }

      const declared = detectArchifyDiagramType(request.source);
      if (declared !== null && declared !== request.type) {
        return failure("input", `The document declares diagram_type "${declared}", but the preview asked for "${request.type}".`, [
          {
            code: "archify/type-mismatch",
            severity: "error",
            message: `diagram_type is "${declared}", not "${request.type}".`,
            supportedFixes: [`set diagram_type to "${request.type}", or open the file in its matching preview`],
          },
        ]);
      }

      const remoteBrand = findRemoteBrandCapture(request.source);
      if (remoteBrand !== null) {
        return failure("input", `${remoteBrand} names a remote brand capture. The workbench does not fetch remote brand captures while rendering.`, [
          {
            code: "brand/remote-capture-disabled",
            severity: "error",
            message: `${remoteBrand} is a pinned remote capture, which Archify would fetch from the network.`,
            supportedFixes: ["use a built-in brand ID (see `archify brands`), or render this document with the Archify CLI"],
          },
        ]);
      }

      const key = sha256Hex(`${request.type}\u0000${request.quality}\u0000${request.source}`);
      const cached = cache.get(key);
      if (cached !== undefined) return { ...cached, cached: true } as ArchifyRenderResult;

      let release: () => void;
      try {
        release = await semaphore.acquire(signal);
      } catch (error) {
        if (error instanceof QueueFullError) {
          return failure("busy", "The Archify renderer is busy. The preview will update on the next edit.");
        }
        if (error instanceof AcquireAbortedError) {
          return failure("aborted", "The render was abandoned before it started.");
        }
        throw error;
      }

      try {
        const outcome = await deliverOnce(request, signal);
        if (outcome.cacheable) cache.set(key, outcome.result);
        return outcome.result;
      } finally {
        release();
      }
    },
  };
}

let defaultRenderer: { readonly root: string; readonly renderer: ArchifyRenderer } | null = null;

function timeoutFromEnvironment(): number {
  const raw = Number(process.env.ARCHIFY_RENDER_TIMEOUT_MS);
  return Number.isInteger(raw) && raw >= 1000 ? raw : DEFAULT_ARCHIFY_TIMEOUT_MS;
}

/** The renderer the route uses. One instance per runtime root, so its queue and cache are shared. */
export function getArchifyRenderer(runtime: ArchifyRuntime): ArchifyRenderer {
  if (defaultRenderer === null || defaultRenderer.root !== runtime.root) {
    defaultRenderer = {
      root: runtime.root,
      renderer: createArchifyRenderer({ runtime, timeoutMs: timeoutFromEnvironment() }),
    };
  }
  return defaultRenderer.renderer;
}
