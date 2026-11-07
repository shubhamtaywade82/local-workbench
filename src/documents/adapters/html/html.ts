// HTML document adapter. Emits a sandboxed-html preview model so the workbench
// preview pane renders the document inside an isolated iframe.

import type { DocumentAdapter, ParseResult, PreviewModel } from "@/documents/core/types";

export const htmlAdapter: DocumentAdapter = {
  id: "html",
  extensions: ["html", "htm"],
  languageId: "html",
  displayName: "HTML",

  parse(source: string): ParseResult {
    return { valid: true, value: source, diagnostics: [] };
  },

  createPreview(source: string): PreviewModel {
    return { kind: "sandboxed-html", source };
  },
};
