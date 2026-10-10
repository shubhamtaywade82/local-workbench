/**
 * Server-side OpenUI Lang system prompt for the workbench component library.
 *
 * Built from the shared contract in `./components` with no-op renderers, so it
 * is safe to import from route handlers (no React, no "use client").
 */
import { createLibrary, type Library } from "@openuidev/lang-core";
import {
  COMPONENT_NAMES,
  GENERATIVE_UI_EXAMPLES,
  GENERATIVE_UI_RULES,
  ROOT_COMPONENT,
  defineGenerativeComponents,
  type GenerativeRenderers,
} from "./components";

/** Feature flag: AI_GENERATIVE_UI=1|true enables generative UI responses. */
export function isGenerativeUiEnabled(): boolean {
  const raw = process.env.AI_GENERATIVE_UI?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}

let serverLibrary: Library<null> | undefined;

/** Library with placeholder renderers — only used for prompt generation and parsing. */
export function getServerLibrary(): Library<null> {
  if (serverLibrary) return serverLibrary;
  const placeholders = Object.fromEntries(
    COMPONENT_NAMES.map((name) => [name, null])
  ) as GenerativeRenderers<null>;
  const components = defineGenerativeComponents(placeholders);
  serverLibrary = createLibrary<null>({
    root: ROOT_COMPONENT,
    components: COMPONENT_NAMES.map((name) => components[name]),
  });
  return serverLibrary;
}

let cachedPrompt: string | undefined;

/**
 * System-prompt section teaching the model OpenUI Lang in inline mode: plain
 * text by default, fenced ```openui-lang blocks only where UI helps.
 */
export function getGenerativeUiPrompt(): string {
  cachedPrompt ??= getServerLibrary().prompt({
    inlineMode: true,
    examples: [...GENERATIVE_UI_EXAMPLES],
    additionalRules: [...GENERATIVE_UI_RULES],
  });
  return cachedPrompt;
}
