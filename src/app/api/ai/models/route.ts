import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/ai/models
 *
 * Returns the list of models we expose to the workbench. We hard-code the
 * list because the `z-ai-web-dev-sdk` (v0.0.18) does not ship a `listModels`
 * helper; the models below are all served by the Z.ai GLM gateway and are
 * known to accept the OpenAI-style chat completions body.
 */
export async function GET() {
  return NextResponse.json({
    provider: {
      id: "zai",
      name: "Z.ai GLM",
      available: true,
    },
    models: [
      { id: "glm-4-plus", name: "GLM-4 Plus" },
      { id: "glm-4-flash", name: "GLM-4 Flash" },
      { id: "glm-4.5", name: "GLM-4.5" },
    ],
  });
}
