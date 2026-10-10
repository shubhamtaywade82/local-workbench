import { NextResponse } from "next/server";
import { getAiProvider, getDefaultModel, getOllamaClient, getOllamaEndpointHealth } from "@/lib/ai/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/models
 *
 * Returns the configured model using the OpenAI Chat Completions API format.
 * Supports both OpenAI-compatible APIs and Ollama (including multi-endpoint pools).
 */
export async function GET() {
  const provider = getAiProvider();
  const model = getDefaultModel();

  let available = false;
  let providerName = "";
  let providerId = "";
  let endpoints: Array<{ name: string; baseUrl: string; healthy: boolean; activeRequests: number }> | undefined;

  if (provider === "ollama") {
    providerId = "ollama";
    providerName = "Ollama (local)";
    try {
      const client = getOllamaClient();
      if (client) {
        await client.listModels();
        available = true;

        // Get endpoint health for multi-endpoint pools
        const health = getOllamaEndpointHealth();
        if (health && health.length > 0) {
          endpoints = health.map((h) => ({
            name: h.name,
            baseUrl: h.baseUrl,
            healthy: h.failureCount === 0 && !h.isCoolingDown,
            activeRequests: h.activeRequests,
          }));
        }
      }
    } catch {
      available = false;
    }
  } else {
    providerId = "openai-compatible";
    providerName = "OpenAI-compatible API";
    available = Boolean(process.env.OPENAI_API_KEY);
  }

  return NextResponse.json({
    provider: {
      id: providerId,
      name: providerName,
      available,
    },
    models: [{ id: model, name: model }],
    ...(endpoints ? { endpoints } : {}),
  });
}