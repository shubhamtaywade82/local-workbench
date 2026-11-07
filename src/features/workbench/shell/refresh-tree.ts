// Reloads the root of the explorer after a file or folder changes outside it.

import { useWorkbench } from "@/features/workbench/store";
import type { WorkspaceFileSystem } from "@/platform/filesystem/workspace-fs";

export async function refreshTreeFor(fs: WorkspaceFileSystem): Promise<void> {
  useWorkbench.getState().setTree(await fs.listDirectory(""));
}
