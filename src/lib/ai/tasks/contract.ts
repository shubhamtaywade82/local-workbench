// Contract between the assistant and the AI task endpoint. Pure: the browser
// and the Node route both import it, so it must not import Node built-ins,
// the provider SDKs or React.

import { z } from "zod";

import {
  ARCHIFY_DIAGRAM_TYPES,
  ARCHIFY_QUALITY_PROFILES,
  type ArchifyDiagramType,
  type ArchifyQualityProfile,
} from "@/lib/archify/contract";

/** Every task the assistant can run. `chat` and `explain` stream text; the rest return a structured result. */
export const AI_TASK_IDS = [
  "chat",
  "explain",
  "fix",
  "convert",
  "improve-docs",
  "generate-diagram",
  "archify-diagram",
  "architecture-review",
] as const;

export type AiTaskId = (typeof AI_TASK_IDS)[number];

export const CONVERT_FORMATS = ["json", "jsonc", "json5", "yaml", "toml", "toon", "xml", "markdown"] as const;
export type ConvertFormat = (typeof CONVERT_FORMATS)[number];

export const MERMAID_TYPES = ["flowchart", "sequence", "state", "er", "class"] as const;
export type MermaidType = (typeof MERMAID_TYPES)[number];

export const IMPROVE_TONES = ["concise", "detailed", "friendly"] as const;
export type ImproveTone = (typeof IMPROVE_TONES)[number];

/** Largest document text a request may carry. Prompts use a smaller, budgeted excerpt. */
export const AI_MAX_DOCUMENT_CHARS = 1_000_000;
/** Largest chat message the endpoint accepts. */
export const AI_MAX_MESSAGE_CHARS = 20_000;
/** Chat history the endpoint keeps. Older turns are dropped before the request is built. */
export const AI_MAX_HISTORY_MESSAGES = 16;
/** Largest overall request body. */
export const AI_MAX_REQUEST_BYTES = 6 * 1024 * 1024;

const lineNumber = z.number().int().min(1).max(10_000_000);
const columnNumber = z.number().int().min(1).max(100_000);

export const documentSnapshotSchema = z.object({
  path: z.string().min(1).max(1024),
  languageId: z.string().max(64),
  adapterId: z.string().max(64),
  text: z.string().max(AI_MAX_DOCUMENT_CHARS),
  selection: z
    .object({
      startLine: lineNumber,
      endLine: lineNumber,
      startColumn: columnNumber,
      endColumn: columnNumber,
    })
    .optional(),
  diagnostics: z
    .array(
      z.object({
        severity: z.enum(["error", "warning", "info", "hint"]),
        message: z.string().max(1000),
        line: lineNumber.optional(),
        code: z.string().max(120).optional(),
      })
    )
    .max(100)
    .optional(),
});

export type DocumentSnapshot = z.infer<typeof documentSnapshotSchema>;

export const workspaceExcerptSchema = z.object({
  path: z.string().min(1).max(1024),
  excerpt: z.string().max(20_000),
});

export type WorkspaceExcerpt = z.infer<typeof workspaceExcerptSchema>;

export const chatMessageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().max(AI_MAX_MESSAGE_CHARS),
});

export type ChatTurn = z.infer<typeof chatMessageSchema>;

export const aiTaskOptionsSchema = z
  .object({
    targetFormat: z.enum(CONVERT_FORMATS).optional(),
    mermaidType: z.enum(MERMAID_TYPES).optional(),
    diagramType: z.enum(ARCHIFY_DIAGRAM_TYPES).optional(),
    quality: z.enum(ARCHIFY_QUALITY_PROFILES).optional(),
    tone: z.enum(IMPROVE_TONES).optional(),
    preserveCodeBlocks: z.boolean().optional(),
    description: z.string().max(4000).optional(),
    generativeUi: z.boolean().optional(),
  })
  .strict();

export type AiTaskOptions = z.infer<typeof aiTaskOptionsSchema>;

