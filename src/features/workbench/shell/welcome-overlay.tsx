// Welcome overlay shown over the editor area before any workspace is opened.
// Auto-dismisses once the sample workspace has been opened by the bootstrap.

"use client";

import { FolderOpen, FileText, Zap, Eye, Stethoscope, Bot } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isFileSystemAccessSupported } from "@/platform/filesystem/workspace-fs";

interface WelcomeOverlayProps {
  onOpenSample: () => void;
  onOpenLocal: () => void;
}

export function WelcomeOverlay({ onOpenSample, onOpenLocal }: WelcomeOverlayProps) {
  // The bootstrap auto-opens the sample workspace, so this overlay is really
  // a fallback if that fails. Still — render a useful landing card.
  const fsaSupported = isFileSystemAccessSupported();

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-background/80 backdrop-blur-sm">
      <div className="mx-4 w-full max-w-2xl rounded-xl border bg-card p-8 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <FileText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold">Local Workbench</h1>
            <p className="text-sm text-muted-foreground">
              A browser-based, workspace-aware document editor with a pluggable
              preview engine and an AI assistant.
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <Feature icon={<Eye className="h-4 w-4" />} label="Live preview" />
          <Feature icon={<Stethoscope className="h-4 w-4" />} label="Diagnostics" />
          <Feature icon={<Bot className="h-4 w-4" />} label="AI assistant" />
          <Feature icon={<Zap className="h-4 w-4" />} label="Format-aware" />
        </div>

        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Button onClick={onOpenSample} variant="default" className="gap-2">
            <FileText className="h-4 w-4" />
            Try the sample workspace
          </Button>
          <Button
            onClick={onOpenLocal}
            variant="secondary"
            className="gap-2"
            disabled={!fsaSupported}
            title={
              fsaSupported
                ? "Pick a local folder"
                : "Your browser does not support the File System Access API — use Chrome or Edge desktop"
            }
          >
            <FolderOpen className="h-4 w-4" />
            Open local folder
            {!fsaSupported && <span className="ml-1 text-xs text-muted-foreground">(unavailable)</span>}
          </Button>
        </div>

        <p className="mt-4 text-xs text-muted-foreground">
          Tip: press <kbd className="rounded border bg-muted px-1">⌘/Ctrl + P</kbd> for
          the command palette, <kbd className="rounded border bg-muted px-1">⌘/Ctrl + B</kbd> to
          toggle the explorer.
        </p>
      </div>
    </div>
  );
}

function Feature({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex flex-col items-center gap-1 rounded-lg border bg-muted/40 p-3 text-center">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-xs font-medium">{label}</span>
    </div>
  );
}
