// Top-level shell for the workbench. Owns the resizable pane layout and the
// sticky footer (status bar). Renders panels conditionally based on the
// workbench store so users can toggle explorer / preview / ai / diagnostics.

"use client";

import { useEffect } from "react";
import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/components/ui/resizable";
import { FileExplorer } from "@/features/workbench/file-explorer/file-explorer";
import { EditorTabs } from "@/features/workbench/tabs/editor-tabs";
import { EditorPane } from "@/features/workbench/editor/editor-pane";
import { PreviewPane } from "@/features/workbench/preview/preview-pane";
import { DiagnosticsPanel } from "@/features/workbench/diagnostics/diagnostics-panel";
import { AiAssistant } from "@/features/workbench/ai-assistant/ai-assistant";
import { CommandPalette } from "@/features/workbench/command-palette/command-palette";
import { StatusBar } from "@/features/workbench/status-bar/status-bar";
import { WelcomeOverlay } from "@/features/workbench/shell/welcome-overlay";
import { useWorkspaceController } from "@/platform/filesystem/use-workspace-controller";
import { ensureAdaptersRegistered } from "@/documents/bootstrap";
import { useWorkbench } from "@/features/workbench/store";
import { loadSettings, saveSettings } from "@/platform/persistence/persistence";
import { ThemeProvider } from "./theme-provider";
import { cn } from "@/lib/utils";

export function WorkbenchShell() {
  const explorerVisible = useWorkbench((s) => s.explorerVisible);
  const previewVisible = useWorkbench((s) => s.previewVisible);
  const aiVisible = useWorkbench((s) => s.aiVisible);
  const diagnosticsVisible = useWorkbench((s) => s.diagnosticsVisible);
  const workspace = useWorkbench((s) => s.workspace);
  const setWorkspace = useWorkbench((s) => s.setWorkspace);
  const setTheme = useWorkbench((s) => s.setTheme);
  const setExplorerVisible = useWorkbench((s) => s.setExplorerVisible);
  const setPreviewVisible = useWorkbench((s) => s.setPreviewVisible);
  const setAiVisible = useWorkbench((s) => s.setAiVisible);
  const setDiagnosticsVisible = useWorkbench((s) => s.setDiagnosticsVisible);

  const controller = useWorkspaceController();

  // Boot: register adapters, load settings, auto-open the sample workspace
  // so the editor is never empty on first load.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await ensureAdaptersRegistered();
      const settings = await loadSettings();
      if (cancelled) return;
      if (settings) {
        setTheme(settings.theme);
        setExplorerVisible(settings.explorerVisible);
        setPreviewVisible(settings.previewVisible);
        setAiVisible(settings.aiVisible);
        setDiagnosticsVisible(settings.diagnosticsVisible);
      }
      // Always start with the sample workspace so the editor is never empty.
      await controller.openSampleWorkspace();
    })();
    return () => {
      cancelled = true;
    };
     
  }, []);

  // Persist settings on change.
  const theme = useWorkbench((s) => s.theme);
  useEffect(() => {
    saveSettings({
      theme,
      explorerVisible,
      previewVisible,
      aiVisible,
      diagnosticsVisible,
    });
  }, [theme, explorerVisible, previewVisible, aiVisible, diagnosticsVisible]);

  // Expose the controller via window so the command palette (which can't
  // re-instantiate the hook) can access the active fs.
  useEffect(() => {
    (window as unknown as { __workbenchController?: typeof controller }).__workbenchController =
      controller;
    return () => {
      delete (window as unknown as { __workbenchController?: typeof controller }).__workbenchController;
    };
  }, [controller]);

  // Handle command palette events.
  useEffect(() => {
    const openLocal = () => controller.openLocalDirectory();
    const openSample = () => controller.openSampleWorkspace();
    const refreshTree = async () => {
      const fs = controller.getFs();
      if (!fs) return;
      const root = await fs.listDirectory("");
      useWorkbench.getState().setTree(root);
    };
    const newFile = async () => {
      const name = window.prompt("New file path:", "untitled.md");
      if (!name) return;
      const fs = controller.getFs();
      if (!fs) return;
      try {
        await fs.createFile(name, "");
        await refreshTree();
        // Open the new file in the editor.
        const { openFileFromWorkspace } = await import(
          "@/platform/filesystem/use-workspace-controller"
        );
        await openFileFromWorkspace(fs, name);
      } catch (err) {
        alert(`Error creating file: ${(err as Error).message}`);
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

  // Keyboard shortcuts: Cmd/Ctrl+P command palette, Cmd/Ctrl+B toggle
  // explorer, Cmd/Ctrl+J toggle diagnostics, Cmd/Ctrl+Shift+A toggle AI,
  // Cmd/Ctrl+S save active session.
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
        useWorkbench
          .getState()
          .setExplorerVisible(!useWorkbench.getState().explorerVisible);
      } else if (key === "j" && !e.shiftKey) {
        e.preventDefault();
        useWorkbench
          .getState()
          .setDiagnosticsVisible(
            !useWorkbench.getState().diagnosticsVisible
          );
      } else if (key === "a" && e.shiftKey) {
        e.preventDefault();
        useWorkbench.getState().setAiVisible(!useWorkbench.getState().aiVisible);
      } else if (key === "s" && !e.shiftKey) {
        e.preventDefault();
        const fs = controller.getFs();
        const active = useWorkbench.getState().activeTab;
        if (fs && active) {
          import("@/platform/filesystem/use-workspace-controller").then((m) =>
            m.saveSessionToWorkspace(fs, active)
          );
        }
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [controller]);

  // Detect if we have any open tabs after the workspace is loaded — if not,
  // we keep the welcome overlay until a tab opens. The overlay is shown
  // only when no workspace is set yet.
  const showOverlay = !workspace;

  return (
    <ThemeProvider>
      <div className="flex h-screen w-full flex-col overflow-hidden bg-background text-foreground">
        <main className="relative flex min-h-0 flex-1 overflow-hidden">
          <ResizablePanelGroup
            direction="horizontal"
            className="h-full w-full"
            autoSaveId="wb-main"
          >
            {explorerVisible && (
              <>
                <ResizablePanel
                  defaultSize={18}
                  minSize={10}
                  maxSize={35}
                  className="h-full"
                >
                  <FileExplorer />
                </ResizablePanel>
                <ResizableHandle />
              </>
            )}
            <ResizablePanel defaultSize={52} minSize={20}>
              <EditorArea />
            </ResizablePanel>
            {previewVisible && (
              <>
                <ResizableHandle />
                <ResizablePanel defaultSize={30} minSize={15} maxSize={55}>
                  <PreviewPane />
                </ResizablePanel>
              </>
            )}
          </ResizablePanelGroup>

          {aiVisible && (
            <aside className="hidden h-full w-[360px] shrink-0 border-l bg-card lg:block">
              <AiAssistant />
            </aside>
          )}

          {showOverlay && (
            <WelcomeOverlay
              onOpenSample={controller.openSampleWorkspace}
              onOpenLocal={controller.openLocalDirectory}
            />
          )}
        </main>

        {diagnosticsVisible && (
          <div className="h-[200px] shrink-0 border-t">
            <DiagnosticsPanel />
          </div>
        )}

        <CommandPalette />
        <StatusBar />
      </div>
    </ThemeProvider>
  );
}

function EditorArea() {
  return (
    <div className="flex h-full min-w-0 flex-col">
      <EditorTabs />
      <div className={cn("min-h-0 flex-1")}>
        <EditorPane />
      </div>
    </div>
  );
}
