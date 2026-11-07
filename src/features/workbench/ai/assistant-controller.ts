// The assistant's behaviour, without React. It builds each request from the
// exact text the user is looking at, applies the streamed events, keeps one run
// at a time, and decides when a proposal may land on a document. Every
// side effect goes through a port, so each rule is tested with fakes.

import type { AiRequestError } from "@/lib/ai/client/run-task";
import type { AiTaskRequest, AiTaskResult, ChatTurn, DocumentSnapshot, WorkspaceExcerpt, ConvertFormat, ImproveTone, MermaidType } from "@/lib/ai/tasks/contract";
import { AI_MAX_HISTORY_MESSAGES, AI_MAX_MESSAGE_CHARS } from "@/lib/ai/tasks/contract";
import type { ArchifyDiagramType, ArchifyQualityProfile } from "@/lib/archify/contract";

import type { RunTaskOptions } from "@/lib/ai/client/run-task";

import { DeltaBuffer, type Scheduler } from "./delta-buffer";
import { proposalFreshness } from "./proposal";
import type { AssistantStore, ProviderInfo } from "./assistant-store";
import { patchAssistant } from "./assistant-store";
import type { ArchifyProposal, AssistantMessage, AssistantPayload, EditProposal, ThreadMessage, UserMessage } from "./types";

export type AssistantAction =
  | { readonly task: "explain" }
  | { readonly task: "fix" }
  | { readonly task: "convert"; readonly targetFormat: ConvertFormat }
  | { readonly task: "improve-docs"; readonly tone: ImproveTone }
  | { readonly task: "generate-diagram"; readonly mermaidType: MermaidType; readonly description: string }
  | { readonly task: "archify-diagram"; readonly diagramType: ArchifyDiagramType; readonly quality: ArchifyQualityProfile; readonly description: string }
  | { readonly task: "architecture-review" };

export interface DocumentPort {
  activePath(): string | null;
  /** The draft text of an open document, or null when it is not open. */
  textOf(path: string): string | null;
  /** What the model needs to see: the draft, its format, the selection and the parser diagnostics. */
  snapshot(path: string): DocumentSnapshot | null;
  /** Replaces an open document's text as one undoable edit. */
  replaceText(path: string, text: string): void;
  /** Creates a file (a new one, not an existing one) and opens it. */
  createDocument(path: string, text: string): Promise<void>;
  /** A path that does not exist yet, derived from the suggestion. */
  uniquePath(suggestion: string): Promise<string>;
}

export interface AssistantPorts {
  readonly transport: (request: AiTaskRequest, options: RunTaskOptions) => Promise<void>;
  readonly documents: DocumentPort;
  readonly workspaceExcerpts: () => Promise<WorkspaceExcerpt[]>;
  /** Asks before an edit overwrites a document the user may have changed. */
  readonly confirmReplace: (path: string, reason: "stale" | "overwrite") => Promise<boolean>;
  readonly notify: (message: string, tone: "info" | "success" | "warning" | "error") => void;
  readonly fetchProvider: () => Promise<ProviderInfo | null>;
  readonly newId: () => string;
  readonly now: () => number;
  readonly scheduler?: Scheduler;
}

const DOCUMENT_TEXT_LIMIT = 200_000;

const EXTENSION_OF: Readonly<Record<ConvertFormat, string>> = {
  json: "json",
  jsonc: "jsonc",
  json5: "json5",
  yaml: "yaml",
  toml: "toml",
  toon: "toon",
  xml: "xml",
  markdown: "md",
};

function clip(text: string, limit: number): string {
  return text.length <= limit ? text : text.slice(0, limit);
}

function slugOf(text: string, fallback: string): string {
  const slug = text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
  return slug.length > 0 ? slug : fallback;
}

interface RunSpec {
  readonly task: AiTaskRequest["task"];
  readonly request: AiTaskRequest;
  readonly userText: string | null;
  readonly contextPath: string | null;
  readonly baseText: string | null;
  /** The user's own words for the task. Names a saved Archify diagram. */
  readonly title: string;
}

export class AssistantController {
  constructor(
    private readonly store: AssistantStore,
    private readonly ports: AssistantPorts
  ) {}

