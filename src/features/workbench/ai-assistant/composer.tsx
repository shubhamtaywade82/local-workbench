// The message box. Enter sends and Shift+Enter starts a new line. While a task
// runs, the same control becomes Stop.

"use client";

import { useRef, useState } from "react";
import { Send, Square } from "lucide-react";

import { Button } from "@/components/ui/button";

interface ComposerProps {
  readonly busy: boolean;
  readonly placeholder: string;
  readonly onSend: (text: string) => void;
  readonly onStop: () => void;
  /** A suggestion to put in the box. A new object fills it again, even with the same text. */
  readonly seed?: { readonly text: string } | null;
}

export function Composer({ busy, placeholder, onSend, onStop, seed }: ComposerProps) {
  const [value, setValue] = useState("");
  const [lastSeed, setLastSeed] = useState<{ readonly text: string } | null | undefined>(undefined);
  const ref = useRef<HTMLTextAreaElement>(null);

  // A new seed replaces the draft once, without an effect: compare during render.
  if (seed !== undefined && seed !== lastSeed) {
    setLastSeed(seed);
    if (seed) setValue(seed.text);
  }

  const send = () => {
    const text = value.trim();
    if (!text || busy) return;
    setValue("");
    onSend(text);
  };

  return (
    <form
      className="border-t bg-card p-2"
      onSubmit={(event) => {
        event.preventDefault();
        if (busy) onStop();
        else send();
      }}
    >
      <div className="flex items-end gap-2 rounded-lg border bg-background p-1.5 focus-within:ring-2 focus-within:ring-ring/40">
        <label htmlFor="assistant-input" className="sr-only">
          Message the assistant
        </label>
        <textarea
          id="assistant-input"
          ref={ref}
          rows={1}
          value={value}
          placeholder={placeholder}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              send();
            }
          }}
          className="max-h-40 min-h-[36px] flex-1 resize-none bg-transparent px-2 py-1.5 text-[13px] leading-5 outline-none placeholder:text-muted-foreground"
        />
        {busy ? (
          <Button type="submit" size="sm" variant="secondary" className="h-8 gap-1.5" aria-label="Stop">
            <Square className="h-3 w-3 fill-current" aria-hidden="true" />
            Stop
          </Button>
        ) : (
          <Button type="submit" size="sm" className="h-8 gap-1.5" disabled={value.trim().length === 0} aria-label="Send">
            <Send className="h-3.5 w-3.5" aria-hidden="true" />
            Send
          </Button>
        )}
      </div>
      <p className="mt-1 px-1 text-[10px] text-muted-foreground">Enter to send · Shift+Enter for a new line · Ctrl+Z undoes an applied change</p>
    </form>
  );
}
