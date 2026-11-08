// SVG document adapter. Emits an svg preview model so the preview pane
// renders vector graphics directly with zoom and transparency support.

import type { DocumentAdapter, ParseResult, PreviewModel } from "@/documents/core/types";

export const svgAdapter: DocumentAdapter = {
  id: "svg",
  extensions: ["svg"],
  languageId: "xml",
  displayName: "SVG Vector Graphic",

  parse(source: string): ParseResult {
    const isSvg = source.includes("<svg");
    return { valid: isSvg, value: source, diagnostics: [] };
  },

  createPreview(source: string): PreviewModel {
    return { kind: "svg", source };
  },
};
