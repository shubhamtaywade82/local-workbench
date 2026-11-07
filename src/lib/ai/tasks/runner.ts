// The AI task runner: one interface for every assistant task. A task is a
// generator of events. It yields status while it works, text deltas for
// streaming tasks, and exactly one result or error. Cancellation ends the
// generator quietly.
//
// Ports (injected, so tests use fakes):
//  - ChatProvider: the model. Missing or failing, only model tasks are affected.
//  - ArchifyVerifier: Archify's gate. Archify diagrams are accepted only when it passes.

import type { ArchifyDiagramType, ArchifyQualityProfile, ArchifyRenderResult } from "@/lib/archify/contract";

import { errorMessage } from "../text";

import { convertDeterministically, sourceFormatOf } from "./convert";
import { parseArchifyDocument, parseFixOutput, parseReviewOutput, normalizeMermaid } from "./parsers";
import {
  archifyMessages,
  archifyRepairMessage,
  chatMessages,
  convertMessages,
  explainMessages,
  fixMessages,
  generateDiagramMessages,
  improveDocsMessages,
  reviewMessages,
  type PromptMessage,
} from "./prompts";
import { stripCodeFence } from "../text";
import type { AiTaskEvent, AiTaskRequest, AiTaskResult, ArchifyVerdictSummary, DocumentSnapshot } from "./contract";

export interface ChatProvider {
  readonly id: string;
  readonly model: string;
  /** Yields content deltas until the model finishes. */
  stream(messages: readonly PromptMessage[], signal: AbortSignal): AsyncIterable<string>;
  /** Resolves with the full reply text. */
  complete(messages: readonly PromptMessage[], signal: AbortSignal): Promise<string>;
}

export interface ArchifyVerifier {
  render(
    input: { readonly type: ArchifyDiagramType; readonly quality: ArchifyQualityProfile; readonly source: string },
    signal: AbortSignal
  ): Promise<ArchifyRenderResult>;
}

export interface AiTaskDeps {
  readonly provider: ChatProvider | null;
  readonly archify: ArchifyVerifier | null;
  /** Server flag AI_GENERATIVE_UI. Requests also need options.generativeUi. */
  readonly generativeUi: boolean;
  readonly generativeUiPrompt: string;
  /** Model attempts for an Archify diagram, including the first. */
  readonly maxArchifyAttempts?: number;
}

/** A task failed for a reason the user can act on, mapped to an AiErrorCode. */
export class TaskError extends Error {
  constructor(
    readonly code: "provider-unavailable" | "provider-error" | "runtime-unavailable" | "unparseable-output",
    message: string,
    readonly cause?: unknown
  ) {
    super(message);
    this.name = "TaskError";
  }
}

export async function* runAiTask(
  request: AiTaskRequest,
  deps: AiTaskDeps,
  signal: AbortSignal
): AsyncGenerator<AiTaskEvent, void, void> {
  try {
    yield* dispatch(request, deps, signal);
  } catch (error) {
    if (signal.aborted) return;
    if (error instanceof TaskError) {
      yield { type: "error", code: error.code, message: error.message };
      return;
    }
    yield { type: "error", code: "internal", message: errorMessage(error) };
  }
}

function dispatch(request: AiTaskRequest, deps: AiTaskDeps, signal: AbortSignal): AsyncGenerator<AiTaskEvent, void, void> {
  switch (request.task) {
    case "chat":
      return chatTask(request, deps, signal);
    case "explain":
      return explainTask(request, deps, signal);
    case "fix":
      return fixTask(request, deps, signal);
    case "convert":
      return convertTask(request, deps, signal);
    case "improve-docs":
      return improveDocsTask(request, deps, signal);
    case "generate-diagram":
      return generateDiagramTask(request, deps, signal);
    case "archify-diagram":
      return archifyTask(request, deps, signal);
    case "architecture-review":
      return reviewTask(request, deps, signal);
  }
}

