import { NextRequest, NextResponse } from "next/server";
import {
  DEFAULT_MODEL,
  errorMessage,
  getZai,
  stripCodeFence,
} from "@/lib/ai/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DiagramType = "flowchart" | "sequence" | "state" | "er" | "class";

interface GenerateDiagramRequestBody {
  description: string;
  type?: DiagramType;
}

interface GenerateDiagramResponse {
  mermaid: string;
}

const DIAGRAM_OPENERS: Record<DiagramType, string> = {
  flowchart: "flowchart",
  sequence: "sequenceDiagram",
  state: "stateDiagram-v2",
  er: "erDiagram",
  class: "classDiagram",
};

/**
 * POST /api/ai/generate-diagram
 *
 * Body: { description, type? }
 *
 * Returns `{ mermaid }`. The model is asked to produce valid Mermaid only
 * (no code fence, no explanation). Code fences are stripped defensively
 * in case the model ignores the instruction.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let body: GenerateDiagramRequestBody;
  try {
    body = (await req.json()) as GenerateDiagramRequestBody;
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid JSON body: ${errorMessage(err)}` },
      { status: 400 }
    );
  }

  if (typeof body?.description !== "string" || !body.description.trim()) {
    return NextResponse.json(
      { error: "`description` string is required." },
      { status: 400 }
    );
  }

  const type: DiagramType = body.type ?? "flowchart";
  const opener = DIAGRAM_OPENERS[type] ?? DIAGRAM_OPENERS.flowchart;

  const systemPrompt = [
    "You generate Mermaid diagrams from natural-language descriptions.",
    `Produce a ${type} diagram starting with the line \`${opener}\`.`,
    "Output ONLY the raw Mermaid source. Do not wrap it in a code fence.",
    "Do not include any prose, explanation, or commentary. Use clear,",
    "human-readable node labels. Keep the graph flat enough to render",
    "cleanly (avoid excessive branching).",
  ].join(" ");

  try {
    const zai = await getZai();
    const result = await zai.chat.completions.create({
      model: DEFAULT_MODEL,
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: body.description },
      ],
    });

    const raw: string =
      result?.choices?.[0]?.message?.content ??
      (typeof result === "string" ? result : "");

    let mermaid = stripCodeFence(raw);

    // If the model produced prose before/after the diagram, try to recover
    // the diagram block starting at the known opener.
    const openerIdx = mermaid.indexOf(opener);
    if (openerIdx > 0) {
      mermaid = mermaid.slice(openerIdx).trim();
    } else if (openerIdx === -1) {
      // Model didn't even include the opener — prepend it.
      mermaid = `${opener}\n${mermaid}`.trim();
    }

    return NextResponse.json({ mermaid } satisfies GenerateDiagramResponse);
  } catch (err) {
    return NextResponse.json(
      { error: errorMessage(err) },
      { status: 500 }
    );
  }
}