  /** Loads the provider status. A failed probe leaves the panel offline with a reason, never throws. */
  async loadProvider(): Promise<void> {
    let provider: ProviderInfo | null;
    try {
      provider = await this.ports.fetchProvider();
    } catch {
      provider = null;
    }
    this.store.getState().setProvider(
      provider ?? {
        id: "unknown",
        name: "AI",
        model: "",
        available: false,
        reason: "The workbench server did not answer the status check. Reload the page once the server is running.",
        generativeUi: false,
      }
    );
  }

  /** A chat turn. The document (with its selection and diagnostics) is attached so the model answers about it. */
  async send(text: string, options: { includeDocument?: boolean } = {}): Promise<void> {
    const trimmed = text.trim();
    if (trimmed.length === 0) return;
    const activePath = this.ports.documents.activePath();
    const snapshot = options.includeDocument !== false && activePath ? this.ports.documents.snapshot(activePath) : null;
    const history = this.historyTurns(trimmed);
    await this.execute({
      task: "chat",
      userText: trimmed,
      title: trimmed,
      contextPath: snapshot?.path ?? null,
      baseText: snapshot?.text ?? null,
      request: {
        task: "chat",
        messages: history,
        ...(snapshot ? { document: this.clipSnapshot(snapshot) } : {}),
        options: { generativeUi: this.store.getState().provider?.generativeUi === true },
      },
    });
  }

  /** Runs a structured action. Actions that edit a document use the active one, and the proposal records its text. */
  async run(action: AssistantAction): Promise<void> {
    const label = this.labelOf(action);
    if (this.store.getState().activeRun) {
      this.ports.notify("An assistant task is already running. Stop it first.", "warning");
      return;
    }
    switch (action.task) {
      case "explain":
      case "fix":
      case "convert":
      case "improve-docs": {
        const path = this.ports.documents.activePath();
        const snapshot = path ? this.ports.documents.snapshot(path) : null;
        if (!snapshot) return this.notice("Open a document first. The assistant works on the active file.", "warning");
        const options = this.optionsFor(action);
        return this.execute({
          task: action.task,
          userText: `${label} · ${snapshot.path}`,
          title: label,
          contextPath: snapshot.path,
          baseText: snapshot.text,
          request: { task: action.task, document: this.clipSnapshot(snapshot), ...(options ? { options } : {}) },
        });
      }
      case "generate-diagram":
        return this.execute({
          task: action.task,
          userText: `${label}: ${action.description}`,
          title: action.description,
          contextPath: null,
          baseText: null,
          request: { task: action.task, options: { mermaidType: action.mermaidType, description: action.description } },
        });
      case "archify-diagram":
        return this.execute({
          task: action.task,
          userText: `${label} (${action.diagramType}): ${action.description}`,
          title: action.description,
          contextPath: null,
          baseText: null,
          request: {
            task: action.task,
            options: { diagramType: action.diagramType, quality: action.quality, description: action.description },
          },
        });
      case "architecture-review": {
        const workspace = await this.ports.workspaceExcerpts();
        if (workspace.length === 0) return this.notice("Open a folder first. The review reads the files in the workspace.", "warning");
        return this.execute({
          task: action.task,
          userText: "Review the architecture of this workspace",
          title: "architecture review",
          contextPath: null,
          baseText: null,
          request: { task: action.task, workspace },
        });
      }
    }
  }

  /** Stops the run. The partial text stays in the thread, marked as cancelled. */
  cancel(): void {
    this.store.getState().activeRun?.controller.abort();
  }

  /** Follow-up chat about one candidate from an architecture review. */
  async exploreCandidate(messageId: string, index: number): Promise<void> {
    const message = this.store.getState().messages.find((m) => m.id === messageId);
    const payload = message && message.role === "assistant" ? message.payload : null;
    if (!payload || payload.kind !== "review") return;
    const candidate = payload.candidates[index];
    if (!candidate) return;
    await this.send(`Let's explore the "${candidate.title}" candidate. Walk me through the decision: constraints, dependencies, the shape of the deepened module and the tests that would survive.`, { includeDocument: false });
  }

