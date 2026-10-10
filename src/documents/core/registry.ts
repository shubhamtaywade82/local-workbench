// Document adapter registry. Resolves a file path to a DocumentAdapter.
// Unknown extensions fall back to a plain-text adapter so the editor always works.

import type { DocumentAdapter, ParseResult, PreviewModel } from "./types";

class TextFallbackAdapter implements DocumentAdapter {
  id = "text";
  extensions = [] as readonly string[];
  languageId = "plaintext";
  displayName = "Plain Text";

  parse(source: string, filePath: string): ParseResult {
    return { valid: true, value: source, diagnostics: [] };
  }

  createPreview(source: string, _filePath: string): PreviewModel {
    return { kind: "text-fallback", source, language: "plaintext" };
  }
}

class DocumentRegistry {
  private adapters: DocumentAdapter[] = [];
  private byExtension = new Map<string, DocumentAdapter>();
  private fallback: DocumentAdapter = new TextFallbackAdapter();

  register(adapter: DocumentAdapter): void {
    this.adapters.push(adapter);
    for (const ext of adapter.extensions) {
      // First registered adapter wins per extension; later registrations are ignored
      // for that extension but still available by explicit id.
      if (!this.byExtension.has(ext.toLowerCase())) {
        this.byExtension.set(ext.toLowerCase(), adapter);
      }
    }
  }

  /** Returns the adapter for the given path, or the text fallback. */
  resolve(filePath: string): DocumentAdapter {
    const ext = this.extractExtension(filePath);
    return this.byExtension.get(ext) ?? this.fallback;
  }

  /** Returns the adapter by id, or the text fallback. */
  resolveById(id: string): DocumentAdapter {
    return this.adapters.find((a) => a.id === id) ?? this.fallback;
  }

  /** Returns true if an adapter is registered for the path's extension. */
  isSupported(filePath: string): boolean {
    return this.byExtension.has(this.extractExtension(filePath));
  }

  list(): DocumentAdapter[] {
    return [...this.adapters];
  }

  private extractExtension(filePath: string): string {
    const dot = filePath.lastIndexOf(".");
    if (dot < 0 || dot === filePath.length - 1) return "";
    return filePath.slice(dot + 1).toLowerCase();
  }

  get fallbackAdapter(): DocumentAdapter {
    return this.fallback;
  }
}

// Singleton registry instance shared by the whole app.
export const documentRegistry = new DocumentRegistry();

export { TextFallbackAdapter };
