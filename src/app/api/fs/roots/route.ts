import { guardServerFsRequest, jsonResponse } from "@/lib/server-fs/guard";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/fs/roots
 *
 * Lists the server workspace roots configured via WORKSPACE_ROOTS as
 * `{ roots: [{ id, name }] }`. Real paths are never exposed. 404 when the
 * feature is disabled.
 */
export async function GET(req: Request): Promise<Response> {
  const guard = guardServerFsRequest(req, { expectJsonBody: false });
  if (!guard.ok) return guard.response;
  return jsonResponse({
    roots: guard.config.roots.map((r) => ({ id: r.id, name: r.name })),
    maxFileBytes: guard.config.maxFileBytes,
  });
}
