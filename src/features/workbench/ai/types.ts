// Message and proposal model for the assistant. Plain data, so the controller,
// the store and the components all agree on one shape.

import type { AiTaskId, ArchifyVerdictSummary, ReviewCandidate } from "@/lib/ai/tasks/contract";
import type { ArchifyDiagramType, ArchifyQualityProfile } from "@/lib/archify/contract";

/** A proposed replacement for one document. It records the text the model was given, so staleness can be detected. */
export interface EditProposal {
  readonly kind: "edit";
  /** The open document this replaces. Null when the proposal creates a new file at `newPath`. */
  readonly targetPath: string | null;
  readonly newPath: string | null;
  readonly label: string;
  readonly description: string;
  readonly baseText: string;
  readonly newText: string;
  readonly structured: boolean;
  readonly deterministic: boolean;
  readonly status: "open" | "applied" | "discarded";
  readonly savedPath: string | null;
}

/** An Archify document that passed Archify's gate. It is saved as a new file or used to replace the active one. */
export interface ArchifyProposal {
  readonly kind: "archify";
  /** What the user asked for. Used to name the saved file. */
  readonly title: string;
  readonly diagramType: ArchifyDiagramType;
  readonly quality: ArchifyQualityProfile;
  readonly document: string;
  readonly html: string | null;
  readonly verdict: ArchifyVerdictSummary;
  readonly attempts: number;
  readonly status: "open" | "saved" | "discarded";
  readonly savedPath: string | null;
}

export interface ReviewPayload {
  readonly kind: "review";
  readonly summary: string;
  readonly candidates: readonly ReviewCandidate[];
}

export type AssistantPayload =
  | { readonly kind: "proposal"; readonly proposal: EditProposal }
  | { readonly kind: "archify"; readonly proposal: ArchifyProposal }
  | ReviewPayload;

export interface UserMessage {
  readonly id: string;
  readonly role: "user";
  readonly text: string;
  readonly task: AiTaskId;
  readonly contextPath: string | null;
  readonly createdAt: number;
}

export interface AssistantMessage {
  readonly id: string;
  readonly role: "assistant";
  readonly task: AiTaskId;
  readonly text: string;
  readonly state: "working" | "done" | "cancelled" | "failed";
  readonly statusLine: string | null;
  readonly error: { readonly code: string; readonly message: string } | null;
  readonly generativeUi: boolean;
  readonly contextPath: string | null;
  readonly payload: AssistantPayload | null;
  readonly createdAt: number;
}

export interface NoticeMessage {
  readonly id: string;
  readonly role: "notice";
  readonly text: string;
  readonly tone: "info" | "warning";
  readonly createdAt: number;
}

export type ThreadMessage = UserMessage | AssistantMessage | NoticeMessage;
