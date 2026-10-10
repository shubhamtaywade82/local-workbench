"use client";

import { useCallback, useMemo, useState } from "react";
import { Renderer, type ActionEvent, type ParseResult } from "@openuidev/react-lang";
import { splitMessageSegments } from "@/lib/ai/generative-ui/segments";
import { PROPOSE_EDIT_ACTION } from "@/lib/ai/generative-ui/components";
import { workbenchLibrary } from "./library";

export interface ProposedEditRequest {
  label: string;
  description?: string;
  newText: string;
}

/** Validates an ActionEvent from generated UI. Only `workbench.propose_edit` is honoured. */
export function toProposedEditRequest(event: ActionEvent): ProposedEditRequest | null {
  if (event.type !== PROPOSE_EDIT_ACTION) return null;
  const { label, description, newText } = event.params ?? {};
  if (typeof newText !== "string" || newText.length === 0) return null;
  return {
    label: typeof label === "string" && label ? label : "Proposed edit",
    ...(typeof description === "string" && description ? { description } : {}),
    newText,
  };
}

function UiBlock({
  code,
  streaming,
  onProposeEdit,
}: {
  code: string;
  streaming: boolean;
  onProposeEdit: (req: ProposedEditRequest) => void;
}) {
  const [rendered, setRendered] = useState<boolean | null>(null);
  const onParseResult = useCallback((result: ParseResult | null) => {
    setRendered(Boolean(result?.root));
  }, []);
  const onAction = useCallback(
    (event: ActionEvent) => {
      const req = toProposedEditRequest(event);
      if (req) onProposeEdit(req);
      // Every other action type (OpenUrl, ContinueConversation, ...) is
      // ignored: generated UI must not navigate or send messages on its own.
    },
    [onProposeEdit]
  );

  // A finished block the parser couldn't turn into any UI: show the source
  // instead of an empty box so nothing the model said is silently lost.
  if (!streaming && rendered === false) {
    return (
      <div className="rounded border border-dashed p-1.5">
        <div className="mb-1 text-[9px] text-muted-foreground">Could not render generated UI; showing source.</div>
        <pre className="max-h-40 overflow-auto text-[10px] leading-tight"><code>{code}</code></pre>
      </div>
    );
  }

  return (
    <Renderer
      response={code}
      library={workbenchLibrary}
      isStreaming={streaming}
      onAction={onAction}
      onParseResult={onParseResult}
      publishObservability={false}
    />
  );
}

export function GenerativeMessage({
  content,
  streaming,
  onProposeEdit,
}: {
  content: string;
  streaming: boolean;
  onProposeEdit: (req: ProposedEditRequest) => void;
}) {
  const segments = useMemo(() => splitMessageSegments(content, { streaming }), [content, streaming]);
  return (
    <div className="flex flex-col gap-2">
      {segments.map((segment, i) =>
        segment.kind === "text" ? (
          <div key={i} className="whitespace-pre-wrap break-words">
            {segment.text}
          </div>
        ) : (
          <UiBlock
            key={i}
            code={segment.code}
            streaming={streaming && !segment.complete}
            onProposeEdit={onProposeEdit}
          />
        )
      )}
    </div>
  );
}
