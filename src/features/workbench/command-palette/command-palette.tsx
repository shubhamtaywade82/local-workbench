// Command palette. Cmd/Ctrl+P (or Shift+P) to open. Supports fuzzy file name
// search and a small set of built-in commands (toggle panels, save, etc.).

"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { useWorkbench } from "@/features/workbench/store";
import {
  saveAllSessions,
  saveSessionToWorkspace,
} from "@/platform/filesystem/use-workspace-controller";
import {
  FileText,
  Save,
  PanelLeft,
  Eye,
  Bot,
  Stethoscope,
  RefreshCw,
  Sun,
  Moon,
  FolderOpen,
  Plus,
} from "lucide-react";
import { documentRegistry } from "@/documents/core/registry";
import type { WorkspaceFileEntry } from "@/documents/core/types";

interface FlatFileEntry {
  path: string;
  name: string;
  isDirectory: boolean;
}

export function CommandPalette() {
  const open = useWorkbench((s) => s.commandPaletteOpen);
  const setOpen = useWorkbench((s) => s.setCommandPaletteOpen);
  const tree = useWorkbench((s) => s.tree);
  const workspace = useWorkbench((s) => s.workspace);
  const openTab = useWorkbench((s) => s.openTab);
  const setExplorerVisible = useWorkbench((s) => s.setExplorerVisible);
  const setPreviewVisible = useWorkbench((s) => s.setPreviewVisible);
  const setAiVisible = useWorkbench((s) => s.setAiVisible);
  const setDiagnosticsVisible = useWorkbench((s) => s.setDiagnosticsVisible);
  const setTheme = useWorkbench((s) => s.setTheme);
  const theme = useWorkbench((s) => s.theme);

  // Flatten the tree lazily — when the palette opens, walk all loaded
  // directories (and dynamically load any collapsed ones).
  const [flatFiles, setFlatFiles] = useState<FlatFileEntry[]>([]);
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const collected: FlatFileEntry[] = [];
      async function walk(entries: WorkspaceFileEntry[]) {
        for (const entry of entries) {
          if (cancelled) return;
          if (entry.isDirectory) {
            collected.push({ path: entry.path, name: entry.name, isDirectory: true });
            if (entry.children && entry.children.length > 0) {
              await walk(entry.children);
            }
          } else {
            collected.push({ path: entry.path, name: entry.name, isDirectory: false });
          }
        }
      }
      await walk(tree);
      if (!cancelled) setFlatFiles(collected);
    })();
    return () => {
      cancelled = true;
    };
  }, [open, tree]);

  const files = useMemo(
    () => flatFiles.filter((f) => !f.isDirectory),
    [flatFiles]
  );

  async function openFile(path: string) {
    // Read file content via the controller and open a tab.
    const { useWorkspaceController, openFileFromWorkspace } = await import(
      "@/platform/filesystem/use-workspace-controller"
    );
    // We need the controller's getFs; emulate via a singleton access.
    const fs = (window as unknown as { __workbenchController?: { getFs: () => unknown } }).__workbenchController?.getFs?.() as
      | { readFile: (p: string) => Promise<string> }
      | null;
    if (!fs) return;
    await openFileFromWorkspace(fs as never, path).catch(async () => {
      // Fallback: manually read + open
      const content = await fs.readFile(path);
      const adapter = documentRegistry.resolve(path);
      openTab(
        {
          path,
          name: path.split("/").pop() ?? path,
          languageId: adapter.languageId,
          adapterId: adapter.id,
        },
        content
      );
    });
    setOpen(false);
  }

  async function runSaveAll() {
    const fs = (window as unknown as { __workbenchController?: { getFs: () => unknown } }).__workbenchController?.getFs?.() as
      | { writeFile: (p: string, c: string) => Promise<void> }
      | null;
    if (!fs) return;
    await saveAllSessions(fs as never).catch((err: unknown) => window.alert(`Could not save: ${(err as Error).message}`));
    setOpen(false);
  }

  async function runSaveActive() {
    const fs = (window as unknown as { __workbenchController?: { getFs: () => unknown } }).__workbenchController?.getFs?.() as
      | { writeFile: (p: string, c: string) => Promise<void> }
      | null;
    const active = useWorkbench.getState().activeTab;
    if (!fs || !active) return;
    await saveSessionToWorkspace(fs as never, active).catch((err: unknown) => window.alert(`Could not save: ${(err as Error).message}`));
    setOpen(false);
  }

  function closeAndRun(fn: () => void) {
    setOpen(false);
    fn();
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Type a command or file name…" />
      <CommandList>
        <CommandEmpty>No matches.</CommandEmpty>
        <CommandGroup heading="Files">
          {files.slice(0, 30).map((f) => (
            <CommandItem key={f.path} value={f.path} onSelect={() => openFile(f.path)}>
              <FileText className="mr-2 h-3.5 w-3.5" />
              <span>{f.name}</span>
              <span className="ml-2 text-xs text-muted-foreground">{f.path}</span>
            </CommandItem>
          ))}
        </CommandGroup>
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => closeAndRun(() => runSaveActive())}>
            <Save className="mr-2 h-3.5 w-3.5" /> Save active file
            <span className="ml-auto text-xs text-muted-foreground">⌘S</span>
          </CommandItem>
          <CommandItem onSelect={() => closeAndRun(() => runSaveAll())}>
            <Save className="mr-2 h-3.5 w-3.5" /> Save all
          </CommandItem>
          <CommandItem onSelect={() => closeAndRun(() => setExplorerVisible(!useWorkbench.getState().explorerVisible))}>
            <PanelLeft className="mr-2 h-3.5 w-3.5" /> Toggle explorer
            <span className="ml-auto text-xs text-muted-foreground">⌘B</span>
          </CommandItem>
          <CommandItem onSelect={() => closeAndRun(() => setPreviewVisible(!useWorkbench.getState().previewVisible))}>
            <Eye className="mr-2 h-3.5 w-3.5" /> Toggle preview
          </CommandItem>
          <CommandItem onSelect={() => closeAndRun(() => setAiVisible(!useWorkbench.getState().aiVisible))}>
            <Bot className="mr-2 h-3.5 w-3.5" /> Toggle AI assistant
            <span className="ml-auto text-xs text-muted-foreground">⌘⇧A</span>
          </CommandItem>
          <CommandItem onSelect={() => closeAndRun(() => setDiagnosticsVisible(!useWorkbench.getState().diagnosticsVisible))}>
            <Stethoscope className="mr-2 h-3.5 w-3.5" /> Toggle diagnostics
            <span className="ml-auto text-xs text-muted-foreground">⌘J</span>
          </CommandItem>
          <CommandItem onSelect={() => closeAndRun(() => setTheme(theme === "dark" ? "light" : "dark"))}>
            {theme === "dark" ? <Sun className="mr-2 h-3.5 w-3.5" /> : <Moon className="mr-2 h-3.5 w-3.5" />}
            Switch to {theme === "dark" ? "light" : "dark"} theme
          </CommandItem>
        </CommandGroup>
        <CommandGroup heading="Workspace">
          <CommandItem onSelect={async () => {
            setOpen(false);
            const { useWorkspaceController } = await import("@/platform/filesystem/use-workspace-controller");
            // Find the controller via the global hook is awkward; instead,
            // dispatch a custom event the shell listens for.
            window.dispatchEvent(new CustomEvent("workbench:open-local-folder"));
          }}>
            <FolderOpen className="mr-2 h-3.5 w-3.5" /> Open local folder…
          </CommandItem>
          <CommandItem onSelect={async () => {
            setOpen(false);
            window.dispatchEvent(new CustomEvent("workbench:open-sample-workspace"));
          }}>
            <FileText className="mr-2 h-3.5 w-3.5" /> Open sample workspace
          </CommandItem>
          <CommandItem onSelect={async () => {
            setOpen(false);
            window.dispatchEvent(new CustomEvent("workbench:new-file"));
          }}>
            <Plus className="mr-2 h-3.5 w-3.5" /> New file…
          </CommandItem>
          <CommandItem onSelect={async () => {
            setOpen(false);
            window.dispatchEvent(new CustomEvent("workbench:refresh-tree"));
          }}>
            <RefreshCw className="mr-2 h-3.5 w-3.5" /> Refresh explorer
          </CommandItem>
        </CommandGroup>
        {!workspace && (
          <CommandGroup heading="Status">
            <CommandItem disabled>
              No workspace open
            </CommandItem>
          </CommandGroup>
        )}
      </CommandList>
    </CommandDialog>
  );
}
