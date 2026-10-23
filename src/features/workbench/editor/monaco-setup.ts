// Bundles Monaco instead of loading it from the jsdelivr CDN, which is the
// @monaco-editor/react default. With the default, the editor shows "Loading…"
// forever when the machine is offline or the CDN is blocked, and the desktop
// shell is meant to work offline. Import this module before the editor mounts.
//
// Worker mapping mirrors Monaco's own: each language service runs in a worker of
// its own, so JSON, CSS, HTML and TypeScript features keep working as they did
// with the CDN.

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

function createWorker(label: string): Worker {
  switch (label) {
    case "json":
      return new Worker(new URL("./workers/json.worker.ts", import.meta.url), { type: "module" });
    case "css":
    case "scss":
    case "less":
      return new Worker(new URL("./workers/css.worker.ts", import.meta.url), { type: "module" });
    case "html":
    case "handlebars":
    case "razor":
      return new Worker(new URL("./workers/html.worker.ts", import.meta.url), { type: "module" });
    case "typescript":
    case "javascript":
      return new Worker(new URL("./workers/ts.worker.ts", import.meta.url), { type: "module" });
    default:
      return new Worker(new URL("./workers/editor.worker.ts", import.meta.url), { type: "module" });
  }
}

const globalScope = self as unknown as {
  MonacoEnvironment?: { getWorker: (moduleId: string, label: string) => Worker };
};
globalScope.MonacoEnvironment = {
  getWorker: (_moduleId, label) => createWorker(label),
};

loader.config({ monaco });
