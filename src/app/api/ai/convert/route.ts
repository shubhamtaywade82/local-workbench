import { NextRequest, NextResponse } from "next/server";
import { parse as parseJsonc } from "jsonc-parser";
import JSON5 from "json5";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";
import {
  getActionModel,
  errorMessage,
  getOpenAICompatible,
  stripCodeFence,
} from "@/lib/ai/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type DataFormat =
  | "json"
  | "jsonc"
  | "json5"
  | "yaml"
  | "toml"
  | "toon"
  | "xml"
  | "markdown";

const DATA_FORMATS: ReadonlySet<DataFormat> = new Set([
  "json",
  "jsonc",
  "json5",
  "yaml",
  "toml",
  "toon",
]);

interface ConvertRequestBody {
  source: string;
  fromFormat: DataFormat;
  toFormat: DataFormat;
}

interface ConvertResponse {
  result: string;
  format: string;
}

/**
 * Module specifier for the TOON adapter. The adapter is written by the
 * parallel task 3-b and may not exist when this route is first deployed.
 * We hold the path in a variable (typed as `string`) so TypeScript does
 * NOT try to statically resolve it — a dynamic `import(<variable>)` is
 * typed as `Promise<any>` which we then cast to the expected shape.
 */
const TOON_MODULE_SPEC: string = "@/documents/adapters/toon/toon";

interface ToonModuleShape {
  parse?: (s: string) => unknown;
  stringify?: (v: unknown) => string;
  default?: {
    parse?: (s: string) => unknown;
    stringify?: (v: unknown) => string;
  };
}

async function loadToonModule(): Promise<ToonModuleShape | null> {
  try {
    // Dynamic import with a non-literal specifier — TS types this as
    // `Promise<any>`, which is exactly what we want here. We catch import
    // failures (module missing) and return null so the caller can fall
    // back to the LLM path.
    const mod = (await import(TOON_MODULE_SPEC)) as ToonModuleShape;
    return mod;
  } catch (err) {
    console.error(
      "[ai/convert] TOON adapter dynamic import failed:",
      errorMessage(err)
    );
    return null;
  }
}

/**
 * Parse a document in one of the supported data formats into a JS value.
 * `markdown` and `xml` are intentionally not handled here — they aren't
 * pure data formats (markdown has no canonical AST→object mapping and the
 * `fast-xml-parser` round-trip is lossy for prose documents), so we let
 * the LLM handle them.
 */
async function parseDataFormat(
  format: DataFormat,
  source: string
): Promise<unknown> {
  switch (format) {
    case "json":
      return JSON.parse(source);
    case "jsonc":
      // jsonc-parser's `parse` tolerates comments and trailing commas and
      // returns the resulting JS value (or undefined on syntax error).
      return parseJsonc(source);
    case "json5":
      return JSON5.parse(source);
    case "yaml":
      return parseYaml(source);
    case "toml":
      return parseToml(source);
    case "toon": {
      const mod = await loadToonModule();
      const parseFn = mod?.parse ?? mod?.default?.parse;
      if (typeof parseFn !== "function") {
        throw new Error(
          "TOON adapter not available (parallel task 3-b has not provided it yet)."
        );
      }
      return parseFn(source);
    }
    default:
      throw new Error(`Cannot deterministically parse format: ${format}`);
  }
}

/**
 * Serialise a JS value into one of the supported data formats.
 */
async function stringifyDataFormat(
  format: DataFormat,
  value: unknown
): Promise<string> {
  switch (format) {
    case "json":
      return JSON.stringify(value, null, 2);
    case "jsonc":
      // jsonc-parser has no public stringify helper; plain JSON is a valid
      // JSONC document (comments are optional).
      return JSON.stringify(value, null, 2);
    case "json5":
      return JSON5.stringify(value, null, 2);
    case "yaml":
      return stringifyYaml(value);
    case "toml":
      return stringifyToml(value as Record<string, unknown>);
    case "toon": {
      const mod = await loadToonModule();
      const fn = mod?.stringify ?? mod?.default?.stringify;
      if (typeof fn !== "function") {
        throw new Error(
          "TOON adapter not available (parallel task 3-b has not provided it yet)."
        );
      }
      return fn(value);
    }
    default:
      throw new Error(`Cannot deterministically stringify format: ${format}`);
  }
}

/**
 * Try a deterministic, in-process conversion between two data formats.
 * Returns `null` if either format is not a data format (xml/markdown) or
 * if parsing/serialisation fails for any reason — the caller will fall
 * back to the LLM.
 */
async function tryDeterministicConvert(
  source: string,
  fromFormat: DataFormat,
  toFormat: DataFormat
): Promise<string | null> {
  if (!DATA_FORMATS.has(fromFormat) || !DATA_FORMATS.has(toFormat)) {
    return null;
  }
  if (fromFormat === toFormat) {
    return source;
  }
  try {
    const value = await parseDataFormat(fromFormat, source);
    const result = await stringifyDataFormat(toFormat, value);
    if (typeof result !== "string") return null;
    return result;
  } catch (err) {
    // Deterministic conversion failed (malformed source or value not
    // representable in the target) — let the caller fall back to the LLM.
    console.error(
      `[ai/convert] deterministic ${fromFormat}->${toFormat} failed:`,
      errorMessage(err)
    );
    return null;
  }
}

/**
 * POST /api/ai/convert
 *
 * Body: { source, fromFormat, toFormat }
 *
 * Returns `{ result, format }`. Tries deterministic in-process conversion
 * first (json/jsonc/json5/yaml/toml/toon), and only calls the LLM when
 * the deterministic path is unavailable (markdown / xml involved) or
 * fails. Code fences are stripped from the LLM output.
 */
export async function POST(req: NextRequest): Promise<Response> {
  let body: ConvertRequestBody;
  try {
    body = (await req.json()) as ConvertRequestBody;
  } catch (err) {
    return NextResponse.json(
      { error: `Invalid JSON body: ${errorMessage(err)}` },
      { status: 400 }
    );
  }

  if (typeof body?.source !== "string") {
    return NextResponse.json(
      { error: "`source` string is required." },
      { status: 400 }
    );
  }
  if (!body?.fromFormat || !body?.toFormat) {
    return NextResponse.json(
      { error: "`fromFormat` and `toFormat` are required." },
      { status: 400 }
    );
  }

  const from = body.fromFormat as DataFormat;
  const to = body.toFormat as DataFormat;

  // 1. Deterministic conversion (no LLM call).
  const deterministic = await tryDeterministicConvert(body.source, from, to);
  if (deterministic !== null) {
    return NextResponse.json({
      result: deterministic,
      format: to,
    } satisfies ConvertResponse);
  }

  // 2. LLM fallback.
  const systemPrompt = `Convert the user's document from ${from} to ${to}. Return only the converted document, no code fence, no explanation.`;
  try {
    const openai = getOpenAICompatible();
    const result = await openai.chat.completions.create({
      model: getActionModel("convert"),
      stream: false,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: body.source },
      ],
    });
    const raw: string =
      result?.choices?.[0]?.message?.content ??
      (typeof result === "string" ? result : "");
    return NextResponse.json({
      result: stripCodeFence(raw),
      format: to,
    } satisfies ConvertResponse);
  } catch (err) {
    return NextResponse.json(
      { error: errorMessage(err) },
      { status: 500 }
    );
  }
}
