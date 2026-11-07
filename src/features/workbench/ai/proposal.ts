// Proposal rules: when an AI edit may land on the document, and how it is shown.
// A proposal was made from one exact text. If the document has changed since,
// applying it would silently discard the user's edits, so it is stale.

import { createPatch } from "diff";

import type { EditProposal } from "./types";

export type ProposalFreshness = "current" | "stale" | "missing";

/** `currentText` is the document now, or null when it is no longer open. */
export function proposalFreshness(proposal: Pick<EditProposal, "baseText">, currentText: string | null): ProposalFreshness {
  if (currentText === null) return "missing";
  return currentText === proposal.baseText ? "current" : "stale";
}

/** A unified diff from the text the model saw to its proposed text. */
export function proposalDiff(proposal: Pick<EditProposal, "baseText" | "newText">, name = "document"): string {
  return createPatch(name, proposal.baseText, proposal.newText, "before", "proposed");
}

export interface DiffStats {
  readonly added: number;
  readonly removed: number;
}

/** Counts the added and removed lines of a unified diff, excluding its headers. */
export function diffStats(patch: string): DiffStats {
  let added = 0;
  let removed = 0;
  for (const line of patch.split("\n")) {
    if (line.startsWith("+++") || line.startsWith("---")) continue;
    if (line.startsWith("+")) added += 1;
    else if (line.startsWith("-")) removed += 1;
  }
  return { added, removed };
}
