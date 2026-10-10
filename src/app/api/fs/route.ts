import { guardServerFsRequest, jsonResponse } from "@/lib/server-fs/guard";
import {
  createDirectory,
  createFile,
  listDirectory,
  readFile,
  remove,
  rename,
  writeFile,
} from "@/lib/server-fs/ops";
import { ServerFsError } from "@/lib/server-fs/paths";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** JSON envelope overhead allowed on top of the file-size limit. */
const BODY_OVERHEAD_BYTES = 64 * 1024;

type FsRequest =
  | { op: "list"; root: string; path: string }
  | { op: "read"; root: string; path: string }
  | { op: "write"; root: string; path: string; contents: string }
  | { op: "create"; root: string; path: string; contents?: string }
  | { op: "mkdir"; root: string; path: string }
  | { op: "rename"; root: string; path: string; newPath: string }
  | { op: "delete"; root: string; path: string };

/**
 * POST /api/fs
 *
 * Body: `{ op, root, path, ... }` where `root` is a root id from
 * GET /api/fs/roots and `path` is root-relative. Ops: list, read, write,
 * create, mkdir, rename (newPath), delete. Errors: `{ error }` with
 * 400/403/404/409/413/415.
 */
export async function POST(req: Request): Promise<Response> {
  const guard = guardServerFsRequest(req, { expectJsonBody: true });
  if (!guard.ok) return guard.response;
  const { config } = guard;

  const limit = config.maxFileBytes + BODY_OVERHEAD_BYTES;
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > limit) {
    return jsonResponse({ error: "Request body too large" }, 413);
  }

  let body: FsRequest;
  try {
    const raw = await req.text();
    if (Buffer.byteLength(raw, "utf8") > limit) return jsonResponse({ error: "Request body too large" }, 413);
    body = JSON.parse(raw) as FsRequest;
  } catch (err) {
    return jsonResponse({ error: `Invalid JSON body: ${(err as Error).message}` }, 400);
  }

  const root = config.roots.find((r) => r.id === body?.root);
  if (!root) return jsonResponse({ error: "Unknown workspace root" }, 404);

  try {
    switch (body.op) {
      case "list":
        return jsonResponse({ entries: await listDirectory(root, body.path) });
      case "read":
        return jsonResponse({ contents: await readFile(root, config, body.path) });
      case "write":
        await writeFile(root, config, body.path, body.contents);
        return jsonResponse({ ok: true });
      case "create":
        await createFile(root, config, body.path, body.contents ?? "");
        return jsonResponse({ ok: true });
      case "mkdir":
        await createDirectory(root, body.path);
        return jsonResponse({ ok: true });
      case "rename":
        await rename(root, body.path, body.newPath);
        return jsonResponse({ ok: true });
      case "delete":
        await remove(root, body.path);
        return jsonResponse({ ok: true });
      default:
        return jsonResponse({ error: `Unknown op: ${String((body as { op?: unknown })?.op)}` }, 400);
    }
  } catch (err) {
    if (err instanceof ServerFsError) return jsonResponse({ error: err.message }, err.status);
    console.error(`[server-fs] ${body.op} failed:`, err);
    return jsonResponse({ error: "Internal error" }, 500);
  }
}
