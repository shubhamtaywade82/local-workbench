/**
 * Generative-UI reliability eval: how often does the configured model produce
 * openui-lang that parses cleanly against the workbench component library?
 *
 * Uses the exact prompt, client (AI_PROVIDER / OLLAMA_* / OPENAI_* env) and
 * parser the app uses, so results transfer directly.
 *
 *   OPENUI_TELEMETRY_DISABLED=1 AI_PROVIDER=ollama OLLAMA_MODEL=llama3.1:8b \
 *     bun scripts/genui-eval.ts --runs 3 --min-rate 0.8
 *
 * Exit code 1 when the clean-parse rate of UI-expected cases is below --min-rate.
 */
import { createParser } from "@openuidev/lang-core";
import { getDefaultModel, getOpenAICompatible } from "../src/lib/ai/server";
import { getGenerativeUiPrompt, getServerLibrary } from "../src/lib/ai/generative-ui/prompt";
import { splitMessageSegments } from "../src/lib/ai/generative-ui/segments";

interface EvalCase {
  name: string;
  /** Whether a UI block is the expected answer shape. */
  expectUi: boolean;
  document?: { path: string; text: string };
  question: string;
}

const CASES: EvalCase[] = [
  {
    name: "json-overview",
    expectUi: true,
    document: {
      path: "package.json",
      text: '{\n  "name": "demo",\n  "version": "1.0",\n  "scripts": { "dev": "vite" },\n  "dependencies": { "react": "^19.0.0" }\n}\n',
    },
    question: "Summarise this document's structure as a table of keys and their types.",
  },
  {
    name: "yaml-issues",
    expectUi: true,
    document: {
      path: "config.yaml",
      text: "server:\n  port: \"8080\"\n  host: 0.0.0.0\nprod:\n  server:\n    port: 80\nretries: -1\n",
    },
    question: "List every ambiguity or likely mistake in this config.",
  },
  {
    name: "toml-fix",
    expectUi: true,
    document: {
      path: "pyproject.toml",
      text: '[project]\nname = "demo"\nversion = 1.0\ndependencies = ["requests>=2"]\n',
    },
    question: "`version` must be a string. Propose the corrected full document.",
  },
  {
    name: "plain-question",
    expectUi: false,
    question: "In one sentence: what is the difference between YAML and JSON?",
  },
];

function arg(name: string, fallback: number): number {
  const i = process.argv.indexOf(`--${name}`);
  const v = i >= 0 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) ? v : fallback;
}

interface RunResult {
  caseName: string;
  expectUi: boolean;
  uiBlocks: number;
  rendered: boolean;
  errors: number;
  unresolved: number;
  incomplete: boolean;
  ms: number;
  failure?: string;
}

async function runCase(c: EvalCase): Promise<RunResult> {
  const system = [
    "You are the Workbench AI assistant embedded in a local-first document editor.",
    c.document ? `Active file: ${c.document.path}. Its complete current content is in the user message.` : "",
    "",
    getGenerativeUiPrompt(),
  ].join("\n");
  const user = c.document ? `${c.question}\n\n---\n${c.document.text}` : c.question;
  const started = Date.now();
  try {
    const result = await getOpenAICompatible().chat.completions.create({
      model: getDefaultModel(),
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    });
    const content = result.choices[0]?.message?.content ?? "";
    const blocks = splitMessageSegments(content).filter((s) => s.kind === "ui");
    const parser = createParser(getServerLibrary().toJSONSchema(), "Stack");
    let errors = 0;
    let unresolved = 0;
    let incomplete = false;
    let rendered = blocks.length > 0;
    for (const block of blocks) {
      const parsed = parser.parse(block.kind === "ui" ? block.code : "");
      errors += parsed.meta.errors.length;
      unresolved += parsed.meta.unresolved.length;
      incomplete ||= parsed.meta.incomplete || (block.kind === "ui" && !block.complete);
      rendered &&= parsed.root !== null;
    }
    return { caseName: c.name, expectUi: c.expectUi, uiBlocks: blocks.length, rendered, errors, unresolved, incomplete, ms: Date.now() - started };
  } catch (err) {
    return {
      caseName: c.name, expectUi: c.expectUi, uiBlocks: 0, rendered: false, errors: 0, unresolved: 0,
      incomplete: false, ms: Date.now() - started, failure: err instanceof Error ? err.message : String(err),
    };
  }
}

async function main(): Promise<void> {
  const runs = arg("runs", 3);
  const minRate = arg("min-rate", 0.8);
  console.log(`[genui-eval] model=${getDefaultModel()} runs=${runs} cases=${CASES.length}`);

  const results: RunResult[] = [];
  for (let r = 0; r < runs; r++) {
    for (const c of CASES) {
      const res = await runCase(c);
      results.push(res);
      console.log(
        `  ${res.caseName.padEnd(15)} run=${r + 1} ui=${res.uiBlocks} rendered=${res.rendered} ` +
          `errors=${res.errors} unresolved=${res.unresolved} incomplete=${res.incomplete} ${res.ms}ms` +
          (res.failure ? ` FAILED: ${res.failure}` : "")
      );
    }
  }

  const uiCases = results.filter((r) => r.expectUi);
  const clean = uiCases.filter((r) => r.rendered && r.errors === 0 && r.unresolved === 0 && !r.incomplete);
  const textCases = results.filter((r) => !r.expectUi);
  const textOk = textCases.filter((r) => r.uiBlocks === 0 && !r.failure);
  const rate = uiCases.length ? clean.length / uiCases.length : 0;

  console.log("\n[genui-eval] summary");
  console.log(`  UI cases clean-parse: ${clean.length}/${uiCases.length} (${(rate * 100).toFixed(0)}%)`);
  console.log(`  UI cases rendered at all: ${uiCases.filter((r) => r.rendered).length}/${uiCases.length}`);
  console.log(`  Plain questions answered without UI: ${textOk.length}/${textCases.length}`);
  console.log(`  Transport failures: ${results.filter((r) => r.failure).length}`);
  console.log(rate >= minRate ? `  PASS (>= ${minRate})` : `  FAIL (< ${minRate})`);
  process.exit(rate >= minRate ? 0 : 1);
}

void main();
