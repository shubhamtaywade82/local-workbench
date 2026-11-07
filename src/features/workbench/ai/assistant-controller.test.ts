import { describe, expect, test } from "bun:test";

import type { AiTaskEvent, AiTaskRequest, AiTaskResult } from "@/lib/ai/tasks/contract";
import type { RunTaskOptions } from "@/lib/ai/client/run-task";

import { AssistantController, type DocumentPort, type AssistantPorts } from "./assistant-controller";
import { createAssistantStore } from "./assistant-store";
import type { AssistantMessage, ThreadMessage } from "./types";

type Script = (request: AiTaskRequest, options: RunTaskOptions) => Promise<void> | void;

function fakeDocuments(files: Record<string, string>, active: string | null) {
  const texts = new Map(Object.entries(files));
  let activeTab = active;
  const port: DocumentPort = {
    activePath: () => activeTab,
    textOf: (path) => texts.get(path) ?? null,
    snapshot: (path) => {
      const text = texts.get(path);
      return text === undefined ? null : { path, languageId: "markdown", adapterId: "markdown", text };
    },
    replaceText: (path, text) => texts.set(path, text),
    createDocument: async (path, text) => {
      texts.set(path, text);
      activeTab = path;
    },
    uniquePath: async (suggestion) => {
      let candidate = suggestion;
      let n = 2;
      while (texts.has(candidate)) candidate = suggestion.replace(/(\.[^.]+)?$/, (ext) => `-${n++}${ext}`);
      return candidate;
    },
  };
  return { port, texts, close: () => (activeTab = null), setText: (p: string, t: string) => texts.set(p, t) };
}

function setup(script: Script, options: { confirm?: boolean; provider?: boolean } = {}) {
  const store = createAssistantStore();
  const docs = fakeDocuments({ "notes.md": "# Notes\n" }, "notes.md");
  const requests: AiTaskRequest[] = [];
  const notices: string[] = [];
  const confirms: { path: string; reason: string }[] = [];
  let id = 0;
  const ports: AssistantPorts = {
    transport: async (request, runOptions) => {
      requests.push(request);
      await script(request, runOptions);
    },
    documents: docs.port,
    workspaceExcerpts: async () => [{ path: "src/a.ts", excerpt: "export const a = 1;" }],
    confirmReplace: async (path, reason) => {
      confirms.push({ path, reason });
      return options.confirm ?? true;
    },
    notify: (message, tone) => notices.push(`${tone}: ${message}`),
    fetchProvider: async () =>
      options.provider === false
        ? null
        : { id: "fake", name: "Fake", model: "m", available: true, reason: null, generativeUi: false },
    newId: () => `id-${++id}`,
    now: () => 1000,
    scheduler: (run) => {
      run();
      return () => undefined;
    },
  };
  const controller = new AssistantController(store, ports);
  const messages = () => store.getState().messages;
  const assistant = (): AssistantMessage => {
    const found = [...messages()].reverse().find((m): m is AssistantMessage => m.role === "assistant");
    if (!found) throw new Error("no assistant message");
    return found;
  };
  return { store, controller, docs, requests, notices, confirms, messages, assistant };
}

/** Emits the given events in order, then resolves. */
const emits = (...events: AiTaskEvent[]): Script => (_request, options) => {
  for (const event of events) options.onEvent(event);
};

const textResult = (text: string): AiTaskEvent => ({ type: "result", result: { kind: "text", text, generativeUi: false } });
const editResult = (newText: string, label = "Tidy"): AiTaskEvent => ({
  type: "result",
  result: { kind: "edit", label, description: "d", newText, structured: true, deterministic: false } satisfies AiTaskResult,
});

