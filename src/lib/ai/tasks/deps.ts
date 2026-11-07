// Server-only composition root: wires the task ports to the real provider and
// the vendored Archify runtime. Routes call this per request; tests build their
// own AiTaskDeps with fakes instead.

import { resolveArchifyRuntime } from "@/lib/archify/runtime";
import { getArchifyRenderer } from "@/lib/archify/render-service";
import { isGenerativeUiEnabled, getGenerativeUiPrompt } from "../generative-ui/prompt";

import { createChatProvider, providerConfigured } from "./provider";
import type { AiTaskDeps, ArchifyVerifier } from "./runner";
import type { AiTaskRequest } from "./contract";

function archifyVerifier(): ArchifyVerifier | null {
  const resolved = resolveArchifyRuntime();
  if (!resolved.ok) return null;
  const renderer = getArchifyRenderer(resolved.runtime);
  return {
    render: (input, signal) => renderer.render(input, { signal }),
  };
}

export function createRunnerDeps(request: AiTaskRequest): AiTaskDeps {
  return {
    provider: providerConfigured() ? createChatProvider(request.model) : null,
    archify: archifyVerifier(),
    generativeUi: isGenerativeUiEnabled(),
    generativeUiPrompt: isGenerativeUiEnabled() ? getGenerativeUiPrompt() : "",
  };
}
