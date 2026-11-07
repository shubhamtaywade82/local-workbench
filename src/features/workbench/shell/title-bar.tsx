// Desktop-only title bar in the style of VS Code: menus on the left, a command
// center in the middle, layout toggles on the right, and room for the native
// window controls that Electron draws over the page.

"use client";

import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { FileText, Menu, PanelBottom, PanelLeft, PanelRight, Search } from "lucide-react";
import { DESKTOP_MENUS, type DesktopBridge, type DesktopMenu } from "@/lib/desktop/contract";
import { getDesktopBridge } from "@/platform/electron/bridge";
import { useWorkbench } from "@/features/workbench/store";
import { useIsClient } from "@/lib/hooks/use-is-client";
import { cn } from "@/lib/utils";

const NO_DRAG = "[-webkit-app-region:no-drag]";
const HOVER = "transition-colors duration-150 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

export function TitleBar() {
  const mounted = useIsClient();
  const bridge = mounted ? getDesktopBridge() : null;
  const theme = useWorkbench((s) => s.theme);
  const isFocused = useWindowFocus();

  useEffect(() => {
    bridge?.setTitleBarTheme(theme);
  }, [bridge, theme]);

  if (!bridge) return null;
  // macOS keeps its global menu bar and draws the traffic lights on the left.
  const isMac = navigator.userAgent.includes("Mac");

  return (
    <header
      className={cn(
        "relative flex h-[35px] shrink-0 select-none items-center gap-1 border-b bg-sidebar text-xs text-sidebar-foreground [-webkit-app-region:drag]",
        "transition-opacity duration-200",
        isMac ? "pl-[78px] pr-2" : "pl-2 pr-[140px]",
        // Like VS Code, an inactive window's chrome recedes.
        !isFocused && "[&>*]:opacity-60"
      )}
    >
      {!isMac && <MenuRow bridge={bridge} />}
      <CommandCenter shortcut={isMac ? "⌘P" : "Ctrl+P"} />
      <LayoutControls />
    </header>
  );
}

function useWindowFocus(): boolean {
  const [isFocused, setFocused] = useState(true);
  useEffect(() => {
    const onFocus = () => setFocused(true);
    const onBlur = () => setFocused(false);
    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
    };
  }, []);
  return isFocused;
}

function MenuRow({ bridge }: { bridge: DesktopBridge }) {
  const openMenu = (menu: DesktopMenu | "All") => (event: MouseEvent<HTMLButtonElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    bridge.showMenu(menu, rect.left, rect.bottom + 2);
  };

  return (
    <div className="flex items-center">
      <span className="mx-1.5 flex h-5 w-5 items-center justify-center rounded-md bg-gradient-to-br from-sky-500 to-indigo-600 text-white shadow-sm">
        <FileText className="h-3 w-3" />
      </span>
      {/* A narrow window collapses the menus into one button, as VS Code does. */}
      <button type="button" onClick={openMenu("All")} title="Menu" className={cn("rounded-md p-1.5 lg:hidden", HOVER, NO_DRAG)}>
        <Menu className="h-3.5 w-3.5" />
      </button>
      <nav className="hidden items-center lg:flex">
        {DESKTOP_MENUS.map((menu) => (
          <button key={menu} type="button" onClick={openMenu(menu)} className={cn("rounded-md px-2 py-1", HOVER, NO_DRAG)}>
            {menu}
          </button>
        ))}
      </nav>
    </div>
  );
}

function CommandCenter({ shortcut }: { shortcut: string }) {
  const workspaceName = useWorkbench((s) => s.workspace?.name);
  const activeTab = useWorkbench((s) => s.activeTab);
  const setCommandPaletteOpen = useWorkbench((s) => s.setCommandPaletteOpen);
  const fileName = activeTab?.split("/").pop();

  return (
    <button
      type="button"
      onClick={() => setCommandPaletteOpen(true)}
      title={`Search files and commands (${shortcut})`}
      className={cn(
        "group absolute left-1/2 flex h-[22px] w-[min(520px,36vw)] -translate-x-1/2 items-center gap-2 rounded-md border border-sidebar-border bg-background/50 px-2 text-muted-foreground",
        "transition-all duration-150 hover:border-ring/50 hover:bg-background hover:text-foreground hover:shadow-sm",
        NO_DRAG
      )}
    >
      <Search className="h-3.5 w-3.5 shrink-0 opacity-70 transition-opacity group-hover:opacity-100" />
      <span className="flex-1 truncate text-center">
        {fileName && <span className="text-foreground/90">{fileName} — </span>}
        {workspaceName ?? "Local Workbench"}
      </span>
      <kbd className="hidden shrink-0 rounded border border-sidebar-border px-1 font-sans text-[10px] opacity-70 md:inline">
        {shortcut}
      </kbd>
    </button>
  );
}

function LayoutControls() {
  const explorerVisible = useWorkbench((s) => s.explorerVisible);
  const diagnosticsVisible = useWorkbench((s) => s.diagnosticsVisible);
  const aiVisible = useWorkbench((s) => s.aiVisible);
  const setExplorerVisible = useWorkbench((s) => s.setExplorerVisible);
  const setDiagnosticsVisible = useWorkbench((s) => s.setDiagnosticsVisible);
  const setAiVisible = useWorkbench((s) => s.setAiVisible);

  return (
    <div className="ml-auto flex items-center gap-0.5">
      <Toggle isOn={explorerVisible} onClick={() => setExplorerVisible(!explorerVisible)} title="Toggle explorer (Ctrl+B)">
        <PanelLeft className="h-3.5 w-3.5" />
      </Toggle>
      <Toggle isOn={diagnosticsVisible} onClick={() => setDiagnosticsVisible(!diagnosticsVisible)} title="Toggle panel (Ctrl+J)">
        <PanelBottom className="h-3.5 w-3.5" />
      </Toggle>
      <Toggle isOn={aiVisible} onClick={() => setAiVisible(!aiVisible)} title="Toggle AI assistant (Ctrl+Shift+A)">
        <PanelRight className="h-3.5 w-3.5" />
      </Toggle>
    </div>
  );
}

function Toggle({ isOn, onClick, title, children }: { isOn: boolean; onClick: () => void; title: string; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={isOn}
      className={cn("rounded-md p-1.5", HOVER, NO_DRAG, isOn ? "text-sidebar-foreground" : "text-muted-foreground/60")}
    >
      {children}
    </button>
  );
}
