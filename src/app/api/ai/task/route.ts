// POST /api/ai/task: runs one assistant task (chat, explain, fix, convert,
// improve-docs, generate-diagram, archify-diagram, architecture-review) and
// streams its events as server-sent events. See src/lib/ai/tasks.

import { createAiTaskHandler } from "@/lib/ai/tasks/http";
import { createRunnerDeps } from "@/lib/ai/tasks/deps";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const handle = createAiTaskHandler(createRunnerDeps);

export async function POST(request: Request): Promise<Response> {
  return handle(request);
}
