/**
 * Request guard for the /api/fs/* routes. These routes read and write files on
 * the server's disk, so every request must prove it comes from this app,
 * running on this machine:
 *
 *  - Feature off (no WORKSPACE_ROOTS)   → 404, the API does not exist.
 *  - Host not in the allowlist          → 403. Defeats DNS rebinding: a hostile
 *    domain re-pointed at 127.0.0.1 still sends its own name as Host.
 *  - Sec-Fetch-Site: cross-site         → 403.
 *  - Origin present and ≠ the Host      → 403.
 *  - Missing `X-Workbench-FS: 1` header → 403. A custom header makes any
 *    cross-origin request preflighted, and no CORS headers are ever sent.
 *  - POST without a JSON content type   → 415.
 *
 * Server-only.
 */
import { getServerFsConfig, type ServerFsConfig } from "./config";

export const SERVER_FS_HEADER = "x-workbench-fs";

const NO_STORE = { "Cache-Control": "no-store" } as const;

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status, headers: NO_STORE });
}

function hostWithoutPort(host: string): string {
  const h = host.trim().toLowerCase();
  if (h.startsWith("[")) return h.slice(0, h.indexOf("]") + 1); // [::1]:3000 → [::1]
  return h.split(":")[0] ?? "";
}

export type GuardResult = { ok: true; config: ServerFsConfig } | { ok: false; response: Response };

export function guardServerFsRequest(req: Request, options: { expectJsonBody: boolean }): GuardResult {
  const config = getServerFsConfig();
  if (!config) return { ok: false, response: jsonResponse({ error: "Server workspace is disabled" }, 404) };

  const deny = (reason: string): GuardResult => {
    console.warn(`[server-fs] rejected ${req.method} ${new URL(req.url).pathname}: ${reason}`);
    return { ok: false, response: jsonResponse({ error: "Forbidden" }, 403) };
  };

  const host = req.headers.get("host");
  if (!host || !config.allowedHosts.has(hostWithoutPort(host))) return deny(`host "${host ?? ""}" not allowed`);

  if (req.headers.get("sec-fetch-site") === "cross-site") return deny("cross-site request");

  const origin = req.headers.get("origin");
  if (origin !== null) {
    let originHost: string;
    try {
      originHost = new URL(origin).host.toLowerCase();
    } catch {
      return deny(`malformed origin "${origin}"`);
    }
    if (originHost !== host.trim().toLowerCase()) return deny(`origin "${origin}" does not match host`);
  }

  if (req.headers.get(SERVER_FS_HEADER) !== "1") return deny(`missing ${SERVER_FS_HEADER} header`);

  if (options.expectJsonBody && !(req.headers.get("content-type") ?? "").toLowerCase().startsWith("application/json")) {
    return { ok: false, response: jsonResponse({ error: "Content-Type must be application/json" }, 415) };
  }
  return { ok: true, config };
}
