// AI Assistant panel. Streams responses from /api/ai/chat and exposes the
// structured actions (explain, fix, convert, generate-diagram, improve-docs).
// Proposed edits are shown for review-and-apply — they never auto-write to the
// editor buffer.

"use client";

import { useWorkbench } from "@/features/workbench/store";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useEffect, useRef, useState } from "react";
import { v4 as uuid } from "uuid";
import {
  Send,
  Sparkles,
  Wrench,
  FileSearch,
  RefreshCw,
  GitBranch,
  ListTree,
  Image as ImageIcon,
  Bot,
  Loader2,
  Check,
  X,
  User,
  Trash2,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AiMessage } from "@/features/workbench/store";
import { createPatch } from "diff";
import {
  GenerativeMessage,
  type ProposedEditRequest,
} from "@/features/workbench/ai-assistant/generative-ui/generative-message";
import { documentRegistry } from "@/documents/core/registry";

export function AiAssistant() {
  const messages = useWorkbench((s) => s.aiMessages);
  const appendMessage = useWorkbench((s) => s.appendAiMessage);
  const updateMessage = useWorkbench((s) => s.updateAiMessage);
  const clearMessages = useWorkbench((s) => s.clearAiMessages);
  const aiBusy = useWorkbench((s) => s.aiBusy);
  const setAiBusy = useWorkbench((s) => s.setAiBusy);
  const aiProvider = useWorkbench((s) => s.aiProvider);
  const setAiProvider = useWorkbench((s) => s.setAiProvider);
  const sessions = useWorkbench((s) => s.sessions);
  const activeTab = useWorkbench((s) => s.activeTab);
  const updateDraft = useWorkbench((s) => s.updateDraft);

  const [input, setInput] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Fetch provider info on mount.
  useEffect(() => {
    fetch("/api/ai/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (data) {
          setAiProvider({
            id: data.provider.id,
            name: data.provider.name,
            available: data.provider.available,
            generativeUi: data.features?.generativeUi === true,
          });
        }
      })
      .catch(() => {
        setAiProvider({
          id: "openai-compatible",
          name: "OpenAI-compatible API",
          available: false,
        });
      });
  }, [setAiProvider]);

  // Auto-scroll to the bottom on new messages.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const activeSession = activeTab ? sessions[activeTab] : null;
  const adapter = activeSession
    ? documentRegistry.resolve(activeSession.path)
    : null;

  async function sendChat() {
    if (!input.trim() || aiBusy) return;
    const text = input.trim();
    setInput("");
    const userMsg: AiMessage = {
      id: uuid(),
      role: "user",
      content: text,
      createdAt: Date.now(),
    };
    appendMessage(userMsg);
    const assistantId = uuid();
    appendMessage({
      id: assistantId,
      role: "assistant",
      content: "",
      streaming: true,
      createdAt: Date.now(),
    });
    setAiBusy(true);
    abortRef.current = new AbortController();
    try {
      const context = activeSession
        ? {
            filePath: activeSession.path,
            languageId: adapter?.languageId,
            adapterId: adapter?.id,
          }
        : undefined;
      const res = await fetch("/api/ai/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: [{ role: "user", content: text }],
          context,
          generativeUi: aiProvider?.generativeUi === true,
        }),
        signal: abortRef.current.signal,
      });
      if (!res.ok || !res.body) {
        const err = await res.text();
        updateMessage(assistantId, {
          content: `Request failed: ${res.status} ${err}`,
          streaming: false,
          error: err,
        });
        setAiBusy(false);
        return;
      }
      if (res.headers.get("X-Generative-UI") === "1") {
        updateMessage(assistantId, {
          generativeUi: true,
          contextPath: activeSession?.path,
        });
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        // SSE: each event ends with "\n\n"
        let idx;
        while ((idx = buf.indexOf("\n\n")) >= 0) {
          const frame = buf.slice(0, idx);
          buf = buf.slice(idx + 2);
          // Each line in the frame: "data: ..."
          for (const line of frame.split("\n")) {
            if (!line.startsWith("data:")) continue;
            const payload = line.slice(5).trim();
            if (payload === "[DONE]") continue;
            try {
              const obj = JSON.parse(payload) as {
                delta?: string;
                error?: string;
                done?: boolean;
              };
              if (obj.error) {
                updateMessage(assistantId, {
                  content: acc + `\n\nError: ${obj.error}`,
                  streaming: false,
                  error: obj.error,
                });
                setAiBusy(false);
                return;
              }
              if (obj.delta) {
                acc += obj.delta;
                updateMessage(assistantId, { content: acc });
              }
              if (obj.done) {
                updateMessage(assistantId, { streaming: false });
              }
            } catch {
              // ignore malformed frames
            }
          }
        }
      }
      updateMessage(assistantId, { streaming: false });
    } catch (err) {
      if ((err as Error).name === "AbortError") {
        updateMessage(assistantId, {
          content: "(cancelled)",
          streaming: false,
        });
      } else {
        updateMessage(assistantId, {
          content: `Error: ${(err as Error).message}`,
          streaming: false,
          error: (err as Error).message,
        });
      }
    } finally {
      setAiBusy(false);
      abortRef.current = null;
    }
  }

  function cancel() {
    if (abortRef.current) abortRef.current.abort();
  }

  async function runAction(
    kind: "explain" | "fix" | "convert" | "generate-diagram" | "improve-docs",
  ) {
    if (!activeSession || !adapter) {
      appendMessage({
        id: uuid(),
        role: "system",
        content: "Open a file before running an AI action.",
        createdAt: Date.now(),
      });
      return;
    }
    setAiBusy(true);
    const userMsg: AiMessage = {
      id: uuid(),
      role: "user",
      content: `[${kind}] on ${activeSession.path}`,
      createdAt: Date.now(),
    };
    appendMessage(userMsg);
    const assistantId = uuid();
    appendMessage({
      id: assistantId,
      role: "assistant",
      content: "Working…",
      streaming: true,
      createdAt: Date.now(),
    });
    try {
      if (kind === "convert") {
        // Ask the user for the target format via a prompt.
        const target = window.prompt(
          "Convert to format (json, yaml, toml, xml, toon, markdown):",
          "json",
        );
        if (!target) {
          updateMessage(assistantId, {
            content: "Cancelled",
            streaming: false,
          });
          setAiBusy(false);
          return;
        }
        const res = await fetch("/api/ai/convert", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: activeSession.draftText,
            fromFormat: adapter.id === "markdown" ? "markdown" : adapter.id,
            toFormat: target,
          }),
        });
        const json = await res.json();
        if (json.error) throw new Error(typeof json.error === "string" ? json.error : JSON.stringify(json.error));
        updateMessage(assistantId, {
          content: `Converted ${adapter.id} → ${target}. Review and apply below.`,
          streaming: false,
          proposedEdit: {
            label: `Apply ${target} conversion`,
            description: `Replace ${activeSession.path} content with the converted output.`,
            newText: json.result,
            path: activeSession.path,
          },
        });
      } else if (kind === "generate-diagram") {
        const description = window.prompt(
          "Describe the diagram you want:",
          "A user opens a workspace, edits a file, and previews it.",
        );
        if (!description) {
          updateMessage(assistantId, {
            content: "Cancelled",
            streaming: false,
          });
          setAiBusy(false);
          return;
        }
        const type = window.prompt(
          "Diagram type (flowchart, sequence, state, er, class):",
          "flowchart",
        ) as "flowchart" | "sequence" | "state" | "er" | "class";
        const res = await fetch("/api/ai/generate-diagram", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ description, type }),
        });
        const json = await res.json();
        if (json.error) throw new Error(typeof json.error === "string" ? json.error : JSON.stringify(json.error));
        updateMessage(assistantId, {
          content: `Generated Mermaid diagram. Review and apply below.`,
          streaming: false,
          proposedEdit: {
            label: "Apply Mermaid source",
            description:
              "Replace the active document with the generated diagram.",
            newText: json.mermaid,
            path: activeSession.path,
          },
        });
      } else if (kind === "explain") {
        const res = await fetch("/api/ai/explain", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filePath: activeSession.path,
            languageId: adapter.languageId,
            adapterId: adapter.id,
            source: activeSession.draftText,
            generativeUi: aiProvider?.generativeUi === true,
          }),
        });
        const json = await res.json();
        if (json.error) throw new Error(typeof json.error === "string" ? json.error : JSON.stringify(json.error));
        if (json.format === "openui") {
          updateMessage(assistantId, {
            content: json.explanation ?? "",
            streaming: false,
            generativeUi: true,
            contextPath: activeSession.path,
          });
          return;
        }
        const ambiguity = json.ambiguity?.length
          ? `\n\n**Ambiguity flagged:**\n${json.ambiguity.map((a: string) => `- ${a}`).join("\n")}`
          : "";
        updateMessage(assistantId, {
          content: `${json.explanation ?? json.error ?? "No explanation available."}${ambiguity}`,
          streaming: false,
        });
      } else if (kind === "fix") {
        const diagnostics =
          useWorkbench.getState().diagnostics[activeSession.path] ?? [];
        const res = await fetch("/api/ai/fix", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            filePath: activeSession.path,
            languageId: adapter.languageId,
            adapterId: adapter.id,
            source: activeSession.draftText,
            diagnostics,
          }),
        });
        const json = await res.json();
        if (json.error) throw new Error(typeof json.error === "string" ? json.error : JSON.stringify(json.error));
        const edit = json.proposedEdit;
        updateMessage(assistantId, {
          content: `${edit.label ?? "Apply AI suggestion"}${edit.description ? ` — ${edit.description}` : ""}`,
          streaming: false,
          proposedEdit: {
            label: edit.label ?? "Apply AI suggestion",
            description: edit.description,
            newText: edit.newText,
            path: activeSession.path,
            diff: edit.diff,
          },
        });
      } else if (kind === "improve-docs") {
        const res = await fetch("/api/ai/improve-docs", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            source: activeSession.draftText,
            preserveCodeBlocks: true,
            tone: "detailed",
          }),
        });
        const json = await res.json();
        if (json.error) throw new Error(typeof json.error === "string" ? json.error : JSON.stringify(json.error));
        updateMessage(assistantId, {
          content: `Improved Markdown. Review and apply below.${json.diff ? "" : ""}`,
          streaming: false,
          proposedEdit: {
            label: "Apply improved docs",
            description:
              "Replace the active document with the rewritten Markdown.",
            newText: json.improved,
            path: activeSession.path,
            diff: json.diff,
          },
        });
      }
    } catch (err) {
      updateMessage(assistantId, {
        content: `Error: ${err instanceof Error ? err.message : String(err)}`,
        streaming: false,
        error: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setAiBusy(false);
    }
  }

  function applyProposedEdit(msg: AiMessage) {
    if (!msg.proposedEdit) return;
    updateDraft(msg.proposedEdit.path, msg.proposedEdit.newText);
    updateMessage(msg.id, {
      proposedEdit: undefined,
      content: `${msg.content}\n\n✅ Applied to ${msg.proposedEdit.path}`,
    });
  }

  /**
   * Generated UI asked to propose an edit. Turn it into the existing
   * review-and-apply flow (diff shown, user must click Apply); nothing is
   * written here. The edit targets the document the message was generated
   * against, never whatever tab happens to be active now.
   */
  function proposeEditFromGeneratedUi(msg: AiMessage, req: ProposedEditRequest) {
    const path = msg.contextPath;
    const current = path ? useWorkbench.getState().sessions[path] : undefined;
    if (!path || !current) {
      updateMessage(msg.id, {
        content: `${msg.content}\n\n⚠️ Cannot review edit: the target document is no longer open.`,
      });
      return;
    }
    updateMessage(msg.id, {
      proposedEdit: {
        label: req.label,
        description: req.description,
        newText: req.newText,
        path,
        diff: createPatch(path, current.draftText, req.newText, "current", "proposed"),
      },
    });
  }

  function discardProposedEdit(msg: AiMessage) {
    updateMessage(msg.id, {
      proposedEdit: undefined,
      content: `${msg.content}\n\n❌ Discarded by user.`,
    });
  }

  return (
    <div className="flex h-full flex-col bg-card">
      <div className="flex h-9 items-center justify-between border-b bg-muted/30 px-3">
        <div className="flex items-center gap-2 text-xs">
          <Sparkles className="h-3.5 w-3.5" />
          <span className="font-semibold">AI Assistant</span>
          {aiProvider && (
            <span
              className={cn(
                "rounded px-1.5 py-0.5 text-[10px]",
                aiProvider.available
                  ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                  : "bg-muted text-muted-foreground",
              )}
            >
              {aiProvider.available ? "connected" : "offline"}
            </span>
          )}
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6"
          onClick={clearMessages}
          title="Clear"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Action chips */}
      <div className="flex flex-wrap gap-1 border-b px-2 py-2">
        <ActionButton
          icon={<FileSearch className="h-3 w-3" />}
          label="Explain"
          onClick={() => runAction("explain")}
          disabled={aiBusy || !activeSession}
        />
        <ActionButton
          icon={<Wrench className="h-3 w-3" />}
          label="Fix"
          onClick={() => runAction("fix")}
          disabled={aiBusy || !activeSession}
        />
        <ActionButton
          icon={<RefreshCw className="h-3 w-3" />}
          label="Convert"
          onClick={() => runAction("convert")}
          disabled={aiBusy || !activeSession}
        />
        <ActionButton
          icon={<ImageIcon className="h-3 w-3" />}
          label="Diagram"
          onClick={() => runAction("generate-diagram")}
          disabled={aiBusy || !activeSession}
        />
        <ActionButton
          icon={<ListTree className="h-3 w-3" />}
          label="Improve"
          onClick={() => runAction("improve-docs")}
          disabled={aiBusy || !activeSession}
        />
      </div>

      {/* Context info */}
      <div className="border-b px-3 py-1.5 text-[10px] text-muted-foreground">
        {activeSession && adapter ? (
          <span>
            Context:{" "}
            <span className="font-mono text-foreground">
              {activeSession.path}
            </span>{" "}
            · {adapter.displayName}
          </span>
        ) : (
          <span>No active document for context.</span>
        )}
      </div>

      {/* Messages */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
        <div className="flex flex-col gap-3 p-3">
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-center text-xs text-muted-foreground">
              <Bot className="h-6 w-6 opacity-50" />
              <div>
                Ask anything about your document, or run a structured action
                above.
              </div>
              <div>
                AI changes are returned as proposed edits — you always review
                before they are applied.
              </div>
            </div>
          )}
          {messages.map((m) => (
            <MessageBubble
              key={m.id}
              message={m}
              onApply={() => applyProposedEdit(m)}
              onDiscard={() => discardProposedEdit(m)}
              onProposeEdit={(req) => proposeEditFromGeneratedUi(m, req)}
            />
          ))}
        </div>
      </div>

      {/* Input */}
      <div className="border-t p-2">
        <div className="flex items-end gap-2">
          <Textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="Ask about the document…"
            className="min-h-[44px] flex-1 resize-none text-xs"
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                sendChat();
              }
            }}
          />
          {aiBusy ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={cancel}
              className="gap-1"
            >
              <X className="h-3.5 w-3.5" />
              Cancel
            </Button>
          ) : (
            <Button
              size="sm"
              onClick={sendChat}
              disabled={!input.trim()}
              className="gap-1"
            >
              <Send className="h-3.5 w-3.5" />
              Send
            </Button>
          )}
        </div>
        <div className="mt-1 text-[10px] text-muted-foreground">
          Enter to send · Shift+Enter for newline
        </div>
      </div>
    </div>
  );
}

function ActionButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <Button
      variant="outline"
      size="sm"
      className="h-6 gap-1 px-2 text-[10px]"
      onClick={onClick}
      disabled={disabled}
    >
      {icon}
      {label}
    </Button>
  );
}

function MessageBubble({
  message,
  onApply,
  onDiscard,
  onProposeEdit,
}: {
  message: AiMessage;
  onApply: () => void;
  onDiscard: () => void;
  onProposeEdit: (req: ProposedEditRequest) => void;
}) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  return (
    <div className={cn("flex gap-2", isUser ? "justify-end" : "justify-start")}>
      <div
        className={cn(
          "max-w-[85%] rounded-lg px-3 py-2 text-xs",
          isUser
            ? "bg-primary text-primary-foreground"
            : isSystem
              ? "bg-muted text-muted-foreground italic"
              : "bg-muted/60",
        )}
      >
        {!isUser && (
          <div className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground">
            {isUser ? (
              <User className="h-2.5 w-2.5" />
            ) : isSystem ? null : (
              <Bot className="h-2.5 w-2.5" />
            )}
            <span>{isUser ? "You" : isSystem ? "System" : "Assistant"}</span>
            {message.streaming && (
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
            )}
          </div>
        )}
        {message.generativeUi && message.role === "assistant" ? (
          <GenerativeMessage
            content={message.content}
            streaming={Boolean(message.streaming)}
            onProposeEdit={onProposeEdit}
          />
        ) : (
          <div className="whitespace-pre-wrap break-words">{message.content}</div>
        )}
        {message.proposedEdit && (
          <div className="mt-2 rounded border bg-background/60 p-2">
            <div className="flex items-center gap-1 text-[10px] font-medium">
              <GitBranch className="h-3 w-3" />
              {message.proposedEdit.label}
            </div>
            {message.proposedEdit.description && (
              <div className="mt-0.5 text-[10px] text-muted-foreground">
                {message.proposedEdit.description}
              </div>
            )}
            {message.proposedEdit.diff && (
              <pre className="mt-2 max-h-40 overflow-auto rounded border bg-muted/40 p-1.5 text-[9px] leading-tight">
                <code>{message.proposedEdit.diff}</code>
              </pre>
            )}
            <div className="mt-2 flex gap-1">
              <Button
                size="sm"
                variant="default"
                className="h-6 gap-1 text-[10px]"
                onClick={onApply}
              >
                <Check className="h-3 w-3" />
                Apply
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-6 gap-1 text-[10px]"
                onClick={onDiscard}
              >
                <X className="h-3 w-3" />
                Discard
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
