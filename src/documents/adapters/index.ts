// Document adapter re-exports. The canonical registration entry point is
// `src/documents/bootstrap.ts` (`ensureAdaptersRegistered`).

export { markdownAdapter } from "./markdown/markdown";
export { jsonAdapter } from "./json/json";
export { yamlAdapter } from "./yaml/yaml";
export { tomlAdapter } from "./toml/toml";
export { mermaidAdapter } from "./mermaid/mermaid";
export { xmlAdapter } from "./xml/xml";
export { toonAdapter, parseToon, toonStringify } from "./toon/toon";
