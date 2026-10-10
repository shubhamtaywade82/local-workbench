/**
 * Server-side helpers for the AI API routes.
 *
 * Supports both OpenAI-compatible APIs (OpenAI, Azure, Together, Groq, etc.)
 * and Ollama via @nemesis-oss/ollama-sdk (single endpoint or multi-endpoint
 * pool with failover). Both providers are exposed to routes through the same
 * narrow, typed `ChatCompletionsClient` so a provider mismatch is a compile
 * error rather than a runtime `undefined`.
 *
 * Only imported from App Router route handlers (under `src/app/api/ai/*`),
 * which run in the Node.js runtime.
 */
import OpenAI from "openai";
import { OllamaClient, type OllamaEndpoint } from "@nemesis-oss/ollama-sdk";

/**
 * Provider type for the AI backend.
 */
export type AiProvider = "openai" | "ollama";

const AI_PROVIDERS: readonly AiProvider[] = ["openai", "ollama"];

/**
 * Get the active AI provider from environment. Defaults to "openai".
 * Set AI_PROVIDER=ollama to use Ollama. Unknown values fall back to "openai"
 * with a warning instead of being passed through unchecked.
 */
export function getAiProvider(): AiProvider {
  const raw = process.env.AI_PROVIDER?.trim().toLowerCase();
  if (!raw) return "openai";
  if ((AI_PROVIDERS as readonly string[]).includes(raw)) return raw as AiProvider;
  console.warn(`[AI] Unknown AI_PROVIDER "${process.env.AI_PROVIDER}", falling back to "openai"`);
  return "openai";
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

// ---------------------------------------------------------------------------
// Provider-neutral chat completions surface used by every /api/ai/* route.
// ---------------------------------------------------------------------------

export interface ChatCompletionMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatCompletionParams {
  model: string;
  messages: ChatCompletionMessage[];
}

export interface ChatCompletionResult {
  readonly choices: ReadonlyArray<{ readonly message?: { readonly content?: string | null } }>;
}

export interface ChatCompletionChunk {
  readonly choices: ReadonlyArray<{ readonly delta?: { readonly content?: string | null } }>;
}

export interface ChatCompletionRequestOptions {
  /** Aborts the upstream request (e.g. the incoming request's signal on client disconnect). */
  signal?: AbortSignal;
}

export interface ChatCompletionsClient {
  chat: {
    completions: {
      create(
        params: ChatCompletionParams & { stream: true },
        options?: ChatCompletionRequestOptions
      ): Promise<AsyncIterable<ChatCompletionChunk>>;
      create(
        params: ChatCompletionParams & { stream?: false },
        options?: ChatCompletionRequestOptions
      ): Promise<ChatCompletionResult>;
    };
  };
}

interface ChatCompletionsBackend {
  complete(params: ChatCompletionParams, signal?: AbortSignal): Promise<ChatCompletionResult>;
  stream(params: ChatCompletionParams, signal?: AbortSignal): Promise<AsyncIterable<ChatCompletionChunk>>;
}

function toChatCompletionsClient(backend: ChatCompletionsBackend): ChatCompletionsClient {
  function create(
    params: ChatCompletionParams & { stream: true },
    options?: ChatCompletionRequestOptions
  ): Promise<AsyncIterable<ChatCompletionChunk>>;
  function create(
    params: ChatCompletionParams & { stream?: false },
    options?: ChatCompletionRequestOptions
  ): Promise<ChatCompletionResult>;
  function create(
    params: ChatCompletionParams & { stream?: boolean },
    options?: ChatCompletionRequestOptions
  ): Promise<ChatCompletionResult | AsyncIterable<ChatCompletionChunk>> {
    const { stream, ...rest } = params;
    return stream ? backend.stream(rest, options?.signal) : backend.complete(rest, options?.signal);
  }
  return { chat: { completions: { create } } };
}

let chatClient: ChatCompletionsClient | undefined;
let ollamaClient: OllamaClient | undefined;

// ---------------------------------------------------------------------------
// Ollama configuration
// ---------------------------------------------------------------------------

/** Generous default: the SDK timeout spans the whole stream, and local models are slow. */
const DEFAULT_OLLAMA_TIMEOUT_MS = 120_000;
const MAX_DISCRETE_ENDPOINTS = 10;

function parsePositiveInt(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

function parseInteger(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;
  const n = Number(value);
  return Number.isInteger(n) ? n : undefined;
}

function parseModelList(value: unknown): string[] | undefined {
  const list = Array.isArray(value)
    ? value.filter((m): m is string => typeof m === "string")
    : typeof value === "string"
      ? value.split(",")
      : [];
  const models = list.map((m) => m.trim()).filter(Boolean);
  return models.length > 0 ? models : undefined;
}

function endpointFromJson(raw: unknown, index: number): OllamaEndpoint | undefined {
  if (typeof raw !== "object" || raw === null) {
    console.warn(`[AI] OLLAMA_ENDPOINTS[${index}] is not an object; skipped`);
    return undefined;
  }
  const ep = raw as Record<string, unknown>;
  if (typeof ep.name !== "string" || !ep.name || typeof ep.baseUrl !== "string" || !ep.baseUrl) {
    console.warn(`[AI] OLLAMA_ENDPOINTS[${index}] requires string "name" and "baseUrl"; skipped`);
    return undefined;
  }
  return {
    name: ep.name,
    baseUrl: ep.baseUrl,
    apiKey: typeof ep.apiKey === "string" && ep.apiKey ? ep.apiKey : undefined,
    priority: typeof ep.priority === "number" && Number.isFinite(ep.priority) ? ep.priority : undefined,
    models: parseModelList(ep.models),
  };
}

/**
 * Resolve Ollama endpoints from the environment, in order of precedence:
 *
 * 1. OLLAMA_ENDPOINTS — JSON array:
 *    [
 *      { "name": "ollama-1", "baseUrl": "http://localhost:11434", "apiKey": "key1", "priority": 10, "models": ["llama3.1:8b", "mistral"] },
 *      { "name": "ollama-2", "baseUrl": "http://ollama2:11434", "apiKey": "key2", "priority": 5 }
 *    ]
 *    `priority`: HIGHER is tried first (SDK semantics); equal priorities form a pool
 *    balanced by OLLAMA_ENDPOINT_STRATEGY.
 * 2. Discrete env vars OLLAMA_ENDPOINT_<N>_{NAME,BASE_URL,API_KEY,PRIORITY,MODELS}, N = 1..10.
 * 3. Single endpoint: OLLAMA_BASE_URL (default http://localhost:11434) + OLLAMA_API_KEY.
 *
 * Always returns at least one endpoint.
 */
function parseOllamaEndpoints(): OllamaEndpoint[] {
  const endpointsJson = process.env.OLLAMA_ENDPOINTS;
  if (endpointsJson) {
    try {
      const parsed: unknown = JSON.parse(endpointsJson);
      if (Array.isArray(parsed)) {
        const endpoints = parsed
          .map(endpointFromJson)
          .filter((ep): ep is OllamaEndpoint => ep !== undefined);
        if (endpoints.length > 0) return endpoints;
      }
      console.warn("[AI] OLLAMA_ENDPOINTS has no valid endpoints; falling back");
    } catch (e) {
      console.warn("[AI] Failed to parse OLLAMA_ENDPOINTS JSON:", e);
    }
  }

  const endpoints: OllamaEndpoint[] = [];
  for (let i = 1; i <= MAX_DISCRETE_ENDPOINTS; i++) {
    const name = process.env[`OLLAMA_ENDPOINT_${i}_NAME`];
    const baseUrl = process.env[`OLLAMA_ENDPOINT_${i}_BASE_URL`];
    if (!name || !baseUrl) continue;
    endpoints.push({
      name,
      baseUrl,
      apiKey: process.env[`OLLAMA_ENDPOINT_${i}_API_KEY`] || undefined,
      priority: parseInteger(process.env[`OLLAMA_ENDPOINT_${i}_PRIORITY`]),
      models: parseModelList(process.env[`OLLAMA_ENDPOINT_${i}_MODELS`]),
    });
  }
  if (endpoints.length > 0) return endpoints;

  return [
    {
      name: "default",
      baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      apiKey: process.env.OLLAMA_API_KEY || undefined,
      priority: 1,
    },
  ];
}

/**
 * Parse endpoint selection strategy from environment.
 * Options: "priority" (default), "round-robin", "least-connections"
 */
function parseEndpointStrategy(): "priority" | "round-robin" | "least-connections" {
  const strategy = process.env.OLLAMA_ENDPOINT_STRATEGY?.toLowerCase();
  if (strategy === "round-robin" || strategy === "least-connections") {
    return strategy;
  }
  return "priority";
}

function createOllamaClient(): OllamaClient {
  const endpoints = parseOllamaEndpoints();
  const strategy = parseEndpointStrategy();
  const timeoutMs = parsePositiveInt(process.env.OLLAMA_TIMEOUT_MS) ?? DEFAULT_OLLAMA_TIMEOUT_MS;

  // Always route through `endpoints` (a pool of one is valid) so endpoint names,
  // `models` scoping and health tracking behave identically for 1..N endpoints.
  const client = new OllamaClient({
    endpoints,
    endpointHealth: {
      strategy,
      failureThreshold: 3,
      cooldownMs: 5000,
      maxConcurrentPerEndpoint: 10,
    },
    timeoutMs,
  });
  console.log(
    `[AI] Initialized Ollama client: ${endpoints.map((e) => e.name).join(", ")} ` +
      `(strategy: ${strategy}, timeoutMs: ${timeoutMs})`
  );
  return client;
}

/** Ollama's bridge may return content as typed parts; routes only consume text. */
function messageContentToText(content: string | ReadonlyArray<{ type: string; text?: string }>): string {
  if (typeof content === "string") return content;
  return content
    .map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
    .join("");
}

// ---------------------------------------------------------------------------
// Client accessors
// ---------------------------------------------------------------------------

/**
 * Get or create the chat completions client for the active provider.
 * For Ollama this routes through the SDK's OpenAI-compatible bridge
 * (`/v1/chat/completions`) with the client's endpoint failover.
 */
export function getOpenAICompatible(): ChatCompletionsClient {
  if (chatClient) return chatClient;

  if (getAiProvider() === "ollama") {
    const client = getOllamaClient();
    if (!client) throw new Error("Ollama client is not available");
    chatClient = toChatCompletionsClient({
      complete: async (params, signal) => {
        const res = await client.openai.createChatCompletion({ ...params, stream: false }, signal);
        return {
          choices: res.choices.map((c) => ({ message: { content: messageContentToText(c.message.content) } })),
        };
      },
      stream: (params, signal) => client.openai.createChatCompletion({ ...params, stream: true }, signal),
    });
    return chatClient;
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("OPENAI_API_KEY is not configured. Set it or use AI_PROVIDER=ollama");
  }
  const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
    baseURL: process.env.OPENAI_BASE_URL,
  });
  chatClient = toChatCompletionsClient({
    complete: (params, signal) => openai.chat.completions.create({ ...params, stream: false }, { signal }),
    stream: (params, signal) => openai.chat.completions.create({ ...params, stream: true }, { signal }),
  });
  return chatClient;
}

/**
 * Get the native Ollama client for advanced features (tools, embeddings, etc.)
 * Returns undefined when the active provider is not Ollama.
 */
export function getOllamaClient(): OllamaClient | undefined {
  if (getAiProvider() !== "ollama") return undefined;
  ollamaClient ??= createOllamaClient();
  return ollamaClient;
}

export interface OllamaEndpointHealthStatus {
  name: string;
  baseUrl: string;
  failureCount: number;
  isCoolingDown: boolean;
  activeRequests: number;
}

/**
 * Get endpoint health status for monitoring (never includes API keys).
 */
export function getOllamaEndpointHealth(): OllamaEndpointHealthStatus[] | undefined {
  const client = getOllamaClient();
  if (!client) return undefined;
  return client.endpointStatus().map((h) => ({
    name: h.endpoint.name,
    baseUrl: h.endpoint.baseUrl,
    failureCount: h.failureCount,
    isCoolingDown: h.isCoolingDown,
    activeRequests: h.activeRequests,
  }));
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
    return JSON.stringify(err, null, 2);
  } catch {
    return String(err);
  }
}