  /**
   * A proposal raised from generated UI ("Review diff"). It targets the document
   * the message was generated for, and its base is that document's current text.
   */
  proposeFromGenerativeUi(messageId: string, request: { label: string; description?: string; newText: string }): void {
    const message = this.store.getState().messages.find((m) => m.id === messageId);
    if (!message || message.role !== "assistant" || !message.contextPath) {
      this.notice("The document this answer was generated for is no longer open.", "warning");
      return;
    }
    const baseText = this.ports.documents.textOf(message.contextPath);
    if (baseText === null) {
      this.notice("The document this answer was generated for is no longer open.", "warning");
      return;
    }
    const proposal: EditProposal = {
      kind: "edit",
      targetPath: message.contextPath,
      newPath: null,
      label: request.label,
      description: request.description ?? "",
      baseText,
      newText: request.newText,
      structured: true,
      deterministic: false,
      status: "open",
      savedPath: null,
    };
    this.patch(messageId, { payload: { kind: "proposal", proposal } });
  }

  /** Applies an edit proposal. A stale proposal is applied only after the user confirms. */
  async applyProposal(messageId: string): Promise<void> {
    const proposal = this.findProposal(messageId);
    if (!proposal || proposal.status !== "open") return;

    if (proposal.targetPath) {
      const current = this.ports.documents.textOf(proposal.targetPath);
      const freshness = proposalFreshness({ baseText: proposal.baseText }, current);
      if (freshness === "missing") {
        return this.notice(`${proposal.targetPath} is no longer open, so the change was not applied.`, "warning");
      }
      if (freshness === "stale" && !(await this.ports.confirmReplace(proposal.targetPath, "stale"))) return;
      this.ports.documents.replaceText(proposal.targetPath, proposal.newText);
      this.setProposal(messageId, { ...proposal, status: "applied" }, `Applied to ${proposal.targetPath}. Undo with Ctrl+Z.`);
      this.ports.notify(`Applied to ${proposal.targetPath}.`, "success");
      return;
    }

    const path = await this.ports.documents.uniquePath(proposal.newPath ?? "untitled.txt");
    await this.ports.documents.createDocument(path, proposal.newText);
    this.setProposal(messageId, { ...proposal, status: "applied", savedPath: path }, `Saved as ${path}.`);
    this.ports.notify(`Saved as ${path}.`, "success");
  }

  discardProposal(messageId: string): void {
    const proposal = this.findProposal(messageId);
    if (!proposal || proposal.status !== "open") return;
    this.setProposal(messageId, { ...proposal, status: "discarded" }, "Proposal discarded.");
  }

  /** Saves an Archify diagram as a new file, or replaces the active document with it. */
  async saveArchify(messageId: string, mode: "new-file" | "replace"): Promise<void> {
    const proposal = this.findArchify(messageId);
    if (!proposal || proposal.status !== "open") return;
    const activePath = this.ports.documents.activePath();
    if (mode === "replace") {
      if (!activePath) return this.notice("Open the document you want to replace first.", "warning");
      if (proposal.verdict.ok === false) return this.notice("Only a diagram that passed Archify can replace a document.", "warning");
      if (!(await this.ports.confirmReplace(activePath, "overwrite"))) return;
      this.ports.documents.replaceText(activePath, proposal.document);
      this.setArchify(messageId, { ...proposal, status: "saved", savedPath: activePath }, `Replaced ${activePath} with the diagram.`);
      this.ports.notify(`Replaced ${activePath}.`, "success");
      return;
    }
    const path = await this.ports.documents.uniquePath(`diagrams/${slugOf(proposal.title, "diagram")}.${proposal.diagramType}.json`);
    await this.ports.documents.createDocument(path, proposal.document);
    this.setArchify(messageId, { ...proposal, status: "saved", savedPath: path }, `Saved as ${path}. Its live preview is open.`);
    this.ports.notify(`Saved as ${path}.`, "success");
  }

  discardArchify(messageId: string): void {
    const proposal = this.findArchify(messageId);
    if (!proposal || proposal.status !== "open") return;
    this.setArchify(messageId, { ...proposal, status: "discarded" }, "Diagram discarded.");
  }

  clear(): void {
    this.cancel();
    this.store.getState().setMessages([]);
  }

  // -------------------------------------------------------------------------

