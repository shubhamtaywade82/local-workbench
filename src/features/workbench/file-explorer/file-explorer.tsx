// File explorer. Renders a lazy-loaded tree of the active workspace. Folders
// expand on click; files open in a new editor tab.

"use client";

import { useState, useCallback, useEffect } from "react";
import {
  ChevronRight,
  ChevronDown,
  File as FileIcon,
  Folder as FolderIcon,
  FolderOpen,
  RefreshCw,
  FilePlus,
  FolderPlus,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Input } from "@/components/ui/input";
import { useWorkbench } from "@/features/workbench/store";
import {
  openFileFromWorkspace,
  useWorkspaceController,
} from "@/platform/filesystem/use-workspace-controller";
import { documentRegistry } from "@/documents/core/registry";
import type { WorkspaceFileEntry } from "@/documents/core/types";
import { cn } from "@/lib/utils";

export function FileExplorer() {
  const tree = useWorkbench((s) => s.tree);
  const workspace = useWorkbench((s) => s.workspace);
  const treeLoading = useWorkbench((s) => s.treeLoading);
  const treeError = useWorkbench((s) => s.treeError);
  const setTree = useWorkbench((s) => s.setTree);
  const controller = useWorkspaceController();

  const [filter, setFilter] = useState("");
  const [expanded, setExpanded] = useState<Set<string>>(new Set([""]));

  const refresh = useCallback(async () => {
    const fs = controller.getFs();
    if (!fs) return;
    const root = await fs.listDirectory("");
    setTree(root);
  }, [controller, setTree]);

  // Auto-expand the root on first load.
  useEffect(() => {
    if (tree.length > 0 && expanded.size === 1 && expanded.has("")) {
      // already expanded root
    }
  }, [tree, expanded]);

  // Filter the tree by the search string (only shows files matching + their
  // ancestor folders). Folders with no matching descendants are hidden.
  const filteredTree = filter ? filterTree(tree, filter.toLowerCase()) : tree;

  return (
    <div className="flex h-full flex-col bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="flex items-center justify-between border-b px-3 py-2">
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Explorer
        </span>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => {
              const name = prompt("New file path:", "untitled.md");
              if (!name) return;
              const fs = controller.getFs();
              if (!fs) return;
              fs.createFile(name, "").then(refresh).catch((e) => alert(`Error: ${e.message}`));
            }}
            title="New file"
          >
            <FilePlus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={() => {
              const name = prompt("New folder path:", "new-folder");
              if (!name) return;
              const fs = controller.getFs();
              if (!fs) return;
              fs.createDirectory(name).then(refresh).catch((e) => alert(`Error: ${e.message}`));
            }}
            title="New folder"
          >
            <FolderPlus className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            onClick={refresh}
            title="Refresh"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", treeLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Workspace name + filter */}
      <div className="border-b px-2 py-1.5">
        <div className="truncate text-xs font-medium">
          {workspace?.name ?? "no workspace"}
        </div>
        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter files"
          className="mt-1 h-7 text-xs"
        />
      </div>

      {/* Tree */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="py-1 text-xs">
          {treeError && (
            <div className="px-3 py-2 text-destructive">
              {treeError}
            </div>
          )}
          {filteredTree.length === 0 && !treeLoading && (
            <div className="px-3 py-2 text-muted-foreground">
              No files
            </div>
          )}
          {filteredTree.map((entry) => (
            <TreeNode
              key={entry.path}
              entry={entry}
              depth={0}
              expanded={expanded}
              setExpanded={setExpanded}
              onOpen={async (path) => {
                const fs = controller.getFs();
                if (!fs) return;
                await openFileFromWorkspace(fs, path);
              }}
              loadChildren={async (path) => {
                const fs = controller.getFs();
                if (!fs) return [];
                return fs.listDirectory(path);
              }}
              onReplaceTree={setTree}
              tree={tree}
              filter={filter}
            />
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}

interface TreeNodeProps {
  entry: WorkspaceFileEntry;
  depth: number;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  onOpen: (path: string) => void;
  loadChildren: (path: string) => Promise<WorkspaceFileEntry[]>;
  onReplaceTree: (tree: WorkspaceFileEntry[]) => void;
  tree: WorkspaceFileEntry[];
  filter: string;
}

function TreeNode({
  entry,
  depth,
  expanded,
  setExpanded,
  onOpen,
  loadChildren,
  onReplaceTree,
  tree,
  filter,
}: TreeNodeProps) {
  const isActive = useWorkbench((s) =>
    entry.isDirectory ? false : s.activeTab === entry.path
  );
  const dirtyPaths = useWorkbench((s) => s.sessions);
  const isDirty = !entry.isDirectory && (dirtyPaths[entry.path]?.isDirty ?? false);

  const isOpen = expanded.has(entry.path) || (entry.path === "" && expanded.has(""));

  const toggle = useCallback(async () => {
    if (!entry.isDirectory) {
      onOpen(entry.path);
      return;
    }
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
  }, [entry, onOpen, setExpanded]);

  // Lazy-load children when expanding.
  useEffect(() => {
    if (!entry.isDirectory) return;
    if (!isOpen) return;
    if (entry.children && entry.children.length > 0) return;
    let cancelled = false;
    (async () => {
      const children = await loadChildren(entry.path);
      if (cancelled) return;
      // Patch the tree at the right place.
      const newTree = patchTreeWithChildren(tree, entry.path, children);
      onReplaceTree(newTree);
    })();
    return () => {
      cancelled = true;
    };
     
  }, [isOpen, entry.path, entry.isDirectory]);

  const padding = 8 + depth * 12;

  return (
    <div>
      <button
        onClick={toggle}
        className={cn(
          "flex w-full items-center gap-1 py-1 pr-2 text-left hover:bg-sidebar-accent/60",
          isActive && "bg-sidebar-accent"
        )}
        style={{ paddingLeft: padding }}
        title={entry.path}
      >
        {entry.isDirectory ? (
          <>
            {isOpen ? (
              <ChevronDown className="h-3 w-3 shrink-0" />
            ) : (
              <ChevronRight className="h-3 w-3 shrink-0" />
            )}
            {isOpen ? (
              <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            ) : (
              <FolderIcon className="h-3.5 w-3.5 shrink-0 text-amber-500" />
            )}
          </>
        ) : (
          <>
            <span className="h-3 w-3 shrink-0" />
            <FileIcon className={cn("h-3.5 w-3.5 shrink-0", fileIconColor(entry.path))} />
          </>
        )}
        <span className={cn("truncate", isActive && "font-medium")}>
          {entry.name}
        </span>
        {isDirty && <span className="ml-auto text-amber-500">●</span>}
      </button>
      {entry.isDirectory && isOpen && entry.children && entry.children.length > 0 && (
        <div>
          {filter
            ? filterTree(entry.children, filter.toLowerCase()).map((child) => (
                <TreeNode
                  key={child.path}
                  entry={child}
                  depth={depth + 1}
                  expanded={expanded}
                  setExpanded={setExpanded}
                  onOpen={onOpen}
                  loadChildren={loadChildren}
                  onReplaceTree={onReplaceTree}
                  tree={tree}
                  filter={filter}
                />
              ))
            : entry.children.map((child) => (
                <TreeNode
                  key={child.path}
                  entry={child}
                  depth={depth + 1}
                  expanded={expanded}
                  setExpanded={setExpanded}
                  onOpen={onOpen}
                  loadChildren={loadChildren}
                  onReplaceTree={onReplaceTree}
                  tree={tree}
                  filter={filter}
                />
              ))}
        </div>
      )}
    </div>
  );
}

export function fileIconColor(path: string): string | undefined {
  const ext = path.split(".").pop()?.toLowerCase();
  switch (ext) {
    case "md":
    case "markdown":
      return "text-sky-500";
    case "json":
    case "jsonc":
    case "json5":
    case "jsonl":
    case "ndjson":
      return "text-yellow-500";
    case "yaml":
    case "yml":
      return "text-rose-500";
    case "toml":
      return "text-orange-500";
    case "xml":
      return "text-emerald-500";
    case "mmd":
    case "mermaid":
      return "text-fuchsia-500";
    case "toon":
      return "text-violet-500";
    default:
      return undefined;
  }
}

function filterTree(
  entries: WorkspaceFileEntry[],
  query: string
): WorkspaceFileEntry[] {
  if (!query) return entries;
  const out: WorkspaceFileEntry[] = [];
  for (const entry of entries) {
    if (entry.isDirectory) {
      const children = entry.children ? filterTree(entry.children, query) : [];
      // Always include folders (children may be lazy-loaded later); if they
      // have children and none match, drop them.
      if (children.length === 0 && entry.children && entry.children.length > 0) {
        continue;
      }
      out.push({ ...entry, children: children.length ? children : entry.children });
    } else {
      if (entry.name.toLowerCase().includes(query) || entry.path.toLowerCase().includes(query)) {
        out.push(entry);
      }
    }
  }
  return out;
}

function patchTreeWithChildren(
  tree: WorkspaceFileEntry[],
  path: string,
  children: WorkspaceFileEntry[]
): WorkspaceFileEntry[] {
  if (path === "") return children;
  return tree.map((entry) => {
    if (entry.path === path) {
      return { ...entry, children };
    }
    if (entry.isDirectory && entry.children) {
      return { ...entry, children: patchTreeWithChildren(entry.children, path, children) };
    }
    return entry;
  });
}

// documentRegistry is imported for side-effect-free usage in case future
// features want to display supported extension badges. Re-export to silence
// unused import lint.
void documentRegistry;
