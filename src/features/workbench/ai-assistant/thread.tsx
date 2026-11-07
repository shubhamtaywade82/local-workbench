// The conversation. Only the message that changes re-renders while a reply
// streams: each item is memoized, and the controller keeps unchanged messages
// by identity. The thread follows new output only while the reader is at the bottom.

"use client";

import { memo, useEffect, useRef, type ReactNode } from "react";
import { AlertCircle, Bot, Info, Loader2, User } from "lucide-react";

import { GenerativeMessage, type ProposedEditRequest } from "@/features/workbench/ai-assistant/generative-ui/generative-message";
import type { AssistantMessage, ThreadMessage } from "@/features/workbench/ai/types";
import { MarkdownRenderer } from "@/lib/preview-renderers/markdown-renderer";
import { cn } from "@/lib/utils";

import { ArchifyView } from "./archify-view";
import { ProposalView } from "./proposal-view";
import { ReviewView } from "./review-view";

export interface ThreadHandlers {
  readonly applyProposal: (messageId: string) => void;
  readonly discardProposal: (messageId: string) => void;
  readonly saveArchify: (messageId: string, mode: "new-file" | "replace") => void;
  readonly discardArchify: (messageId: string) => void;
  readonly exploreCandidate: (messageId: string, index: number) => void;
  readonly proposeFromGenerativeUi: (messageId: string, request: ProposedEditRequest) => void;
  readonly hasActiveDocument: boolean;
}

interface ThreadProps {
  readonly messages: readonly ThreadMessage[];
  readonly handlers: ThreadHandlers;
  readonly empty: ReactNode;
}

const NEAR_BOTTOM_PX = 96;

export function Thread({ messages, handlers, empty }: ThreadProps) {
  const scroller = useRef<HTMLDivElement>(null);
  const atBottom = useRef(true);

  useEffect(() => {
    const element = scroller.current;
    if (element && atBottom.current) element.scrollTop = element.scrollHeight;
  }, [messages]);

  return (
    <div
      ref={scroller}
      role="log"
      aria-live="polite"
      aria-label="Conversation"
      onScroll={(event) => {
        const element = event.currentTarget;
        atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
      }}
      className="min-h-0 flex-1 overflow-y-auto"
    >
      <div className="space-y-4 p-3">
        {messages.length === 0
          ? empty
          : messages.map((message) => <MessageItem key={message.id} message={message} handlers={handlers} />)}
      </div>
    </div>
  );
}

const MessageItem = memo(function MessageItem({ message, handlers }: { message: ThreadMessage; handlers: ThreadHandlers }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[88%] whitespace-pre-wrap break-words rounded-2xl rounded-br-md bg-primary px-3 py-2 text-[13px] leading-5 text-primary-foreground">
          {message.text}
        </div>
      </div>
    );
  }
  if (message.role === "notice") {
    const Icon = message.tone === "warning" ? AlertCircle : Info;
    return (
      <div className="flex justify-center">
        <p role="status" className="inline-flex max-w-full items-center gap-1.5 rounded-full border bg-muted/40 px-3 py-1 text-center text-[11px] text-muted-foreground">
          <Icon className="h-3 w-3 shrink-0" aria-hidden="true" />
          {message.text}
        </p>
      </div>
    );
  }
  return <AssistantItem message={message} handlers={handlers} />;
});

function AssistantItem({ message, handlers }: { message: AssistantMessage; handlers: ThreadHandlers }) {
  const working = message.state === "working";
  const payload = message.payload;
  return (
    <article aria-label="Assistant reply" aria-busy={working} className="min-w-0 space-y-2">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span className="grid h-5 w-5 place-items-center rounded-full bg-muted">
          <Bot className="h-3 w-3" aria-hidden="true" />
        </span>
        <span>Assistant</span>
      </div>

      {working && (
        <p role="status" className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <Loader2 className="h-3 w-3 motion-safe:animate-spin" aria-hidden="true" />
          {message.statusLine ?? "Working…"}
        </p>
      )}

      {message.text.length > 0 && payload?.kind !== "review" && (
        <div className={cn("min-w-0 text-[13px] leading-relaxed", message.state === "failed" && "text-muted-foreground")}>
          {message.generativeUi ? (
            <GenerativeMessage
              content={message.text}
              streaming={working}
              onProposeEdit={(request) => handlers.proposeFromGenerativeUi(message.id, request)}
            />
          ) : (
            <MarkdownRenderer source={message.text} />
          )}
        </div>
      )}

      {message.state === "failed" && message.error && (
        <div role="alert" className="rounded-md border border-rose-300/70 bg-rose-50 px-3 py-2 text-[12px] text-rose-900 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-200">
          <p className="whitespace-pre-wrap break-words">{message.error.message}</p>
        </div>
      )}

      {message.state === "cancelled" && <p className="text-[11px] text-muted-foreground">Stopped. The text above is what arrived before you stopped.</p>}

      {payload?.kind === "proposal" && (
        <ProposalView
          messageId={message.id}
          proposal={payload.proposal}
          onApply={handlers.applyProposal}
          onDiscard={handlers.discardProposal}
        />
      )}
      {payload?.kind === "archify" && (
        <ArchifyView
          messageId={message.id}
          proposal={payload.proposal}
          hasActiveDocument={handlers.hasActiveDocument}
          onSave={handlers.saveArchify}
          onDiscard={handlers.discardArchify}
        />
      )}
      {payload?.kind === "review" && <ReviewView messageId={message.id} review={payload} onExplore={handlers.exploreCandidate} />}
      {payload === null && message.state === "done" && message.text.length === 0 && (
        <p className="flex items-center gap-1.5 text-[12px] text-muted-foreground">
          <User className="h-3 w-3" aria-hidden="true" />
          No reply came back.
        </p>
      )}
    </article>
  );
}