  private async execute(spec: RunSpec): Promise<void> {
    const state = this.store.getState();
    if (state.activeRun) {
      this.ports.notify("An assistant task is already running. Stop it first.", "warning");
      return;
    }
    const now = this.ports.now();
    const assistant: AssistantMessage = {
      id: this.ports.newId(),
      role: "assistant",
      task: spec.task,
      text: "",
      state: "working",
      statusLine: "Starting…",
      error: null,
      generativeUi: false,
      contextPath: spec.contextPath,
      payload: null,
      createdAt: now,
    };
    const added: ThreadMessage[] = [];
    if (spec.userText !== null) {
      const user: UserMessage = {
        id: this.ports.newId(),
        role: "user",
        text: spec.userText,
        task: spec.task,
        contextPath: spec.contextPath,
        createdAt: now,
      };
      added.push(user);
    }
    added.push(assistant);

    const controller = new AbortController();
    const runId = this.ports.newId();
    const messages = [...state.messages, ...added];
    this.store.getState().setMessages(messages);
    this.store.getState().setActiveRun({ id: runId, assistantId: assistant.id, controller });

    const buffer = new DeltaBuffer((text) => this.appendText(assistant.id, text), this.ports.scheduler);
    let terminal = false;
    try {
      await this.ports.transport(spec.request, {
        signal: controller.signal,
        onEvent: (event) => {
          switch (event.type) {
            case "status":
              this.patch(assistant.id, { statusLine: event.message });
              break;
            case "delta":
              buffer.push(event.text);
              break;
            case "result":
              buffer.dispose();
              terminal = true;
              this.complete(assistant.id, event.result, spec);
              break;
            case "error":
              buffer.dispose();
              terminal = true;
              this.fail(assistant.id, event.code, event.message);
              break;
          }
        },
      });
    } catch (error) {
      buffer.dispose();
      if (controller.signal.aborted) {
        this.patch(assistant.id, { state: "cancelled", statusLine: null });
      } else {
        const failure = error as Partial<AiRequestError> & { message?: string };
        this.fail(assistant.id, failure.code ?? "internal", failure.message ?? "The task failed.");
      }
      terminal = true;
    } finally {
      buffer.dispose();
      if (!terminal) {
        if (controller.signal.aborted) this.patch(assistant.id, { state: "cancelled", statusLine: null });
        else this.fail(assistant.id, "internal", "The task ended without a result.");
      }
      this.store.getState().setActiveRun(null);
    }
  }

  private complete(id: string, result: AiTaskResult, spec: RunSpec): void {
    switch (result.kind) {
      case "text":
        this.patch(id, { state: "done", statusLine: null, text: result.text, generativeUi: result.generativeUi });
        return;
      case "edit": {
        // A conversion is a new file with the new extension, so the original keeps its format.
        const creates = spec.contextPath === null || spec.task === "convert";
        const proposal: EditProposal = {
          kind: "edit",
          targetPath: creates ? null : spec.contextPath,
          newPath: creates ? this.suggestedPathFor(spec.task, spec.contextPath, spec.request) : null,
          label: result.label,
          description: result.description,
          baseText: spec.baseText ?? "",
          newText: result.newText,
          structured: result.structured,
          deterministic: result.deterministic,
          status: "open",
          savedPath: null,
        };
        this.patch(id, { state: "done", statusLine: null, text: result.description, payload: { kind: "proposal", proposal } });
        return;
      }
      case "archify": {
        const proposal: ArchifyProposal = {
          kind: "archify",
          title: spec.title,
          diagramType: result.diagramType,
          quality: result.quality,
          document: result.document,
          html: result.html,
          verdict: result.verdict,
          attempts: result.attempts,
          status: "open",
          savedPath: null,
        };
        const summary = result.verdict.ok
          ? `Verified by Archify on attempt ${result.attempts}${result.verdict.warnings > 0 ? ` with ${result.verdict.warnings} composition warning${result.verdict.warnings === 1 ? "" : "s"}` : ""}.`
          : `Archify did not accept the diagram after ${result.attempts} attempt${result.attempts === 1 ? "" : "s"}. Review the diagnostics before saving.`;
        this.patch(id, { state: "done", statusLine: null, text: summary, payload: { kind: "archify", proposal } });
        return;
      }
      case "review":
        this.patch(id, {
          state: "done",
          statusLine: null,
          text: result.summary,
          payload: { kind: "review", summary: result.summary, candidates: result.candidates },
        });
        return;
    }
  }

  private fail(id: string, code: string, message: string): void {
    this.patch(id, { state: "failed", statusLine: null, error: { code, message }, text: message });
    if (code === "provider-unavailable") void this.loadProvider();
  }

