// The AI assistant panel. It composes the thread, the action bar, the composer
// and the parameter dialog. All behaviour lives in the assistant controller;
// this file only renders state and forwards intent.

"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Plus, Sparkles, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { documentRegistry } from "@/documents/core/registry";
import { confirmAction } from "@/features/workbench/dialogs/dialog-store";
import { assistantController, useAssistantState } from "@/features/workbench/ai/wiring";
import { useWorkbench } from "@/features/workbench/store";

import { ActionBar, type DialogRequest } from "./action-bar";
import { Composer } from "./composer";
import { ParameterDialog } from "./parameter-dialog";
import { ProviderStatus } from "./provider-status";
import { Thread, type ThreadHandlers } from "./thread";

const SUGGESTIONS = ["Summarise this file", "What could go wrong here?", "Suggest a clearer structure"] as const;

interface AiAssistantProps {
  /** Shown as a close button when the panel is in a sheet or a drawer. */
  readonly onClose?: () => void;
}

export function AiAssistant({ onClose }: AiAssistantProps = {}) {
  const controller = assistantController();
  const messages = useAssistantState((s) => s.messages);
  const activeRun = useAssistantState((s) => s.activeRun);
  const provider = useAssistantState((s) => s.provider);
  const activePath = useWorkbench((s) => s.activeTab);
  const diagnosticCount = useWorkbench((s) => (s.activeTab ? s.diagnostics[s.activeTab]?.length ?? 0 : 0));
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const [seed, setSeed] = useState<{ text: string } | null>(null);
  const busy = activeRun !== null;
  const hasDocument = activePath !== null;
  const offline = provider !== null && !provider.available;

  useEffect(() => {
    void controller.loadProvider();
  }, [controller]);

  const handlers: ThreadHandlers = useMemo(
    () => ({
      applyProposal: (id) => void controller.applyProposal(id),
      discardProposal: (id) => controller.discardProposal(id),
      saveArchify: (id, mode) => void controller.saveArchify(id, mode),
      discardArchify: (id) => controller.discardArchify(id),
      exploreCandidate: (id, index) => void controller.exploreCandidate(id, index),
      proposeFromGenerativeUi: (id, request) => controller.proposeFromGenerativeUi(id, request),
      hasActiveDocument: hasDocument,
    }),
    [controller, hasDocument]
  );

  const newChat = async () => {
    if (messages.length > 0 && !busy) {
      const ok = await confirmAction({
        title: "Start a new conversation?",
        description: "The current conversation is cleared. Applied changes stay in your documents.",
        confirmLabel: "Start new",
        destructive: true,
      });
      if (!ok) return;
    }
    controller.clear();
  };

  const contextLabel = activePath
    ? `${activePath} · ${documentRegistry.resolve(activePath).displayName}`
    : "No document open. Explain, Fix and Convert need one.";

  return (
    <section aria-label="AI assistant" className="flex h-full min-h-0 flex-col bg-card">
      <header className="flex h-10 shrink-0 items-center gap-2 border-b bg-muted/30 px-3">
        <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden="true" />
        <h2 className="text-xs font-semibold">Assistant</h2>
        <div className="ml-auto flex items-center gap-1">
          <ProviderStatus />
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => void newChat()} aria-label="New conversation" title="New conversation">
            <Plus className="h-3.5 w-3.5" aria-hidden="true" />
          </Button>
          {onClose && (
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Hide assistant" title="Hide assistant">
              <X className="h-3.5 w-3.5" aria-hidden="true" />
            </Button>
          )}
        </div>
      </header>

      {offline && (
        <div role="status" className="mx-2 mt-2 flex shrink-0 items-start gap-2 rounded-md border border-amber-300/70 bg-amber-50 px-3 py-2 text-[12px] text-amber-900 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <p className="font-medium">The assistant is offline</p>
            <p className="mt-0.5 break-words opacity-90">{provider?.reason}</p>
          </div>
          <Button variant="outline" size="sm" className="h-6 shrink-0 px-2 text-[11px]" onClick={() => void controller.loadProvider()}>
            Check again
          </Button>
        </div>
      )}

      <ActionBar
        disabled={busy}
        hasDocument={hasDocument}
        diagnosticCount={diagnosticCount}
        onRun={(action) => void controller.run(action)}
        onOpenDialog={setDialog}
      />

      <p className="shrink-0 truncate border-b px-3 py-1.5 text-[11px] text-muted-foreground" title={contextLabel}>
        Context: {contextLabel}
      </p>

      <Thread
        messages={messages}
        handlers={handlers}
        empty={
          <div className="flex flex-col items-center gap-4 px-4 py-10 text-center">
            <div className="grid h-10 w-10 place-items-center rounded-full bg-primary/10 text-primary">
              <Sparkles className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium">Ask about this file</p>
              <p className="text-[12px] leading-relaxed text-muted-foreground">
                Answers see the document you have open. Changes arrive as proposals you review before anything is written.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-1.5">
              {SUGGESTIONS.map((text) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => setSeed({ text })}
                  className="rounded-full border bg-background px-3 py-1 text-[12px] text-muted-foreground transition-colors hover:border-primary/50 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        }
      />

      <Composer
        busy={busy}
        seed={seed}
        placeholder={busy ? "Working…" : offline ? "The assistant is offline. Check the status above." : "Ask about the file, or describe a change"}
        onSend={(text) => void controller.send(text)}
        onStop={() => controller.cancel()}
      />

      <ParameterDialog
        request={dialog}
        onClose={() => setDialog(null)}
        onSubmit={(action) => void controller.run(action)}
      />
    </section>
  );
}
