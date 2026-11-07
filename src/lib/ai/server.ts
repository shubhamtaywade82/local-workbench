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
import { resolveActionModel, type AiAction } from "./action-models";

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

/**
 * Model for one AI action: its `AI_MODEL_*` override, or the default model.
 * See `./action-models` for the rules.
 */
export function getActionModel(action: AiAction): string {
  return resolveActionModel(action, process.env, getDefaultModel());
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
const MAX_DISCRETE_KEYS = 20;

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

function parseEndpointsJson(json: string | undefined): OllamaEndpoint[] {
  if (!json) return [];
  try {
    const parsed: unknown = JSON.parse(json);
    if (Array.isArray(parsed)) {
      return parsed.map(endpointFromJson).filter((ep): ep is OllamaEndpoint => ep !== undefined);
    }
    console.warn("[AI] OLLAMA_ENDPOINTS has no valid endpoints; falling back");
  } catch (e) {
    console.warn("[AI] Failed to parse OLLAMA_ENDPOINTS JSON:", e);
  }
  return [];
}

function parseDiscreteEndpoints(env: Record<string, string | undefined>): OllamaEndpoint[] {
  const endpoints: OllamaEndpoint[] = [];
  for (let i = 1; i <= MAX_DISCRETE_ENDPOINTS; i++) {
    const name = env[`OLLAMA_ENDPOINT_${i}_NAME`];
    const baseUrl = env[`OLLAMA_ENDPOINT_${i}_BASE_URL`];
    if (!name || !baseUrl) continue;
    endpoints.push({
      name,
      baseUrl,
      apiKey: env[`OLLAMA_ENDPOINT_${i}_API_KEY`] || undefined,
      priority: parseInteger(env[`OLLAMA_ENDPOINT_${i}_PRIORITY`]),
      models: parseModelList(env[`OLLAMA_ENDPOINT_${i}_MODELS`]),
    });
  }
  return endpoints;
}

function parseDiscreteApiKeys(env: Record<string, string | undefined>, defaultBaseUrl: string): OllamaEndpoint[] {
  const endpoints: OllamaEndpoint[] = [];
  for (let i = 1; i <= MAX_DISCRETE_KEYS; i++) {
    const key = env[`OLLAMA_API_KEY_${i}`]?.trim();
    if (!key) continue;
    endpoints.push({
      name: env[`OLLAMA_API_KEY_${i}_NAME`]?.trim() || `ollama-key-${i}`,
      baseUrl: env[`OLLAMA_API_KEY_${i}_BASE_URL`]?.trim() || defaultBaseUrl,
      apiKey: key,
      priority: parseInteger(env[`OLLAMA_API_KEY_${i}_PRIORITY`]) ?? 1,
      models: parseModelList(env[`OLLAMA_API_KEY_${i}_MODELS`]),
    });
  }
  if (endpoints.length > 0) return endpoints;

  const commaSeparated = (env.OLLAMA_API_KEYS || env.OLLAMA_API_KEY)?.trim();
  if (commaSeparated && commaSeparated.includes(",")) {
    const keys = commaSeparated.split(",").map((k) => k.trim()).filter(Boolean);
    if (keys.length > 1) {
      return keys.map((apiKey, idx) => ({
        name: `ollama-key-${idx + 1}`,
        baseUrl: defaultBaseUrl,
        apiKey,
        priority: 1,
      }));
    }
  }

  return [];
}

/**
 * Resolve Ollama endpoints from the environment, in order of precedence:
 *
 * 1. OLLAMA_ENDPOINTS — JSON array
 * 2. Discrete env vars OLLAMA_ENDPOINT_<N>_{NAME,BASE_URL,API_KEY,PRIORITY,MODELS}, N = 1..10
 * 3. Discrete API keys OLLAMA_API_KEY_<N> (with optional _NAME, _BASE_URL, _PRIORITY, _MODELS), N = 1..20,
 *    or comma-separated OLLAMA_API_KEYS / OLLAMA_API_KEY
 * 4. Single endpoint: OLLAMA_BASE_URL (default http://localhost:11434) + OLLAMA_API_KEY
 *
 * Always returns at least one endpoint.
 */
export function parseOllamaEndpoints(env: Record<string, string | undefined> = process.env): OllamaEndpoint[] {
  const jsonEndpoints = parseEndpointsJson(env.OLLAMA_ENDPOINTS);
  if (jsonEndpoints.length > 0) return jsonEndpoints;

  const discreteEndpoints = parseDiscreteEndpoints(env);
  if (discreteEndpoints.length > 0) return discreteEndpoints;

  const defaultBaseUrl = env.OLLAMA_BASE_URL || "http://localhost:11434";
  const keyEndpoints = parseDiscreteApiKeys(env, defaultBaseUrl);
  if (keyEndpoints.length > 0) return keyEndpoints;

  return [
    {
      name: "default",
      baseUrl: defaultBaseUrl,
      apiKey: env.OLLAMA_API_KEY || undefined,
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
/** Test-only: forget the cached provider clients so the next call reads the environment again. */
export function resetAiClientsForTests(): void {
  chatClient = undefined;
  ollamaClient = undefined;
}

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

