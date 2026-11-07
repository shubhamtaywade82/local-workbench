// Server-only adapters for the model port. This is the only task code that
// touches the provider SDKs. Everything else talks to ChatProvider.

import {
  getAiProvider,
  getDefaultModel,
  getOllamaClient,
  getOpenAICompatible,
  getOllamaEndpointHealth,
} from "../server";
import { errorMessage } from "../text";
import { isGenerativeUiEnabled } from "../generative-ui/prompt";

import type { ChatProvider } from "./runner";
import type { PromptMessage } from "./prompts";

export function activeProviderId(): "openai-compatible" | "ollama" {
  return getAiProvider() === "ollama" ? "ollama" : "openai-compatible";
}

export function providerName(id: string): string {
  return id === "ollama" ? "Ollama (local)" : "OpenAI-compatible API";
}

/** Cheap check that needs no network. Ollama is configured by default, so its reachability is probed separately. */
export function providerConfigured(): boolean {
  return activeProviderId() === "ollama" || Boolean(process.env.OPENAI_API_KEY);
}

export function createChatProvider(model: string = getDefaultModel()): ChatProvider {
  const id = activeProviderId();
  return {
    id,
    model,
    async *stream(messages: readonly PromptMessage[], signal: AbortSignal): AsyncIterable<string> {
      const client = getOpenAICompatible();
      const upstream = await client.chat.completions.create(
        { model, messages: messages.map((m) => ({ role: m.role, content: m.content })), stream: true },
        { signal }
      );
      for await (const chunk of upstream) {
        const delta = chunk.choices[0]?.delta?.content;
        if (typeof delta === "string" && delta.length > 0) yield delta;
      }
    },
    async complete(messages: readonly PromptMessage[], signal: AbortSignal): Promise<string> {
      const client = getOpenAICompatible();
      const result = await client.chat.completions.create(
        { model, messages: messages.map((m) => ({ role: m.role, content: m.content })), stream: false },
        { signal }
      );
      return result.choices[0]?.message?.content ?? "";
    },
  };
}

export interface EndpointReport {
  readonly name: string;
  readonly baseUrl: string;
  readonly healthy: boolean;
  readonly activeRequests: number;
  readonly latencyMs?: number;
  readonly version?: string;
  readonly error?: string;
}

export interface AiProviderStatus {
  readonly id: string;
  readonly name: string;
  readonly model: string;
  readonly available: boolean;
  /** What to do when the provider is unavailable. Null when it is available. */
  readonly reason: string | null;
  readonly generativeUi: boolean;
  readonly endpoints?: readonly EndpointReport[];
}

/**
 * Reports whether the configured provider can answer. For Ollama every endpoint
 * is probed, and an endpoint in its failure cooldown counts as unhealthy.
 */
export async function probeAiProvider(model: string = getDefaultModel()): Promise<AiProviderStatus> {
  const id = activeProviderId();
  const base = { id, name: providerName(id), model, generativeUi: isGenerativeUiEnabled() };
  if (id === "openai-compatible") {
    const available = providerConfigured();
    return {
      ...base,
      available,
      reason: available ? null : "Set OPENAI_API_KEY, or set AI_PROVIDER=ollama to use a local model.",
    };
  }
  try {
    const client = getOllamaClient();
    if (!client) return { ...base, available: false, reason: "The Ollama client is not available." };
    const probes = await client.healthCheck();
    const breaker = new Map((getOllamaEndpointHealth() ?? []).map((h) => [h.name, h]));
    const endpoints: EndpointReport[] = probes.map((p) => {
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
    const available = endpoints.some((e) => e.healthy);
    return {
      ...base,
      available,
      reason: available
        ? null
        : `No Ollama endpoint answered (${endpoints.map((e) => e.baseUrl).join(", ")}). Start Ollama or check OLLAMA_BASE_URL.`,
      endpoints,
    };
  } catch (error) {
    return { ...base, available: false, reason: `Ollama could not be reached: ${errorMessage(error)}` };
  }
}
