/**
 * Per-action model selection.
 *
 * Each AI action can run on its own model, so a small local model (for
 * example a MiniCPM5 variant seeded into Ollama) can serve some actions while
 * the default model serves the rest. An action without an override uses the
 * default model, so existing configuration keeps working unchanged.
 *
 * Kept free of SDK imports so it can be unit-tested on its own; the routes
 * reach it through `getActionModel` in `./server`.
 */

export const AI_ACTIONS = ["chat", "fix", "explain", "convert", "diagram", "improve"] as const;

export type AiAction = (typeof AI_ACTIONS)[number];

const ENV_KEYS: Readonly<Record<AiAction, string>> = {
  chat: "AI_MODEL_CHAT",
  fix: "AI_MODEL_FIX",
  explain: "AI_MODEL_EXPLAIN",
  convert: "AI_MODEL_CONVERT",
  diagram: "AI_MODEL_DIAGRAM",
  improve: "AI_MODEL_IMPROVE",
};

/**
 * Ollama tags and OpenAI model ids: letters, digits and `._:/-`, starting with
 * a letter or digit. Rejects whitespace, quotes, shell metacharacters and
 * leading dashes, which must never reach a request body or a log line.
 */
const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/;

/**
 * Returns the model for `action`: its `AI_MODEL_*` override when set and
 * valid, otherwise `fallback`. An invalid override is reported through `warn`
 * and ignored, so a typo degrades to the default model instead of failing the
 * request.
 */
export function resolveActionModel(
  action: AiAction,
  env: Readonly<Record<string, string | undefined>>,
  fallback: string,
  warn: (message: string) => void = console.warn,
): string {
  const key = ENV_KEYS[action];
  const raw = env[key]?.trim();
  if (!raw) return fallback;
  if (!MODEL_NAME.test(raw)) {
    // The value itself is not logged: it may contain control characters.
    warn(`[AI] Ignoring ${key}: not a valid model name; using ${fallback}`);
    return fallback;
  }
  return raw;
}
