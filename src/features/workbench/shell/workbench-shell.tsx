// Top-level shell. Chooses the layout for the viewport (desktop, tablet or
// phone), owns the boot sequence and the global shortcuts and commands, and
// mounts the header, status bar and dialog host.
//
// Layouts:
//  - desktop: every pane is a resizable column (files, editor, preview, assistant).
//  - tablet:  files and preview are columns; the assistant and problems are sheets.
//  - phone:   one pane at a time (editor or preview); files, assistant and problems are sheets.

"use client";

import { useCallback, useEffect, useState } from "react";

import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "@/components/ui/resizable";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { FileExplorer } from "@/features/workbench/file-explorer/file-explorer";
import { EditorTabs } from "@/features/workbench/tabs/editor-tabs";
import { EditorPane } from "@/features/workbench/editor/editor-pane";
import { LiveEditor } from "@/features/workbench/live/live-editor";
import { PreviewPane } from "@/features/workbench/preview/preview-pane";
import { DiagnosticsPanel } from "@/features/workbench/diagnostics/diagnostics-panel";
import { AiAssistant } from "@/features/workbench/ai-assistant/ai-assistant";
import { CommandPalette } from "@/features/workbench/command-palette/command-palette";
import { StatusBar } from "@/features/workbench/status-bar/status-bar";
import { WorkbenchHeader } from "@/features/workbench/shell/workbench-header";
import { WelcomeOverlay } from "@/features/workbench/shell/welcome-overlay";
import { DialogHost } from "@/features/workbench/dialogs/dialog-host";
import { notify } from "@/features/workbench/notify";
import { useWorkspaceController, saveSessionToWorkspace } from "@/platform/filesystem/use-workspace-controller";
import { ensureAdaptersRegistered } from "@/documents/bootstrap";
import { useWorkbench } from "@/features/workbench/store";
import { useAssistantState } from "@/features/workbench/ai/wiring";
import { loadSettings, saveSettings, listRecentWorkspaces } from "@/platform/persistence/persistence";
import { refreshTreeFor } from "@/features/workbench/shell/refresh-tree";
import { promptText } from "@/features/workbench/dialogs/dialog-store";
import { useBreakpoint, TABLET_QUERY, type Breakpoint } from "@/lib/hooks/use-breakpoint";
import { openFileFromWorkspace } from "@/platform/filesystem/use-workspace-controller";
import { cn } from "@/lib/utils";

import { ThemeProvider } from "./theme-provider";

