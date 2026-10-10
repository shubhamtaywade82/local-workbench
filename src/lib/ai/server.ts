/**
 * Server-side helpers for the AI API routes.
 *
 * Supports both OpenAI-compatible APIs (OpenAI, Azure, Together, Groq, etc.)
 * and Ollama via @nemesis-oss/ollama-sdk's OpenAICompatClient.
 *
 * The OpenAI SDK is only imported from App Router route handlers (under
 * `src/app/api/ai/*`), which run in the Node.js runtime.
 */
import OpenAI from "openai";
import { OllamaClient, OllamaEndpoint } from "@nemesis-oss/ollama-sdk";

/**
 * Provider type for the AI backend.
 */
export type AiProvider = "openai" | "ollama";

/**
 * Get the active AI provider from environment. Defaults to "openai".
 * Set AI_PROVIDER=ollama to use Ollama.
 */
export function getAiProvider(): AiProvider {
  return (process.env.AI_PROVIDER as AiProvider) || "openai";
}

/**
 * Default model for all AI actions. Override with OPENAI_MODEL or OLLAMA_MODEL.
 */
export function getDefaultModel(): string {
  const provider = getAiProvider();
  if (provider === "ollama") {
    return process.env.OLLAMA_MODEL || "llama3.1:8b";
  }
  return process.env.OPENAI_MODEL || "gpt-4o-mini";
}

let openAIClient: OpenAI | undefined;
let ollamaClient: OllamaClient | undefined;

/**
 * Parse Ollama endpoints from environment variable.
 * Expected format (JSON array):
 * [
 *   { "name": "ollama-1", "baseUrl": "http://localhost:11434", "apiKey": "key1", "priority": 1, "models": ["llama3.1:8b", "mistral"] },
 *   { "name": "ollama-2", "baseUrl": "http://ollama2:11434", "apiKey": "key2", "priority": 2 }
 * ]
 *
 * Or via discrete env vars:
 * OLLAMA_ENDPOINT_1_NAME=ollama-1
 * OLLAMA_ENDPOINT_1_BASE_URL=http://localhost:11434
 * OLLAMA_ENDPOINT_1_API_KEY=key1
 * OLLAMA_ENDPOINT_1_PRIORITY=1
 * OLLAMA_ENDPOINT_1_MODELS=llama3.1:8b,mistral
 */
function parseOllamaEndpoints(): OllamaEndpoint[] | undefined {
  // First try JSON array from OLLAMA_ENDPOINTS
  const endpointsJson = process.env.OLLAMA_ENDPOINTS;
  if (endpointsJson) {
    try {
      const parsed = JSON.parse(endpointsJson);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed.map((ep: any) => ({
          name: ep.name,
          baseUrl: ep.baseUrl,
          apiKey: ep.apiKey,
          priority: ep.priority,
          models: ep.models,
        }));
      }
    } catch (e) {
      console.warn("[AI] Failed to parse OLLAMA_ENDPOINTS JSON:", e);
    }
  }

  // Fallback: discrete env vars OLLAMA_ENDPOINT_<N>_*
  const endpoints: OllamaEndpoint[] = [];
  for (let i = 1; i <= 10; i++) {
    const name = process.env[`OLLAMA_ENDPOINT_${i}_NAME`];
    const baseUrl = process.env[`OLLAMA_ENDPOINT_${i}_BASE_URL`];
    const apiKey = process.env[`OLLAMA_ENDPOINT_${i}_API_KEY`];
    const priority = process.env[`OLLAMA_ENDPOINT_${i}_PRIORITY`];
    const models = process.env[`OLLAMA_ENDPOINT_${i}_MODELS`];

    if (name && baseUrl) {
      endpoints.push({
        name,
        baseUrl,
        apiKey,
        priority: priority ? parseInt(priority, 10) : undefined,
        models: models ? models.split(",").map((m) => m.trim()) : undefined,
      });
    }
  }

  if (endpoints.length > 0) {
    return endpoints;
  }

  // Fallback: single endpoint from OLLAMA_BASE_URL + OLLAMA_API_KEY
  const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  const apiKey = process.env.OLLAMA_API_KEY;
  if (baseUrl) {
    return [{ name: "default", baseUrl, apiKey, priority: 1 }];
  }

  return undefined;
}

/**
 * Parse endpoint health strategy from environment.
 * Options: "priority" (default), "round-robin", "least-connections"
 */
function parseEndpointStrategy(): "priority" | "round-robin" | "least-connections" {
  const strategy = process.env.OLLAMA_ENDPOINT_STRATEGY?.toLowerCase();
  if (strategy === "round-robin" || strategy === "least-connections") {
    return strategy;
  }
  return "priority";
}

