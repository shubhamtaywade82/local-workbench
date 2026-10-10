import { documentRegistry } from "@/documents/core/registry";
import { toonAdapter } from "./toon";

/**
 * Registers the TOON adapter with the global document registry.
 * Called by the central `registerAllAdapters()` orchestrator.
 */
export function register(): void {
  documentRegistry.register(toonAdapter);
}

export { toonAdapter, parseToon, toonStringify } from "./toon";
