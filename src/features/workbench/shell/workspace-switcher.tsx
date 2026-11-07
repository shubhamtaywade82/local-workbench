// Workspace switcher dropdown. Used in the File Explorer header row and the
// Status Bar. Shows the current workspace name + a chevron; clicking opens a
// menu with:
//   - Recent workspaces (click to reopen — for in-memory workspaces we can
//     fully restore, for FSA workspaces we re-trigger the picker)
//   - Open local folder…  (triggers the File System Access directory picker)
//   - Open sample workspace (loads the bundled sample files)
//   - Server folders (roots from WORKSPACE_ROOTS on the machine running the
//     server, e.g. inside WSL; only shown when the server enables them)
//
// The dropdown auto-dismisses when an action runs.

"use client";

import { useEffect, useState } from "react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ChevronDown,
  FolderOpen,
  FileText,
  Clock,
  Check,
  Folder,
  Server,
} from "lucide-react";
import { useWorkbench } from "@/features/workbench/store";
import { useWorkspaceController } from "@/platform/filesystem/use-workspace-controller";
import {
  listRecentWorkspaces,
  removeRecentWorkspace,
  type RecentWorkspace,
} from "@/platform/persistence/persistence";
import { isFileSystemAccessSupported } from "@/platform/filesystem/workspace-fs";
import { listServerRoots, type ServerRootInfo } from "@/platform/filesystem/server-workspace";
import { cn } from "@/lib/utils";

interface Props {
  /** "compact" renders a thinner trigger for the status bar. */
  variant?: "default" | "compact";
  className?: string;
}