export function WorkbenchShell() {
  const explorerVisible = useWorkbench((s) => s.explorerVisible);
  const previewVisible = useWorkbench((s) => s.previewVisible);
  const editorViewMode = useWorkbench((s) => s.editorViewMode);
  const setEditorViewMode = useWorkbench((s) => s.setEditorViewMode);
  const aiVisible = useWorkbench((s) => s.aiVisible);
  const diagnosticsVisible = useWorkbench((s) => s.diagnosticsVisible);
  const mobileView = useWorkbench((s) => s.mobileView);
  const setWorkspace = useWorkbench((s) => s.setWorkspace);
  const setTheme = useWorkbench((s) => s.setTheme);
  const setExplorerVisible = useWorkbench((s) => s.setExplorerVisible);
  const setPreviewVisible = useWorkbench((s) => s.setPreviewVisible);
  const setAiVisible = useWorkbench((s) => s.setAiVisible);
  const setDiagnosticsVisible = useWorkbench((s) => s.setDiagnosticsVisible);
  const setMobileView = useWorkbench((s) => s.setMobileView);
  const workspace = useWorkbench((s) => s.workspace);
  const theme = useWorkbench((s) => s.theme);
  const assistantBusy = useAssistantState((s) => s.activeRun !== null);

  const breakpoint = useBreakpoint();
  const controller = useWorkspaceController();
  const [showWelcome, setShowWelcome] = useState(false);
  const [booted, setBooted] = useState(false);
  const activeTab = useWorkbench((s) => s.activeTab);

  // On a phone, opening a file closes the files sheet and shows the editor.
  useEffect(() => {
    if (breakpoint !== "phone" || !activeTab) return;
    useWorkbench.getState().setExplorerVisible(false);
    useWorkbench.getState().setMobileView("editor");
  }, [activeTab, breakpoint]);

  const saveActive = useCallback(() => {
    const fs = controller.getFs();
    const active = useWorkbench.getState().activeTab;
    if (!fs || !active) return;
    saveSessionToWorkspace(fs, active).catch((err: unknown) => notify(`Could not save: ${(err as Error).message}`, "error"));
  }, [controller]);

  // Boot: register adapters, load settings, check if first visit. A first visit
  // on a narrow screen starts with the side panels closed, so the editor has room.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureAdaptersRegistered();
      // A failed read must not stop boot: the layout only mounts once `booted` is set.
      const settings = await loadSettings().catch(() => null);
      if (cancelled) return;
      if (settings) {
        setTheme(settings.theme);
        setExplorerVisible(settings.explorerVisible);
        setPreviewVisible(settings.previewVisible);
        setAiVisible(settings.aiVisible);
        setDiagnosticsVisible(settings.diagnosticsVisible);
        setEditorViewMode(settings.editorViewMode ?? "code");
      } else if (!window.matchMedia(TABLET_QUERY).matches) {
        setAiVisible(false);
        setDiagnosticsVisible(false);
        setExplorerVisible(false);
      } else if (!window.matchMedia("(min-width: 1280px)").matches) {
        setAiVisible(false);
        setDiagnosticsVisible(false);
      }
      // Check if first visit: no settings AND no recent workspaces
      const recent = await listRecentWorkspaces().catch(() => []);
      const isFirstVisit = !settings && recent.length === 0;
      if (!cancelled) {
        setShowWelcome(isFirstVisit);
        setBooted(true);
        // Only auto-open sample for returning users
        if (!isFirstVisit) {
          await controller.openSampleWorkspace();
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Persist settings on change.
  useEffect(() => {
    if (!booted) return;
    saveSettings({
      theme,
      explorerVisible,
      previewVisible,
      editorViewMode,
      aiVisible,
      diagnosticsVisible,
    });
  }, [theme, explorerVisible, previewVisible, editorViewMode, aiVisible, diagnosticsVisible, booted]);

  // Expose the controller via window so the command palette (which can't
  // re-instantiate the hook) can access the active fs.
  useEffect(() => {
    (window as unknown as { __workbenchController?: typeof controller }).__workbenchController = controller;
    return () => {
      delete (window as unknown as { __workbenchController?: typeof controller }).__workbenchController;
    };
  }, [controller]);

  // Command events from the palette and the explorer. Each one is a small, named action.
  useEffect(() => {
    const openLocal = () => controller.openLocalDirectory();
    const openSample = () => controller.openSampleWorkspace();
    const refreshTree = async () => {
      const fs = controller.getFs();
      if (fs) await refreshTreeFor(fs);
    };
    const newFile = async () => {
      const name = await promptText({
        title: "New file",
        description: "The path is relative to the workspace root.",
        label: "File path",
        initialValue: "untitled.md",
        confirmLabel: "Create file",
        validate: (value) => (value.trim().length === 0 ? "Enter a file name." : null),
      });
      if (!name) return;
      const fs = controller.getFs();
      if (!fs) return;
      try {
        await fs.createFile(name, "");
        await refreshTreeFor(fs);
        await openFileFromWorkspace(fs, name);
      } catch (err) {
        notify(`Could not create the file: ${(err as Error).message}`, "error");
      }
    };
    window.addEventListener("workbench:open-local-folder", openLocal);
    window.addEventListener("workbench:open-sample-workspace", openSample);
    window.addEventListener("workbench:refresh-tree", refreshTree);
    window.addEventListener("workbench:new-file", newFile);
    return () => {
      window.removeEventListener("workbench:open-local-folder", openLocal);
      window.removeEventListener("workbench:open-sample-workspace", openSample);
      window.removeEventListener("workbench:refresh-tree", refreshTree);
      window.removeEventListener("workbench:new-file", newFile);
    };
  }, [controller]);

  // Keyboard shortcuts: Cmd/Ctrl+P command palette, Cmd/Ctrl+B files, Cmd/Ctrl+J
  // problems, Cmd/Ctrl+Shift+A assistant, Cmd/Ctrl+S save the active document.
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;
      const key = e.key.toLowerCase();
      if (key === "p") {
        e.preventDefault();
        useWorkbench.getState().setCommandPaletteOpen(true);
      } else if (key === "b" && !e.shiftKey) {
        e.preventDefault();
        useWorkbench.getState().setExplorerVisible(!useWorkbench.getState().explorerVisible);
      } else if (key === "j" && !e.shiftKey) {
        e.preventDefault();
        useWorkbench.getState().setDiagnosticsVisible(!useWorkbench.getState().diagnosticsVisible);
      } else if (key === "a" && e.shiftKey) {
        e.preventDefault();
        useWorkbench.getState().setAiVisible(!useWorkbench.getState().aiVisible);
      } else if (key === "s" && !e.shiftKey) {
        e.preventDefault();
        saveActive();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [saveActive]);

  // The welcome overlay shows only until a workspace is open.
  const showOverlay = !workspace && showWelcome;

  const editor = <EditorArea />;

  return (
    <ThemeProvider>
      <div className="flex h-dvh w-full flex-col overflow-hidden bg-background text-foreground">
        <WorkbenchHeader breakpoint={breakpoint} onSave={saveActive} />

        <main className="relative flex min-h-0 flex-1 overflow-hidden">
          {breakpoint === "desktop" && (
            <DesktopLayout explorerVisible={explorerVisible} previewVisible={previewVisible} aiVisible={aiVisible} editor={editor} />
          )}
          {breakpoint === "tablet" && <TabletLayout explorerVisible={explorerVisible} previewVisible={previewVisible} editor={editor} />}
          {breakpoint === "phone" && <PhoneLayout mobileView={mobileView} setMobileView={setMobileView} editor={editor} />}

          {breakpoint !== "desktop" && (
            <Sheet open={aiVisible} onOpenChange={setAiVisible}>
              <SheetContent side="right" className="flex w-full flex-col p-0 sm:max-w-[420px]">
                <SheetTitle className="sr-only">Assistant</SheetTitle>
                <SheetDescription className="sr-only">Ask about the open file and review proposed changes.</SheetDescription>
                <AiAssistant onClose={() => setAiVisible(false)} />
              </SheetContent>
            </Sheet>
          )}
          {breakpoint === "phone" && (
            <Sheet open={explorerVisible} onOpenChange={setExplorerVisible}>
              <SheetContent side="left" className="flex w-[min(340px,88vw)] flex-col p-0">
                <SheetTitle className="sr-only">Files</SheetTitle>
                <SheetDescription className="sr-only">Browse and open files in the workspace.</SheetDescription>
                <FileExplorer />
              </SheetContent>
            </Sheet>
          )}
          {breakpoint === "phone" && (
            <Sheet open={diagnosticsVisible} onOpenChange={setDiagnosticsVisible}>
              <SheetContent side="bottom" className="flex h-[60dvh] flex-col p-0">
                <SheetTitle className="sr-only">Problems</SheetTitle>
                <SheetDescription className="sr-only">Errors and warnings in the open files.</SheetDescription>
                <DiagnosticsPanel />
              </SheetContent>
            </Sheet>
          )}

          {showOverlay && (
            <WelcomeOverlay onOpenSample={controller.openSampleWorkspace} onOpenLocal={controller.openLocalDirectory} />
          )}
        </main>

        {diagnosticsVisible && breakpoint !== "phone" && (
          <div className={cn("shrink-0 border-t", breakpoint === "desktop" ? "h-[200px]" : "h-[160px]")}>
            <DiagnosticsPanel />
          </div>
        )}

        <CommandPalette />
        <StatusBar breakpoint={breakpoint} />
        <DialogHost />
        {assistantBusy && <span className="sr-only" role="status">The assistant is working.</span>}
      </div>
    </ThemeProvider>
  );
}

function DesktopLayout({
  explorerVisible,
  previewVisible,
  aiVisible,
  editor,
}: {
  explorerVisible: boolean;
  previewVisible: boolean;
  aiVisible: boolean;
  editor: React.ReactNode;
}) {
  const editorViewMode = useWorkbench((s) => s.editorViewMode);
  const showPreview = previewVisible && editorViewMode !== "live";
  return (
    <ResizablePanelGroup direction="horizontal" className="h-full w-full" autoSaveId="wb-desktop">
      {explorerVisible && (
        <>
          <ResizablePanel defaultSize={18} minSize={12} maxSize={32} order={1}>
            <FileExplorer />
          </ResizablePanel>
          <ResizableHandle />
        </>
      )}
      <ResizablePanel defaultSize={explorerVisible ? 46 : 58} minSize={24} order={2}>
        {editor}
      </ResizablePanel>
      {showPreview && (
        <>
          <ResizableHandle />
          <ResizablePanel defaultSize={aiVisible ? 20 : 26} minSize={14} order={3}>
            <PreviewPane />
          </ResizablePanel>
        </>
      )}
      {aiVisible && (
        <>
          <ResizableHandle />
          <ResizablePanel defaultSize={22} minSize={18} maxSize={36} order={4}>
            <AiAssistant />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}

function TabletLayout({ explorerVisible, previewVisible, editor }: { explorerVisible: boolean; previewVisible: boolean; editor: React.ReactNode }) {
  const editorViewMode = useWorkbench((s) => s.editorViewMode);
  const showPreview = previewVisible && editorViewMode !== "live";
  return (
    <ResizablePanelGroup direction="horizontal" className="h-full w-full" autoSaveId="wb-tablet">
      {explorerVisible && (
        <>
          <ResizablePanel defaultSize={24} minSize={16} maxSize={36} order={1}>
            <FileExplorer />
          </ResizablePanel>
          <ResizableHandle />
        </>
      )}
      <ResizablePanel defaultSize={showPreview ? 50 : 76} minSize={30} order={2}>
        {editor}
      </ResizablePanel>
      {showPreview && (
        <>
          <ResizableHandle />
          <ResizablePanel defaultSize={26} minSize={20} order={3}>
            <PreviewPane />
          </ResizablePanel>
        </>
      )}
    </ResizablePanelGroup>
  );
}

/** Both panes stay mounted, so switching never reloads the editor or loses its undo history. */
function PhoneLayout({
  mobileView,
  setMobileView,
  editor,
}: {
  mobileView: "editor" | "preview";
  setMobileView: (view: "editor" | "preview") => void;
  editor: React.ReactNode;
}) {
  return (
    <div className="flex min-h-0 w-full flex-1 flex-col">
      <div role="tablist" aria-label="Main view" className="flex shrink-0 gap-1 border-b bg-card p-1.5">
        {(["editor", "preview"] as const).map((view) => (
          <button
            key={view}
            role="tab"
            aria-selected={mobileView === view}
            onClick={() => setMobileView(view)}
            className={cn(
              "h-8 flex-1 rounded-md text-xs font-medium capitalize transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              mobileView === view ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
            )}
          >
            {view}
          </button>
        ))}
      </div>
      <div className="relative min-h-0 flex-1">
        <div className={cn("absolute inset-0", mobileView !== "editor" && "invisible")}>{editor}</div>
        <div className={cn("absolute inset-0", mobileView !== "preview" && "invisible")}>
          <PreviewPane />
        </div>
      </div>
    </div>
  );
}

function EditorArea() {
  const editorViewMode = useWorkbench((s) => s.editorViewMode);
  return (
    <div className="flex h-full min-w-0 flex-col">
      <EditorTabs />
      <div className="min-h-0 flex-1">
        {/* Monaco stays mounted while the live view is shown, so its undo history survives a switch. */}
        <div className={cn("h-full", editorViewMode === "live" && "hidden")}>
          <EditorPane />
        </div>
        {editorViewMode === "live" && <LiveEditor />}
      </div>
    </div>
  );
}

export type { Breakpoint };
