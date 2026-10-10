// Client bootstrap. Registers all document adapters with the registry.
// Called once from the workbench root component after mount.

"use client";

import { documentRegistry } from "@/documents/core/registry";

let registered = false;

export async function ensureAdaptersRegistered(): Promise<void> {
  if (registered) return;
  registered = true;

  // Static adapters first.
  const { markdownAdapter } = await import("@/documents/adapters/markdown/markdown");
  const { jsonAdapter } = await import("@/documents/adapters/json/json");
  const { yamlAdapter } = await import("@/documents/adapters/yaml/yaml");
  const { tomlAdapter } = await import("@/documents/adapters/toml/toml");
  documentRegistry.register(markdownAdapter);
  documentRegistry.register(jsonAdapter);
  documentRegistry.register(yamlAdapter);
  documentRegistry.register(tomlAdapter);

  // Dynamic adapters — wrapped in try/catch so a missing module doesn't break
  // the editor.
  try {
    const mermaidMod = await import("@/documents/adapters/mermaid/mermaid");
    if (mermaidMod.mermaidAdapter) {
      documentRegistry.register(mermaidMod.mermaidAdapter);
    }
  } catch (err) {
    console.error("Failed to load mermaid adapter:", err);
  }
  try {
    const xmlMod = await import("@/documents/adapters/xml/xml");
    if (xmlMod.xmlAdapter) {
      documentRegistry.register(xmlMod.xmlAdapter);
    }
  } catch (err) {
    console.error("Failed to load xml adapter:", err);
  }
  try {
    const toonMod = await import("@/documents/adapters/toon/toon");
    if (toonMod.toonAdapter) {
      documentRegistry.register(toonMod.toonAdapter);
    }
  } catch (err) {
    console.error("Failed to load toon adapter:", err);
  }
}