describe("chat", () => {
  test("adds the user turn and streams the answer into the assistant message", async () => {
    const t = setup(emits({ type: "status", message: "Thinking…" }, { type: "delta", text: "Hel" }, { type: "delta", text: "lo" }, textResult("Hello")));
    await t.controller.send("hi");
    expect(t.messages().map((m) => m.role)).toEqual(["user", "assistant"]);
    expect(t.assistant()).toMatchObject({ state: "done", text: "Hello", statusLine: null });
    expect(t.store.getState().activeRun).toBeNull();
    expect(t.requests[0].document?.path).toBe("notes.md");
    expect(t.requests[0].messages?.at(-1)).toEqual({ role: "user", content: "hi" });
  });

  test("always ends the request with the new user turn, even for a repeated question", async () => {
    const t = setup(emits(textResult("one")));
    await t.controller.send("same question");
    t.store.getState().setActiveRun(null);
    await t.controller.send("same question");
    const last = t.requests[1].messages?.at(-1);
    expect(last).toEqual({ role: "user", content: "same question" });
    expect(t.requests[1].messages?.length).toBeGreaterThan(1);
  });

  test("leaves the thread intact when the provider is unavailable", async () => {
    const t = setup(emits({ type: "error", code: "provider-unavailable", message: "Set OPENAI_API_KEY." }), { provider: false });
    await t.controller.send("hi");
    expect(t.assistant()).toMatchObject({ state: "failed", error: { code: "provider-unavailable", message: "Set OPENAI_API_KEY." } });
    // The failure refreshes the status, so the panel shows offline and why.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(t.store.getState().provider).toMatchObject({ available: false });
  });
});

describe("proposals", () => {
  test("applies a current proposal as an edit to the open document without asking", async () => {
    const t = setup(emits(editResult("# Tidy\n")));
    await t.controller.run({ task: "fix" });
    const message = t.assistant();
    expect(message.payload?.kind).toBe("proposal");
    await t.controller.applyProposal(message.id);
    expect(t.docs.texts.get("notes.md")).toBe("# Tidy\n");
    expect(t.confirms).toEqual([]);
    expect(t.notices).toContain("success: Applied to notes.md.");
    expect(t.assistant().payload).toMatchObject({ kind: "proposal", proposal: { status: "applied" } });
  });

  test("asks before applying a stale proposal, and applies only on confirmation", async () => {
    const declined = setup(emits(editResult("# Tidy\n")), { confirm: false });
    await declined.controller.run({ task: "fix" });
    declined.docs.setText("notes.md", "# Notes\nedited by the user\n");
    await declined.controller.applyProposal(declined.assistant().id);
    expect(declined.confirms).toEqual([{ path: "notes.md", reason: "stale" }]);
    expect(declined.docs.texts.get("notes.md")).toBe("# Notes\nedited by the user\n");
    expect(declined.assistant().payload).toMatchObject({ kind: "proposal", proposal: { status: "open" } });

    const confirmed = setup(emits(editResult("# Tidy\n")), { confirm: true });
    await confirmed.controller.run({ task: "fix" });
    confirmed.docs.setText("notes.md", "edited\n");
    await confirmed.controller.applyProposal(confirmed.assistant().id);
    expect(confirmed.docs.texts.get("notes.md")).toBe("# Tidy\n");
  });

  test("refuses to apply when the document is no longer open", async () => {
    const t = setup(emits(editResult("# Tidy\n")));
    await t.controller.run({ task: "fix" });
    t.docs.close();
    t.docs.texts.delete("notes.md");
    await t.controller.applyProposal(t.assistant().id);
    expect(t.messages().at(-1)).toMatchObject({ role: "notice", tone: "warning" });
    expect((t.messages().at(-1) as { text: string }).text).toContain("no longer open");
    expect(t.docs.texts.has("notes.md")).toBe(false);
  });

  test("discarding closes the proposal for good", async () => {
    const t = setup(emits(editResult("# Tidy\n")));
    await t.controller.run({ task: "fix" });
    t.controller.discardProposal(t.assistant().id);
    await t.controller.applyProposal(t.assistant().id);
    expect(t.docs.texts.get("notes.md")).toBe("# Notes\n");
    expect(t.assistant().payload).toMatchObject({ kind: "proposal", proposal: { status: "discarded" } });
  });

  test("a generated diagram becomes a new file, never a change to the open document", async () => {
    const t = setup(emits(editResult("flowchart\nA-->B", "Mermaid flowchart diagram")));
    await t.controller.run({ task: "generate-diagram", mermaidType: "flowchart", description: "Login flow" });
    const proposal = t.assistant().payload;
    expect(proposal?.kind === "proposal" && proposal.proposal.targetPath).toBeNull();
    await t.controller.applyProposal(t.assistant().id);
    expect(t.docs.texts.get("diagrams/login-flow.mmd")).toBe("flowchart\nA-->B");
    expect(t.docs.texts.get("notes.md")).toBe("# Notes\n");
  });
});