function requireProvider(deps: AiTaskDeps): ChatProvider {
  if (!deps.provider) {
    throw new TaskError(
      "provider-unavailable",
      "No AI provider is configured. Set OPENAI_API_KEY, or set AI_PROVIDER=ollama to use a local model."
    );
  }
  return deps.provider;
}

function requireDocument(request: AiTaskRequest): DocumentSnapshot {
  if (!request.document) throw new TaskError("unparseable-output", `${request.task} needs the active document.`);
  return request.document;
}

function generativeUiFor(request: AiTaskRequest, deps: AiTaskDeps): string | null {
  return deps.generativeUi && request.options?.generativeUi === true ? deps.generativeUiPrompt : null;
}

/** Rejects as soon as `signal` aborts. Used to race provider work, so cancellation never waits for a provider that ignores the signal. */
function untilAborted(signal: AbortSignal): Promise<never> {
  return new Promise<never>((_resolve, reject) => {
    const fail = (): void => reject(new DOMException("The task was cancelled.", "AbortError"));
    if (signal.aborted) fail();
    else signal.addEventListener("abort", fail, { once: true });
  });
}

async function* streamText(
  provider: ChatProvider,
  messages: readonly PromptMessage[],
  signal: AbortSignal
): AsyncGenerator<AiTaskEvent, string, void> {
  let text = "";
  const iterator = provider.stream(messages, signal)[Symbol.asyncIterator]();
  const aborted = untilAborted(signal);
  aborted.catch(() => undefined);
  try {
    for (;;) {
      const step = await Promise.race([iterator.next(), aborted]);
      if (step.done) break;
      if (step.value.length === 0) continue;
      text += step.value;
      yield { type: "delta", text: step.value };
    }
  } catch (error) {
    if (signal.aborted) throw error;
    throw new TaskError("provider-error", errorMessage(error), error);
  } finally {
    void iterator.return?.(undefined)?.catch?.(() => undefined);
  }
  return text;
}

async function completeText(provider: ChatProvider, messages: readonly PromptMessage[], signal: AbortSignal): Promise<string> {
  const aborted = untilAborted(signal);
  aborted.catch(() => undefined);
  try {
    return await Promise.race([provider.complete(messages, signal), aborted]);
  } catch (error) {
    if (signal.aborted) throw error;
    throw new TaskError("provider-error", errorMessage(error), error);
  }
}

/** Keeps the trailing newline a source document has, so an edit does not show a spurious last-line change. */
function matchTrailingNewline(text: string, source: string): string {
  return source.endsWith("\n") && !text.endsWith("\n") ? `${text}\n` : text;
}

function result(value: AiTaskResult): AiTaskEvent {
  return { type: "result", result: value };
}

async function* chatTask(request: AiTaskRequest, deps: AiTaskDeps, signal: AbortSignal): AsyncGenerator<AiTaskEvent, void, void> {
  const provider = requireProvider(deps);
  const generativeUiPrompt = generativeUiFor(request, deps);
  yield { type: "status", message: "Thinking…" };
  const text = yield* streamText(provider, chatMessages(request, { generativeUiPrompt }), signal);
  if (signal.aborted) return;
  yield result({ kind: "text", text, generativeUi: generativeUiPrompt !== null });
}

async function* explainTask(request: AiTaskRequest, deps: AiTaskDeps, signal: AbortSignal): AsyncGenerator<AiTaskEvent, void, void> {
  const provider = requireProvider(deps);
  requireDocument(request);
  const generativeUiPrompt = generativeUiFor(request, deps);
  yield { type: "status", message: "Reading the document…" };
  const text = yield* streamText(provider, explainMessages(request, { generativeUiPrompt }), signal);
  if (signal.aborted) return;
  yield result({ kind: "text", text, generativeUi: generativeUiPrompt !== null });
}

