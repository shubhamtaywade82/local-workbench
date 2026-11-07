// Shows the first queued dialog. Mounted once in the shell. Closing a dialog
// by any means (Escape, outside click, Cancel) resolves its promise as "no".

"use client";

import { useState } from "react";

import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

import { useDialogStore, type PendingDialog, type PromptOptions } from "./dialog-store";

export function DialogHost() {
  const current = useDialogStore((s) => s.queue[0] ?? null);
  if (!current) return null;
  return current.kind === "confirm" ? (
    <ConfirmDialog key={current.id} dialog={current} />
  ) : (
    <PromptDialog key={current.id} dialog={current} />
  );
}

function ConfirmDialog({ dialog }: { dialog: Extract<PendingDialog, { kind: "confirm" }> }) {
  const dequeue = useDialogStore((s) => s.dequeue);
  const finish = (value: boolean) => {
    dialog.resolve(value);
    dequeue(dialog.id);
  };
  return (
    <AlertDialog open onOpenChange={(open) => !open && finish(false)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{dialog.options.title}</AlertDialogTitle>
          <AlertDialogDescription className="whitespace-pre-line">{dialog.options.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => finish(false)}>{dialog.options.cancelLabel ?? "Cancel"}</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => finish(true)}
            className={dialog.options.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
          >
            {dialog.options.confirmLabel ?? "Continue"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

function PromptDialog({ dialog }: { dialog: Extract<PendingDialog, { kind: "prompt" }> }) {
  const dequeue = useDialogStore((s) => s.dequeue);
  const options: PromptOptions = dialog.options;
  const [value, setValue] = useState(options.initialValue ?? "");
  // Derived during render, so the message always matches the current value.
  const error = options.validate ? options.validate(value) : null;

  const finish = (result: string | null) => {
    dialog.resolve(result);
    dequeue(dialog.id);
  };
  const submit = () => {
    if (error) return;
    finish(value);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && finish(null)}>
      <DialogContent
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !options.multiline) {
            event.preventDefault();
            submit();
          }
        }}
      >
        <DialogHeader>
          <DialogTitle>{options.title}</DialogTitle>
          {options.description && <DialogDescription>{options.description}</DialogDescription>}
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="dialog-prompt-input">{options.label}</Label>
          {options.multiline ? (
            <Textarea
              id="dialog-prompt-input"
              autoFocus
              value={value}
              placeholder={options.placeholder}
              onChange={(event) => setValue(event.target.value)}
              className="min-h-24 text-sm"
            />
          ) : (
            <Input
              id="dialog-prompt-input"
              autoFocus
              value={value}
              placeholder={options.placeholder}
              onChange={(event) => setValue(event.target.value)}
            />
          )}
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => finish(null)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={Boolean(error)}>
            {options.confirmLabel ?? "OK"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
