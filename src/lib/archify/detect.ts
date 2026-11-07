// Recognises Archify JSON IR documents from their content.
//
// Every Archify IR document declares `diagram_type` at the top level, and the
// file name is not part of the contract, so detection reads the document.
// jsonc-parser builds a tree even for half-typed JSON, so a document keeps its
// Archify identity while the author is mid-edit. The live preview then keeps
// the last verified diagram on screen instead of flipping to a plain JSON view.

import { findNodeAtLocation, parseTree } from "jsonc-parser";

import { isArchifyDiagramType, type ArchifyDiagramType } from "./contract";

export function detectArchifyDiagramType(source: string): ArchifyDiagramType | null {
  if (!source.includes("diagram_type")) return null;
  const root = parseTree(source, undefined, { allowTrailingComma: true });
  if (!root || root.type !== "object") return null;
  const value = findNodeAtLocation(root, ["diagram_type"]);
  if (!value || value.type !== "string") return null;
  return isArchifyDiagramType(value.value) ? value.value : null;
}