async function* fixTask(request: AiTaskRequest, deps: AiTaskDeps, signal: AbortSignal): AsyncGenerator<AiTaskEvent, void, void> {
  const provider = requireProvider(deps);
  const snapshot = requireDocument(request);
  const count = snapshot.diagnostics?.length ?? 0;
  yield { type: "status", message: `Drafting a fix for ${count} diagnostic${count === 1 ? "" : "s"}…` };
  const raw = await completeText(provider, fixMessages(request), signal);
  if (signal.aborted) return;
  const parsed = parseFixOutput(raw);
  if (!parsed.structured) {
    yield result({
      kind: "edit",
      label: "Suggested rewrite",
      description: "The model did not return structured output. Review the text before applying it.",
      newText: parsed.newText,
      structured: false,
      deterministic: false,
    });
    return;
  }
  if (parsed.newText === snapshot.text) {
    yield result({ kind: "text", text: "The document already satisfies its diagnostics. No change is proposed.", generativeUi: false });
    return;
  }
  yield result({
    kind: "edit",
    label: parsed.label,
    description: parsed.description,
    newText: parsed.newText,
    structured: true,
    deterministic: false,
  });
}

async function* convertTask(request: AiTaskRequest, deps: AiTaskDeps, signal: AbortSignal): AsyncGenerator<AiTaskEvent, void, void> {
  const snapshot = requireDocument(request);
  const to = request.options?.targetFormat;
  if (!to) throw new TaskError("unparseable-output", "convert needs a target format.");
  const from = sourceFormatOf(snapshot.adapterId);

  const converted = convertDeterministically(snapshot.text, from, to);
  if (converted !== null) {
    yield result({
      kind: "edit",
      label: `Convert to ${to}`,
      description: "Converted in-process. No model was used.",
      newText: converted,
      structured: true,
      deterministic: true,
    });
    return;
  }

  const provider = requireProvider(deps);
  yield { type: "status", message: `Converting ${from} to ${to} with the model…` };
  const raw = await completeText(provider, convertMessages(request, from, to), signal);
  if (signal.aborted) return;
  yield result({
    kind: "edit",
    label: `Convert to ${to}`,
    description: "Converted by the model. Check the result before applying it.",
    newText: matchTrailingNewline(stripCodeFence(raw), snapshot.text),
    structured: true,
    deterministic: false,
  });
}

async function* improveDocsTask(request: AiTaskRequest, deps: AiTaskDeps, signal: AbortSignal): AsyncGenerator<AiTaskEvent, void, void> {
  const provider = requireProvider(deps);
  const document = requireDocument(request);
  yield { type: "status", message: "Rewriting the Markdown…" };
  const raw = await completeText(provider, improveDocsMessages(request), signal);
  if (signal.aborted) return;
  const tone = request.options?.tone ?? "concise";
  const preserved = request.options?.preserveCodeBlocks !== false;
  yield result({
    kind: "edit",
    label: "Improved Markdown",
    description: `Rewritten for a ${tone} tone${preserved ? "; code blocks preserved" : ""}.`,
    newText: matchTrailingNewline(stripCodeFence(raw), document.text),
    structured: true,
    deterministic: false,
  });
}

async function* generateDiagramTask(request: AiTaskRequest, deps: AiTaskDeps, signal: AbortSignal): AsyncGenerator<AiTaskEvent, void, void> {
  const provider = requireProvider(deps);
  const type = request.options?.mermaidType ?? "flowchart";
  yield { type: "status", message: `Drafting a ${type} diagram…` };
  const raw = await completeText(provider, generateDiagramMessages(request), signal);
  if (signal.aborted) return;
  yield result({
    kind: "edit",
    label: `Mermaid ${type} diagram`,
    description: "Replaces the document with the generated Mermaid source.",
    newText: normalizeMermaid(raw, type),
    structured: true,
    deterministic: false,
  });
}