export const aiTaskRequestSchema = z
  .object({
    task: z.enum(AI_TASK_IDS),
    model: z.string().min(1).max(200).optional(),
    /** Chat history, oldest first. The last entry is the new user message for `chat`. */
    messages: z.array(chatMessageSchema).max(AI_MAX_HISTORY_MESSAGES + 1).optional(),
    document: documentSnapshotSchema.optional(),
    /** Workspace snapshot for `architecture-review`. */
    workspace: z.array(workspaceExcerptSchema).max(200).optional(),
    options: aiTaskOptionsSchema.optional(),
  })
  .strict();

export type AiTaskRequest = z.infer<typeof aiTaskRequestSchema>;

export interface TaskRequirementIssue {
  readonly path: string;
  readonly message: string;
}

/** Cross-field rules a task needs beyond the shape check. Empty when the request can run. */
export function taskRequirementIssues(request: AiTaskRequest): TaskRequirementIssue[] {
  const issues: TaskRequirementIssue[] = [];
  const needDocument = (): void => {
    if (!request.document) issues.push({ path: "document", message: `${request.task} needs the active document.` });
  };
  const needDescription = (): void => {
    if (!request.options?.description?.trim()) {
      issues.push({ path: "options.description", message: `${request.task} needs a description.` });
    }
  };
  switch (request.task) {
    case "chat": {
      const last = request.messages?.at(-1);
      if (!last || last.role !== "user") {
        issues.push({ path: "messages", message: "chat needs a user message last." });
      }
      break;
    }
    case "explain":
    case "fix":
    case "improve-docs":
      needDocument();
      break;
    case "convert":
      needDocument();
      if (!request.options?.targetFormat) {
        issues.push({ path: "options.targetFormat", message: "convert needs a target format." });
      }
      break;
    case "generate-diagram":
      needDescription();
      break;
    case "archify-diagram":
      needDescription();
      if (!request.options?.diagramType) {
        issues.push({ path: "options.diagramType", message: "archify-diagram needs a diagram type." });
      }
      break;
    case "architecture-review":
      if (!request.workspace || request.workspace.length === 0) {
        issues.push({ path: "workspace", message: "architecture-review needs a workspace snapshot." });
      }
      break;
  }
  return issues;
}

// ---------------------------------------------------------------------------
// Events and results
// ---------------------------------------------------------------------------

export interface ArchifyVerdictSummary {
  readonly ok: boolean;
  readonly stage: string | null;
  readonly diagnostics: readonly { readonly code: string; readonly message: string; readonly supportedFixes: readonly string[] }[];
  readonly warnings: number;
}

export interface ReviewCandidate {
  readonly title: string;
  readonly strength: "Strong" | "Worth exploring" | "Speculative";
  readonly dependencyCategory?: string;
  readonly files: readonly string[];
  readonly problem: string;
  readonly solution: string;
  readonly wins: readonly string[];
  readonly beforeMermaid: string;
  readonly afterMermaid: string;
}

export type AiTaskResult =
  | { readonly kind: "text"; readonly text: string; readonly generativeUi: boolean }
  | {
      /** A proposed replacement for the document the task ran against. */
      readonly kind: "edit";
      readonly label: string;
      readonly description: string;
      readonly newText: string;
      /** False when the model returned prose instead of the requested structure. */
      readonly structured: boolean;
      /** True when no model was used (in-process conversion). */
      readonly deterministic: boolean;
    }
  | {
      readonly kind: "archify";
      readonly diagramType: ArchifyDiagramType;
      readonly quality: ArchifyQualityProfile;
      readonly document: string;
      readonly html: string | null;
      readonly verdict: ArchifyVerdictSummary;
      readonly attempts: number;
    }
  | {
      readonly kind: "review";
      readonly summary: string;
      readonly candidates: readonly ReviewCandidate[];
    };

export type AiTaskEvent =
  | { readonly type: "status"; readonly message: string }
  | { readonly type: "delta"; readonly text: string }
  | { readonly type: "result"; readonly result: AiTaskResult }
  | { readonly type: "error"; readonly code: AiErrorCode; readonly message: string };

export type AiErrorCode =
  | "invalid-request"
  | "provider-unavailable"
  | "provider-error"
  | "runtime-unavailable"
  | "unparseable-output"
  | "too-large"
  | "internal";
