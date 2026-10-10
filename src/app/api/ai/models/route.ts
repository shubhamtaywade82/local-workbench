import { NextResponse } from "next/server";
import {
  errorMessage,
  getAiProvider,
  getDefaultModel,
  getOllamaClient,
  getOllamaEndpointHealth,
} from "@/lib/ai/server";
import { isGenerativeUiEnabled } from "@/lib/ai/generative-ui/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EndpointReport {
  name: string;
  baseUrl: string;
  healthy: boolean;
  activeRequests: number;
  latencyMs?: number;
  version?: string;
  error?: string;
}

/**
 * GET /api/ai/models
 *
 * Returns the configured model and provider availability. For Ollama every
 * configured endpoint is probed in parallel (`/api/version`) and merged with
 * the client's circuit-breaker state, so a multi-endpoint pool reports
 * available as long as at least one endpoint can serve traffic.
 */
export async function GET() {
  const provider = getAiProvider();
  const model = getDefaultModel();

  let available = false;
  let providerName = "";
  let providerId = "";
  let endpoints: EndpointReport[] | undefined;

  if (provider === "ollama") {
    providerId = "ollama";
    providerName = "Ollama (local)";
    try {
      const client = getOllamaClient();
      if (client) {
        const probes = await client.healthCheck();
        const breaker = new Map((getOllamaEndpointHealth() ?? []).map((h) => [h.name, h]));
        endpoints = probes.map((p) => {
          const state = breaker.get(p.name);
          return {
            name: p.name,
            baseUrl: p.baseUrl,
            healthy: p.reachable && !state?.isCoolingDown,
            activeRequests: state?.activeRequests ?? 0,
            latencyMs: p.latencyMs,
            ...(p.version !== undefined ? { version: p.version } : {}),
            ...(p.error !== undefined ? { error: p.error } : {}),
          };
        });
        available = endpoints.some((e) => e.healthy);
      }
    } catch (err) {
      console.warn("[AI] Ollama availability probe failed:", errorMessage(err));
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
    features: { generativeUi: isGenerativeUiEnabled() },
    ...(endpoints ? { endpoints } : {}),
  });
}