/** Archify diagrams are accepted only when Archify's own gate passes, so the model gets repair turns with its diagnostics. */
async function* archifyTask(request: AiTaskRequest, deps: AiTaskDeps, signal: AbortSignal): AsyncGenerator<AiTaskEvent, void, void> {
  const type = request.options?.diagramType;
  if (!type) throw new TaskError("unparseable-output", "archify-diagram needs a diagram type.");
  const quality = request.options?.quality ?? "showcase";
  if (!deps.archify) {
    throw new TaskError("runtime-unavailable", "The Archify runtime is not available on this server.");
  }
  const verifier = deps.archify;
  const provider = requireProvider(deps);
  const maxAttempts = Math.max(1, deps.maxArchifyAttempts ?? 3);

  let messages: PromptMessage[] = [...archifyMessages(request, type, quality)];
  let lastDocument: string | null = null;
  let lastVerdict: ArchifyVerdictSummary = { ok: false, stage: null, diagnostics: [], warnings: 0 };
  let attempts = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    attempts = attempt;
    yield {
      type: "status",
      message: attempt === 1 ? `Drafting a ${type} diagram…` : `Repairing the diagram (attempt ${attempt} of ${maxAttempts})…`,
    };
    const raw = await completeText(provider, messages, signal);
    if (signal.aborted) return;

    const parsed = parseArchifyDocument(raw, type);
    if (!parsed.ok) {
      const diagnostics = [
        {
          code: "ai/invalid-document",
          message: parsed.message,
          supportedFixes: ["return one JSON object for the requested diagram type"],
        },
      ];
      lastVerdict = { ok: false, stage: "ai", diagnostics, warnings: 0 };
      messages = [...messages, { role: "assistant", content: raw }, { role: "user", content: archifyRepairMessage(diagnostics) }];
      continue;
    }

    yield { type: "status", message: "Checking the diagram with Archify…" };
    const rendered = await verifier.render({ type, quality, source: parsed.text }, signal);
    if (signal.aborted) return;

    lastDocument = parsed.text;
    if (rendered.ok) {
      yield result({
        kind: "archify",
        diagramType: type,
        quality,
        document: parsed.text,
        html: rendered.html,
        verdict: { ok: true, stage: null, diagnostics: [], warnings: rendered.validation.warnings },
        attempts: attempt,
      });
      return;
    }

    const diagnostics = rendered.diagnostics.length > 0
      ? rendered.diagnostics.map((d) => ({ code: d.code, message: d.message, supportedFixes: d.supportedFixes }))
      : [{ code: rendered.stage, message: rendered.message, supportedFixes: [] }];
    lastVerdict = { ok: false, stage: rendered.stage, diagnostics, warnings: 0 };
    if (["busy", "timeout", "runtime", "aborted"].includes(rendered.stage)) break;
    messages = [...messages, { role: "assistant", content: parsed.text }, { role: "user", content: archifyRepairMessage(diagnostics) }];
  }

  if (lastDocument === null) {
    throw new TaskError("unparseable-output", "The model did not return a diagram document.");
  }
  yield result({
    kind: "archify",
    diagramType: type,
    quality,
    document: lastDocument,
    html: null,
    verdict: lastVerdict,
    attempts,
  });
}

async function* reviewTask(request: AiTaskRequest, deps: AiTaskDeps, signal: AbortSignal): AsyncGenerator<AiTaskEvent, void, void> {
  const provider = requireProvider(deps);
  const workspace = request.workspace ?? [];
  yield { type: "status", message: `Reading ${workspace.length} files…` };
  let messages: PromptMessage[] = [...reviewMessages(workspace)];
  yield { type: "status", message: "Looking for deepening opportunities…" };
  let raw = await completeText(provider, messages, signal);
  if (signal.aborted) return;
  let parsed = parseReviewOutput(raw);
  if (!parsed.ok) {
    yield { type: "status", message: "Asking for valid JSON…" };
    messages = [
      ...messages,
      { role: "assistant", content: raw },
      { role: "user", content: `That reply does not match the required shape (${parsed.message}). Return only the JSON object.` },
    ];
    raw = await completeText(provider, messages, signal);
    if (signal.aborted) return;
    parsed = parseReviewOutput(raw);
  }
  if (!parsed.ok) {
    throw new TaskError("unparseable-output", `The review could not be read: ${parsed.message}`);
  }
  yield result({ kind: "review", summary: parsed.summary, candidates: parsed.candidates });
}
