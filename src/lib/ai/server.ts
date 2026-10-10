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
import { OllamaClient } from "@nemesis-oss/ollama-sdk";

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
 * Get or create the OpenAI-compatible client.
 * For Ollama, uses @nemesis-oss/ollama-sdk's OpenAICompatClient which
 * provides the same interface as the OpenAI SDK.
 */
export function getOpenAICompatible(): OpenAI {
  const provider = getAiProvider();

  if (provider === "ollama") {
    if (!ollamaClient) {
      const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
      ollamaClient = new OllamaClient({ baseUrl });
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
 */
export function getOllamaClient(): OllamaClient | undefined {
  const provider = getAiProvider();
  if (provider !== "ollama") return undefined;

  if (!ollamaClient) {
    const baseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
    ollamaClient = new OllamaClient({ baseUrl });
  }
  return ollamaClient;
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