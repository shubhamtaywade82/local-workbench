import { documentRegistry } from "@/documents/core/registry";
import { xmlAdapter } from "./xml";

/**
 * Registers the XML adapter with the global document registry.
 * Called by the central `registerAllAdapters()` orchestrator.
 */
export function register(): void {
  documentRegistry.register(xmlAdapter);
}

export { xmlAdapter } from "./xml";