  private appendText(id: string, text: string): void {
    const messages = this.store.getState().messages;
    const current = messages.find((m) => m.id === id);
    if (!current || current.role !== "assistant") return;
    this.store.getState().setMessages(patchAssistant(messages, id, { text: current.text + text }));
  }

  private patch(id: string, patch: Partial<AssistantMessage>): void {
    const store = this.store.getState();
    store.setMessages(patchAssistant(store.messages, id, patch));
  }

  private notice(text: string, tone: "info" | "warning"): void {
    this.store.getState().setMessages([
      ...this.store.getState().messages,
      { id: this.ports.newId(), role: "notice", text, tone, createdAt: this.ports.now() },
    ]);
  }

  private setProposal(messageId: string, proposal: EditProposal, note: string): void {
    const messages = this.store.getState().messages;
    const updated = messages.map((m) => {
      if (m.id !== messageId || m.role !== "assistant") return m;
      return { ...m, payload: { kind: "proposal" as const, proposal }, text: note };
    });
    this.store.getState().setMessages(updated);
  }

  private setArchify(messageId: string, proposal: ArchifyProposal, note: string): void {
    const messages = this.store.getState().messages;
    const updated = messages.map((m) => {
      if (m.id !== messageId || m.role !== "assistant") return m;
      return { ...m, payload: { kind: "archify" as const, proposal }, text: note };
    });
    this.store.getState().setMessages(updated);
  }

  private findProposal(messageId: string): EditProposal | null {
    const payload = this.payloadOf(messageId);
    return payload?.kind === "proposal" ? payload.proposal : null;
  }

  private findArchify(messageId: string): ArchifyProposal | null {
    const payload = this.payloadOf(messageId);
    return payload?.kind === "archify" ? payload.proposal : null;
  }

  private payloadOf(messageId: string): AssistantPayload | null {
    const message = this.store.getState().messages.find((m) => m.id === messageId);
    return message && message.role === "assistant" ? message.payload : null;
  }

  /**
   * The thread so far, then the new user turn. The new turn is always last,
   * even when the user repeats an earlier question, because the endpoint
   * requires a user message at the end.
   */
  private historyTurns(latest: string): ChatTurn[] {
    const prior: ChatTurn[] = this.store.getState().messages
      .filter((m): m is UserMessage | AssistantMessage => m.role === "user" || m.role === "assistant")
      .filter((m) => m.role === "user" || m.state !== "working")
      .map((m): ChatTurn => ({ role: m.role, content: clip(m.text.length > 0 ? m.text : "(no text)", AI_MAX_MESSAGE_CHARS) }));
    const latestTurn: ChatTurn = { role: "user", content: clip(latest, AI_MAX_MESSAGE_CHARS) };
    return [...prior, latestTurn].slice(-AI_MAX_HISTORY_MESSAGES - 1);
  }

  private clipSnapshot(snapshot: DocumentSnapshot): DocumentSnapshot {
    return { ...snapshot, text: clip(snapshot.text, DOCUMENT_TEXT_LIMIT) };
  }

  private optionsFor(action: AssistantAction): AiTaskRequest["options"] | null {
    if (action.task === "convert") return { targetFormat: action.targetFormat };
    if (action.task === "improve-docs") return { tone: action.tone, preserveCodeBlocks: true };
    return null;
  }

  private suggestedPathFor(task: AiTaskRequest["task"], contextPath: string | null, request: AiTaskRequest): string {
    if (task === "generate-diagram") {
      return `diagrams/${slugOf(request.options?.description ?? "", "diagram")}.mmd`;
    }
    if (task === "convert") {
      const format = request.options?.targetFormat;
      const stem = (contextPath ?? "converted").replace(/\.[^./]+$/, "");
      return `${stem}.${format ? EXTENSION_OF[format] : "txt"}`;
    }
    return "untitled.txt";
  }

  private labelOf(action: AssistantAction): string {
    switch (action.task) {
      case "explain":
        return "Explain";
      case "fix":
        return "Fix";
      case "convert":
        return `Convert to ${action.targetFormat}`;
      case "improve-docs":
        return "Improve";
      case "generate-diagram":
        return "Mermaid diagram";
      case "archify-diagram":
        return "Archify diagram";
      case "architecture-review":
        return "Architecture review";
    }
  }
}