describe("runs", () => {
  test("refuses an action that needs a document when none is open", async () => {
    const t = setup(emits(textResult("unused")));
    t.docs.close();
    await t.controller.run({ task: "explain" });
    expect(t.requests).toEqual([]);
    expect(t.messages().at(-1)).toMatchObject({ role: "notice", tone: "warning" });
  });

  test("allows one run at a time", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const t = setup(async (_request, options) => {
      options.onEvent({ type: "delta", text: "part" });
      await gate;
      options.onEvent(textResult("done"));
    });
    const first = t.controller.send("one");
    await Promise.resolve();
    await t.controller.send("two");
    expect(t.requests.length).toBe(1);
    expect(t.notices).toContain("warning: An assistant task is already running. Stop it first.");
    release();
    await first;
  });

  test("cancelling keeps the partial answer and marks it cancelled", async () => {
    const t = setup((_request, options) => {
      options.onEvent({ type: "delta", text: "partial" });
      return new Promise<void>((_resolve, reject) => {
        options.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      });
    });
    const running = t.controller.send("long question");
    await Promise.resolve();
    await Promise.resolve();
    t.controller.cancel();
    await running;
    expect(t.assistant()).toMatchObject({ state: "cancelled", text: "partial" });
    expect(t.store.getState().activeRun).toBeNull();
  });

  test("a stream that ends without a result is reported as failed, not left working", async () => {
    const t = setup(emits({ type: "delta", text: "half" }));
    await t.controller.send("hi");
    expect(t.assistant()).toMatchObject({ state: "failed", error: { code: "internal" } });
  });
});

describe("architecture review", () => {
  const candidate = {
    title: "Collapse the AI pipeline",
    strength: "Strong" as const,
    files: ["src/lib/ai/server.ts"],
    problem: "Routes repeat work.",
    solution: "One runner.",
    wins: ["leverage: one path"],
    beforeMermaid: "flowchart LR\n A --> B",
    afterMermaid: "flowchart LR\n A --> C",
  };

  test("stores the candidates and explores one as a follow-up chat turn", async () => {
    const t = setup(emits({ type: "result", result: { kind: "review", summary: "One hot spot.", candidates: [candidate] } }));
    await t.controller.run({ task: "architecture-review" });
    expect(t.assistant().payload).toMatchObject({ kind: "review", candidates: [{ title: "Collapse the AI pipeline" }] });
    await t.controller.exploreCandidate(t.assistant().id, 0);
    expect(t.requests.at(-1)?.messages?.at(-1)?.content).toContain('"Collapse the AI pipeline"');
  });
});

describe("generated UI proposals", () => {
  test("target the document the answer was generated for, from its current text", async () => {
    const t = setup(emits({ type: "result", result: { kind: "text", text: "Here.", generativeUi: true } }));
    await t.controller.send("improve it");
    t.docs.setText("notes.md", "# Notes\nedited\n");
    t.controller.proposeFromGenerativeUi(t.assistant().id, { label: "Add a heading", newText: "# Notes\nedited\n## New\n" });
    expect(t.assistant().payload).toMatchObject({
      kind: "proposal",
      proposal: { targetPath: "notes.md", baseText: "# Notes\nedited\n", status: "open" },
    });
  });
});