export function WorkspaceSwitcher({ variant = "default", className }: Props) {
  const workspace = useWorkbench((s) => s.workspace);
  const controller = useWorkspaceController();
  const [recent, setRecent] = useState<RecentWorkspace[]>([]);
  // null = server workspace disabled/unreachable; [] = enabled with no roots.
  const [serverRoots, setServerRoots] = useState<ServerRootInfo[] | null>(null);
  const [open, setOpen] = useState(false);
  const fsaSupported = isFileSystemAccessSupported();

  // Load recent workspaces when the menu opens.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      const [list, roots] = await Promise.all([listRecentWorkspaces(), listServerRoots()]);
      if (cancelled) return;
      setRecent(list);
      setServerRoots(roots);
    })();
    return () => {
      cancelled = true;
    };
  }, [open]);

  async function handleOpenLocal() {
    setOpen(false);
    await controller.openLocalDirectory();
  }

  async function handleOpenSample() {
    setOpen(false);
    await controller.openSampleWorkspace();
  }

  async function handleOpenServerRoot(root: ServerRootInfo) {
    setOpen(false);
    await controller.openServerWorkspace(root);
  }

  async function handleOpenRecent(item: RecentWorkspace) {
    setOpen(false);
    if (item.source === "in-memory") {
      await controller.openSampleWorkspace();
    } else if (item.source === "server") {
      // Server roots reopen directly — no picker, no permission prompt — as
      // long as the server still lists this root.
      const root = serverRoots?.find((r) => r.id === item.serverRootId);
      if (!root) {
        window.alert(
          `"${item.name}" is no longer available on the server. Check WORKSPACE_ROOTS and that the server is running.`
        );
        return;
      }
      await controller.openServerWorkspace(root);
    } else {
      // FSA workspaces can't be re-opened without a fresh permission grant
      // — re-trigger the picker. The user will be guided to pick the same
      // folder (whose name is preserved in `item.handleName`).
      if (!fsaSupported) {
        window.alert(
          "Your browser does not support the File System Access API. Use Chrome or Edge desktop to reopen this workspace."
        );
        return;
      }
      const ok = window.confirm(
        `Re-opening "${item.handleName ?? item.name}" requires you to re-pick the folder in the system picker (browser security). Continue?`
      );
      if (!ok) return;
      await controller.openLocalDirectory();
    }
  }

  async function handleRemoveRecent(item: RecentWorkspace, e: React.MouseEvent) {
    e.stopPropagation();
    await removeRecentWorkspace(item.id);
    const list = await listRecentWorkspaces();
    setRecent(list);
  }

  const displayName = workspace?.name ?? "No workspace";
  const isCompact = variant === "compact";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger
        className={cn(
          "flex items-center gap-1.5 rounded text-xs outline-none hover:bg-muted/60 focus-visible:ring-1 focus-visible:ring-ring",
          isCompact ? "px-1.5 py-0.5" : "w-full px-2 py-1.5 text-left",
          !workspace && "text-muted-foreground",
          className
        )}
        aria-label="Switch workspace"
      >
        {isCompact ? (
          <Folder className="h-3 w-3 opacity-80" />
        ) : (
          <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
        )}
        <span className={cn("truncate", isCompact ? "max-w-[160px]" : "flex-1 font-medium")}>
          {displayName}
        </span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align={isCompact ? "start" : "start"}
        className="w-[280px]"
        sideOffset={4}
      >
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Workspace
        </DropdownMenuLabel>
        {workspace && (
          <>
            <div className="px-2 py-1 text-xs">
              <div className="font-medium truncate">{workspace.name}</div>
              <div className="text-[10px] text-muted-foreground">
                Source:{" "}
                {workspace.source === "file-system-access"
                  ? "Local folder"
                  : workspace.source === "in-memory"
                    ? "Sample (in-memory)"
                    : workspace.source === "server"
                      ? "Server folder"
                      : workspace.source}
              </div>
              {!fsaSupported && (
                <div className="mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                  File System Access API unavailable — open-local-folder disabled.
                </div>
              )}
            </div>
            <DropdownMenuSeparator />
          </>
        )}
        <DropdownMenuItem
          onClick={handleOpenLocal}
          disabled={!fsaSupported}
          className="gap-2 text-xs"
        >
          <FolderOpen className="h-3.5 w-3.5" />
          Open local folder…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={handleOpenSample} className="gap-2 text-xs">
          <FileText className="h-3.5 w-3.5" />
          Open sample workspace
        </DropdownMenuItem>

        {serverRoots && serverRoots.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Server folders
            </DropdownMenuLabel>
            {serverRoots.map((root) => (
              <DropdownMenuItem
                key={root.id}
                onClick={() => handleOpenServerRoot(root)}
                className="gap-2 text-xs"
              >
                <Server className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                <span className="truncate">{root.name}</span>
                {workspace?.source === "server" && workspace.serverRootId === root.id && (
                  <Check className="ml-auto h-3 w-3 text-emerald-500" />
                )}
              </DropdownMenuItem>
            ))}
          </>
        )}

        {recent.length > 0 && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              Recent
            </DropdownMenuLabel>
            <div className="max-h-[200px] overflow-y-auto">
              {recent.map((item) => {
                const isCurrent =
                  workspace?.source === item.source &&
                  workspace?.name === item.name;
                return (
                  <DropdownMenuItem
                    key={item.id}
                    onClick={() => handleOpenRecent(item)}
                    className="flex items-center gap-2 py-1.5 text-xs"
                  >
                    {item.source === "file-system-access" ? (
                      <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
                    ) : item.source === "server" ? (
                      <Server className="h-3.5 w-3.5 shrink-0 text-violet-500" />
                    ) : (
                      <FileText className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate">{item.name}</div>
                      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
                        <Clock className="h-2.5 w-2.5" />
                        <time dateTime={new Date(item.lastOpenedAt).toISOString()}>
                          {formatRelative(item.lastOpenedAt)}
                        </time>
                      </div>
                    </div>
                    {isCurrent && <Check className="h-3 w-3 text-emerald-500" />}
                    <button
                      className="ml-1 rounded px-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                      onClick={(e) => handleRemoveRecent(item, e)}
                      title="Remove from recent"
                    >
                      ×
                    </button>
                  </DropdownMenuItem>
                );
              })}
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function formatRelative(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 7) return `${day}d ago`;
  return new Date(timestamp).toLocaleDateString();
}
