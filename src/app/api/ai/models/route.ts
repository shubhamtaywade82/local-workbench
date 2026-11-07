// GET /api/ai/models: the configured provider, its model, and whether it can
// answer. When it cannot, `reason` says what to change.

import { NextResponse } from "next/server";

import { probeAiProvider } from "@/lib/ai/tasks/provider";
import { getDefaultModel } from "@/lib/ai/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = await probeAiProvider(getDefaultModel());
  return NextResponse.json(
    {
      provider: { id: status.id, name: status.name, available: status.available, reason: status.reason },
      models: [{ id: status.model, name: status.model }],
      features: { generativeUi: status.generativeUi },
      ...(status.endpoints ? { endpoints: status.endpoints } : {}),
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