/**
 * Get or create the OpenAI-compatible client.
 * For Ollama, uses @nemesis-oss/ollama-sdk's OpenAICompatClient which
 * provides the same interface as OpenAI SDK.
 */
export function getOpenAICompatible(): OpenAI {
  const provider = getAiProvider();

  if (provider === "ollama") {
    if (!ollamaClient) {
      const endpoints = parseOllamaEndpoints();
      const strategy = parseEndpointStrategy();

      if (endpoints && endpoints.length > 1) {
        // Multi-endpoint pool with failover and load balancing
        ollamaClient = new OllamaClient({
          endpoints,
          endpointHealth: {
            strategy,
            failureThreshold: 3,
            cooldownMs: 5000,
            maxConcurrentPerEndpoint: 10,
          },
        });
        console.log(`[AI] Initialized Ollama client with ${endpoints.length} endpoints (strategy: ${strategy})`);
      } else if (endpoints && endpoints.length === 1) {
        // Single endpoint
        ollamaClient = new OllamaClient({
          baseUrl: endpoints[0].baseUrl,
          apiKey: endpoints[0].apiKey,
        });
        console.log(`[AI] Initialized Ollama client with single endpoint: ${endpoints[0].name}`);
      } else {
        // Default fallback
        ollamaClient = new OllamaClient({
          baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
        });
        console.log("[AI] Initialized Ollama client with default endpoint");
      }
    }
    // The OllamaClient's openai property is an OpenAICompatClient
    // that implements the same interface as OpenAI SDK
    return ollamaClient.openai as unknown as OpenAI;
  }

  if (openAIClient) return openAIClient;
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured. Set it or use AI_PROVIDER=ollama");
  }

  openAIClient = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  });
  return openAIClient;
}

/**
 * Get the native Ollama client for advanced features (tools, embeddings, etc.)
 * Returns the client configured with endpoint pool if available.
 */
export function getOllamaClient(): OllamaClient | undefined {
  const provider = getAiProvider();
  if (provider !== "ollama") return undefined;

  // Ensure client is initialized
  getOpenAICompatible();
  return ollamaClient;
}

/**
 * Get endpoint health status for monitoring.
 */
export function getOllamaEndpointHealth(): Array<{
  name: string;
  baseUrl: string;
  failureCount: number;
  isCoolingDown: boolean;
  activeRequests: number;
}> | undefined {
  const client = getOllamaClient();
  if (!client) return undefined;

  // Access the internal registry via the client
  // The registry is exposed on the client
  return (client as any).registry?.status?.() || undefined;
}

/**
 * Strip a leading/trailing Markdown code fence from a model response. Models
 * frequently wrap Mermaid / JSON / YAML output in ``` fences despite being
 * asked not to. We remove at most one outer fence and its optional language
 * tag, preserving everything inside (including nested fences).
 */
export function stripCodeFence(text: string): string {
  if (!text) return text;
  const trimmed = text.trim();
  // Match an opening fence ``` optional-language, content, closing fence.
  const fenceMatch = trimmed.match(/^```[a-zA-Z0-9_+\-]*\s*\n([\s\S]*?)\n?```\s*$/);
  if (fenceMatch) return fenceMatch[1].trim();
  return trimmed;
}

/**
 * Try to extract a JSON object from a model response. We attempt:
 *   1. JSON.parse the whole thing.
 *   2. A fenced ```json ... ``` block.
 *   3. The first balanced `{ ... }` substring.
 * Returns `undefined` if none of the strategies yield valid JSON.
 */
export function extractJson<T = unknown>(text: string): T | undefined {
  if (!text) return undefined;
  const tryParse = (s: string): T | undefined => {
    try {
      return JSON.parse(s) as T;
    } catch {
      return undefined;
    }
  };

  // 1. Direct parse.
  const direct = tryParse(text);
  if (direct !== undefined) return direct;

  // 2. Fenced ```json block.
  const fence = text.match(/```(?:json|JSON)?\s*\n([\s\S]*?)\n?```\s*$/);
  if (fence) {
    const parsed = tryParse(fence[1]);
    if (parsed !== undefined) return parsed;
  }

  // 3. First balanced { ... } (greedy across newlines).
  const start = text.indexOf("{");
  if (start !== -1) {
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escape) {
          escape = false;
        } else if (ch === "\\") {
          escape = true;
        } else if (ch === '"') {
          inString = false;
        }
        continue;
      }
      if (ch === '"') {
        inString = true;
        continue;
      }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          const candidate = text.slice(start, i + 1);
          const parsed = tryParse(candidate);
          if (parsed !== undefined) return parsed;
          break;
        }
      }
    }
  }

  return undefined;
}

/**
 * Convert any thrown value into a readable error string.
 */
export function errorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}