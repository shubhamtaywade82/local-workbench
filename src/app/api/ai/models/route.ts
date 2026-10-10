import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/models
 *
 * Returns the configured model using the OpenAI Chat Completions API format.
 */
export async function GET() {
  const model = process.env.OPENAI_MODEL || "gpt-4o-mini";
  const available = Boolean(process.env.OPENAI_API_KEY);

  return NextResponse.json({
    provider: {
      id: "openai-compatible",
      name: "OpenAI-compatible API",
      available,
    },
    models: [{ id: model, name: model }],
  });
}
