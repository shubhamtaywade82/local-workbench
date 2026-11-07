// Archify IR adapter. Claims JSON documents whose top-level `diagram_type` is
// one of the ten Archify diagram types. Parsing and syntax diagnostics belong to
// the JSON adapter. The preview is a live Archify render, performed by the
// preview component through the server, because Archify's renderer runs on Node.

import { detectArchifyDiagramType } from "@/lib/archify/detect";
import type { DocumentAdapter, PreviewModel } from "../../core/types";
import { jsonAdapter } from "../json/json";

export const archifyAdapter: DocumentAdapter = {
  id: "archify",
  // Content-only: .json stays owned by the JSON adapter for extension lookup.
  extensions: [],
  languageId: "json",
  displayName: "Archify diagram",

  matchesContent(source, filePath) {
    if (!filePath.toLowerCase().endsWith(".json")) return false;
    return detectArchifyDiagramType(source) !== null;
  },

  parse(source, filePath) {
    return jsonAdapter.parse(source, filePath);
  },

  createPreview(source, filePath): PreviewModel {
    const diagramType = detectArchifyDiagramType(source);
    if (diagramType === null) return { kind: "text-fallback", source, language: "json" };
    return { kind: "archify", source, diagramType, filePath };
  },
};
