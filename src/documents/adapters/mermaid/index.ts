import { documentRegistry } from "@/documents/core/registry";
import { mermaidAdapter } from "./mermaid";

/**
 * Registers the Mermaid adapter with the global document registry.
 * Called by the central `registerAllAdapters()` orchestrator.
 */
export function register(): void {
  documentRegistry.register(mermaidAdapter);
}

export { mermaidAdapter } from "./mermaid";
