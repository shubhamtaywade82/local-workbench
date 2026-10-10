# Local-First AI Document Editor (Workbench) — Build Worklog

Project: Build a browser-based, workspace-aware document editor with pluggable preview engine and AI assistant, inside the existing Next.js 16 project at `/home/z/my-project`.

Goal: A production-ready single-route (`/`) IDE workbench with Explorer, Tabs, Monaco Editor, Live Preview, Diagnostics, AI Assistant, Command Palette, IndexedDB persistence, and File System Access API integration (with sample-workspace fallback).

---
Task ID: 0
Agent: orchestrator (main)
Task: Bootstrap plan and worklog.

Work Log:

- Read complete requirement file (673 lines).
- Inspected existing Next.js 16 + Tailwind 4 + shadcn/ui project.
- Decided architecture:
  - Single route `/` containing the entire IDE shell.
  - All UI components in `src/features/workbench/*`.
  - Document adapter core in `src/documents/core`, adapters in `src/documents/adapters/*`.
  - File system platform in `src/platform/filesystem` (FSA + in-memory sample fallback).
  - Persistence in `src/platform/persistence` (IndexedDB).
  - AI backend in `src/app/api/ai/*` using the official OpenAI SDK.
  - Monaco editor loaded dynamically with `ssr:false`.
- Identified parallelisable subagent tasks: 3-a (data adapters), 3-b (diagram/xml/toon adapters), 3-c (AI API routes).

Stage Summary:

- Plan locked in. Dependencies to install next: `@monaco-editor/react`, `monaco-editor`, `yaml`, `smol-toml`, `jsonc-parser`, `json5`, `fast-xml-parser`, `mermaid`, `idb`, `diff`.

---
Task ID: 3-c
Agent: general-purpose (AI backend)
Task: Build AI backend API routes using the OpenAI SDK.

Work Log:

- Read worklog (Task 0 plan locked in; AI backend lives under `src/app/api/ai/*`).
- The routes use the official OpenAI SDK with the standard Chat Completions API. Credentials and optional compatible-provider URL/model use `OPENAI_API_KEY`, `OPENAI_BASE_URL`, and `OPENAI_MODEL`.
- Inspected project layout: `src/app/api/` existed with a single `route.ts`; `src/documents/adapters/` exists with empty `toon/` dir (parallel task 3-b hasn't shipped the TOON adapter yet).
- Confirmed parser packages' APIs: `jsonc-parser` has `parse` (no stringify — JSON.stringify is a valid JSONC output), `json5` has `parse`+`stringify`, `yaml` has `parse`+`stringify`, `smol-toml` has `parse`+`stringify`, `diff` exposes `createPatch(fileName, oldStr, newStr, oldHeader, newHeader, options)`.
- Created shared server lib `src/lib/ai/server.ts`:
  - A shared, lazily initialized OpenAI client reads credentials from server-side environment variables.
  - `parseSseStream(stream)` async generator that decodes the raw upstream `ReadableStream<Uint8Array>`, splits SSE `data:` lines, JSON-parses each, stops at `[DONE]`, and skips malformed frames.
  - `stripCodeFence(text)` removes a single outer ``` fence (preserves nested fences).
  - `extractJson<T>(text)` tries direct parse, then a fenced ```json block, then a brace-balanced substring — used by `explain` and `fix` for robust JSON extraction.
  - `errorMessage(err)` helper for clean error JSON.
- Created `src/app/api/ai/models/route.ts` — `GET` returning the configured OpenAI-compatible provider and model.
- Created `src/app/api/ai/chat/route.ts` — `POST` streaming SSE. Builds a context-aware system prompt, consumes the SDK async stream, and re-emits each delta in the workbench's SSE response format.
- Created `src/app/api/ai/explain/route.ts` — `POST` non-streaming. JSON-instructed system prompt. Parses the model output with `extractJson`; if shape mismatches, falls back to `{explanation: stripCodeFence(raw), ambiguity: []}`.
- Created `src/app/api/ai/fix/route.ts` — `POST`. Diagnostics summarised into the system prompt. Expects `{label, description, newText, diff?}` (full corrected document, not a patch). Falls back to `{label:"Apply AI suggestion", description:"The model did not return structured JSON.", newText: raw}` when JSON extraction fails.
- Created `src/app/api/ai/convert/route.ts` — `POST`. Tries deterministic in-process conversion first for the data formats `{json, jsonc, json5, yaml, toml, toon}` using the appropriate parser/stringifier pair; on any failure (or when `xml`/`markdown` is involved) falls back to the LLM. The TOON adapter is loaded via `import(<variable-spec>)` so TypeScript does not statically resolve the path (the module doesn't exist yet — task 3-b ships it); import failures are caught and surfaced as a clean error so the route still works for the other formats.
- Created `src/app/api/ai/generate-diagram/route.ts` — `POST`. Default type `flowchart`; opens the diagram with the correct Mermaid keyword per type (`flowchart`, `sequenceDiagram`, `stateDiagram-v2`, `erDiagram`, `classDiagram`). Strips code fences and trims any leading prose so the output starts at the opener.
- Created `src/app/api/ai/improve-docs/route.ts` — `POST`. Rewrites Markdown preserving structure and (default true) verbatim code blocks. Tones: `concise` (default), `detailed`, `friendly`. Computes a unified diff between the original and improved text with `createPatch("document.md", old, new, "original", "improved", {context:3})` and returns it in the optional `diff` field.
- Ran `bun run lint` against the whole project — only 2 errors remain (in `src/features/workbench/hooks.ts`, owned by another agent). My 8 files produce zero lint errors when targeted directly.
- Ran `bunx tsc --noEmit` against the whole project — only pre-existing errors remain in `examples/*` and `skills/*`. My 8 files produce zero TypeScript errors.

Stage Summary:

- Files created:
  - `src/lib/ai/server.ts` (shared SDK singleton + SSE parser + JSON/fence helpers)
  - `src/app/api/ai/models/route.ts`
  - `src/app/api/ai/chat/route.ts`
  - `src/app/api/ai/explain/route.ts`
  - `src/app/api/ai/fix/route.ts`
  - `src/app/api/ai/convert/route.ts`
  - `src/app/api/ai/generate-diagram/route.ts`
  - `src/app/api/ai/improve-docs/route.ts`
- Routes added:
  - `GET  /api/ai/models` — expose the configured model
  - `POST /api/ai/chat` — streaming SSE chat with workbench-aware system prompt
  - `POST /api/ai/explain` — explain a document + flag ambiguity (JSON)
  - `POST /api/ai/fix` — propose a full corrected document for diagnostics
  - `POST /api/ai/convert` — deterministic parse+stringify first, LLM fallback
  - `POST /api/ai/generate-diagram` — Mermaid from natural language
  - `POST /api/ai/improve-docs` — rewrite Markdown + unified diff
- Lint status: pass (zero errors across all 8 created files; the 2 remaining project lint errors are in `src/features/workbench/hooks.ts` and are owned by another agent).
- TypeScript: pass (zero errors across all 8 created files).
- SDK invocation uses `openai.chat.completions.create({ model, messages, stream })`; non-streaming responses and streaming deltas follow the standard OpenAI SDK types.
- Key decisions:
  - Shared `src/lib/ai/server.ts` so each route reuses one OpenAI client and the same JSON/fence helpers — keeps route files thin and consistent.
  - All routes declare `export const runtime = "nodejs"` and `export const dynamic = "force-dynamic"`.
  - All SDK calls wrapped in try/catch returning `{ error: "..." }` JSON with status 500; the streaming chat route additionally emits an SSE error event before the `[DONE]` sentinel so the client always sees a clean stream end.
  - `convert` route prefers a deterministic local round-trip (parse → object → stringify) for pure data formats and only invokes the LLM when the deterministic path is unavailable or fails — saves tokens and gives reproducible output for `json↔yaml↔toml↔json5↔jsonc↔toon`.
  - The TOON adapter import uses a non-literal module specifier held in a `string`-typed variable so TypeScript doesn't statically resolve the path — the route compiles today even though task 3-b hasn't shipped the file yet, and will pick it up automatically once it lands.
  - All routes use `NextRequest`/`NextResponse` from `next/server`; the chat streaming route returns a raw `Response` with a `ReadableStream` body because that's the natural shape for SSE.
  - No `console.log` in production paths; `console.error` is used only for genuine failures (SDK init, deterministic-conversion failures, diff failures, TOON dynamic-import failures).
- AI requests return a clear configuration error when `OPENAI_API_KEY` is absent; the models endpoint reports the assistant as unavailable in that case.

---
Task ID: 3-b
Agent: general-purpose (diagram/xml/toon adapters)
Task: Implement Mermaid, XML, TOON document adapters.

Work Log:

- Read worklog (Task 0 plan; Task 3-c AI backend already in place, including a dynamic-import slot for the TOON adapter at `src/app/api/ai/convert/route.ts`).
- Read `src/documents/core/types.ts` to lock in the `DocumentAdapter`, `ParseResult`, `PreviewModel`, `Diagnostic`, `TextEdit` contracts.
- Read `src/documents/core/registry.ts` to confirm the `documentRegistry.register(adapter)` shape and the per-extension "first-registered wins" rule; the `register()` export contract used by the orchestrator.
- Inspected `node_modules/fast-xml-parser/src/fxp.d.ts` to confirm `XMLValidator.validate` returns `true | { err: { code, msg, line, col } }` and the `XMLParser`/`XMLBuilder` constructor option shapes.
- Created `src/documents/adapters/mermaid/mermaid.ts`:
  - `KNOWN_DIAGRAM_TYPES` set (17 entries, lower-cased for case-insensitive compare).
  - `firstSignificantLine()` skips blank lines and `%%`-prefixed Mermaid comments.
  - `parse()` returns `{ valid: true, value: source, diagnostics }` and never hard-fails; on unknown first keyword, emits a `mermaid/unknown-type` warning with the correct 1-based line range.
  - `createPreview()` emits `{ kind: "diagram", engine: "mermaid", source }`.
  - `validate()` delegates to the same diagnostic computation.
- Created `src/documents/adapters/xml/xml.ts`:
  - `parse()` calls `XMLValidator.validate(source)` first; on error returns `{ valid: false, diagnostics: [{severity:"error", message:err.err.msg, code:err.err.code, range:{line:err.err.line, col:err.err.col}}] }`. On success uses `new XMLParser({ ignoreAttributes: false, preserveOrder: false })` so attributes appear as `@_attrName` keys and mixed content as `#text`.
  - `createPreview()` emits `{ kind: "xml-tree", source, value }` — on parse failure, value is `undefined`.
  - `format()` pretty-prints via `new XMLBuilder({ format: true, indentBy: "  ", ignoreAttributes: false })`; returns a single whole-file `TextEdit` with `label: "Format XML"` and only emits an edit when the output differs from the input.
- Created `src/documents/adapters/toon/toon.ts`:
  - Implemented `parseToon(source, filePath)` as a stack-based parser: frames are `{ indent, container, key?, isArray, parent }`; root frame is an object at indent -1. For each line, computes indentation (auto-converting tabs to 2 spaces with a `toon/tab-indent` warning), pops frames with indent ≥ current, then dispatches on `key: value` / `key:` / `- value` shape.
  - `key:` frames defer the decision of object-vs-array to the first child: a `- value` child decides array; a `childKey:` child decides object; the placeholder `null` is written back to the parent immediately and replaced when the container is decided.
  - Scalar parsing (`parseScalar`) handles double-quoted strings with JSON-style escapes (`\n \t \r \" \\ \/ \b \f \uXXXX`), bare scalars (`true`/`false`/`null`/integer/float/scientific), and bare strings. Unknown escapes emit a `toon/syntax` warning and continue best-effort.
  - Diagnostics for malformed input (top-level dash, `key:` inside an array context, unterminated quotes, empty keys, no colon) are emitted with severity error and a 1-based line range; the parser never throws.
  - `toonStringify(value)` walks the value tree emitting two-space indentation. Strings are quoted only when `needsQuoting` returns true (looks like a number, equals `true`/`false`/`null`, contains `:`, `-`, whitespace, or starts with `"`/`#`).
  - KNOWN LIMITATION documented in a header comment and handled defensively: arrays of objects do not round-trip — `toonStringify` serialises such elements as a JSON string (lossy but parses), and `parseToon` rejects `key:` lines inside an array context with a `toon/syntax` error.
  - Adapter wires `parse()`/`createPreview()`/`validate()`/`format()`; `createPreview()` falls back to `{ kind: "text-fallback", language: "plaintext" }` when the parser emits any error. `format()` re-emits via `toonStringify` with `label: "Format TOON"`.
  - `languageId` set to `"plaintext"` per task note (Monaco has no built-in TOON highlighter; using `"toon"` would make Monaco error when assigning the language to the model).
  - `parseToon` and `toonStringify` exported as named exports for reuse by the AI convert-format route and by future JSON↔TOON conversion tests.
- Created `src/documents/adapters/{mermaid,xml,toon}/index.ts`, each exporting a `register()` that calls `documentRegistry.register(adapter)`. The TOON index additionally re-exports `parseToon`/`toonStringify` for the AI route's dynamic import.
- Sanity-checked all three adapters with a throwaway Bun script (deleted afterwards):
  - Spec TOON example parses to `{project:"workbench", version:1, features:{preview:true, ai:true}, authors:["Alice","Bob"]}` (note: JS collapses `1.0` to `1` — this is correct; `JSON.stringify(1.0) === "1"`).
  - Round-trip `parseToon(toonStringify(value))` preserves value for plain data.
  - Tab-indented input emits a `toon/tab-indent` warning and still parses correctly.
  - Top-level `- foo` emits a `toon/syntax` error.
  - Quoted number string `"1.0"` round-trips as a string (preserves type via `needsQuoting`).
  - Nested objects (`outer.inner.deep`) parse correctly.
  - XML round-trips through `XMLParser` → `XMLBuilder`; attributes appear as `@_attr` keys; invalid `<unclosed>` produces an `InvalidTag` error diagnostic with proper line/col range.
  - Mermaid `flowchart TD` produces no diagnostics; `%%` comments are skipped before the first significant line; `notAType` produces a `mermaid/unknown-type` warning.
- Ran `bun run lint` against the whole project — only 2 pre-existing errors remain in `src/features/workbench/hooks.ts` (owned by another agent). Running eslint directly on `src/documents/adapters` produces zero errors and zero warnings.
- Ran `tsc --noEmit` against the whole project — zero errors in any adapter file.

Stage Summary:

- Files created:
  - `src/documents/adapters/mermaid/mermaid.ts`
  - `src/documents/adapters/mermaid/index.ts`
  - `src/documents/adapters/xml/xml.ts`
  - `src/documents/adapters/xml/index.ts`
  - `src/documents/adapters/toon/toon.ts`
  - `src/documents/adapters/toon/index.ts`
- Adapters registered: `mermaid` (`.mmd`, `.mermaid`), `xml` (`.xml`), `toon` (`.toon`).
- Lint status: pass (zero errors across all 6 created files; the 2 remaining project lint errors are in `src/features/workbench/hooks.ts` and are owned by another agent).
- TypeScript: pass (zero errors across all 6 created files).
- Key decisions:
  - Mermaid never hard-fails parse — the renderer is the source of truth for syntax errors; the adapter only does a cheap first-keyword pre-check so the diagnostics panel can warn early.
  - XML uses `XMLValidator` before `XMLParser` to get friendly line/col-tagged error diagnostics instead of an opaque parser throw; attributes are preserved as `@_name` keys per the spec.
  - TOON's `key:` container decision is deferred to the first child (array vs. object), which keeps the grammar unambiguous without requiring explicit array markers.
  - TOON's `languageId` is `"plaintext"` (not `"toon"`) so Monaco doesn't reject the model assignment — the task note flagged this explicitly.
  - TOON arrays-of-objects limitation is documented as a header comment and handled lossily (JSON-stringified) so output still parses; this matches the spec's "not required to round-trip" clause.
  - `parseToon`/`toonStringify` are named exports (re-exported from `toon/index.ts`) so the AI `/api/ai/convert` route and future conversion tests can import them directly.
  - All diagnostics use 1-based line/column; when only the line is known, `startColumn=1, endLine=startLine, endColumn=Number.MAX_SAFE_INTEGER` per the task's range convention.
- Downstream contract: each `index.ts` exports `register()` (no args, no return) — the orchestrator's `registerAllAdapters()` can `await import("./adapters/mermaid")` then call `.register()` for each.

---
Task ID: 3-a
Agent: general-purpose (data adapters)
Task: Implement Markdown, JSON family, YAML, TOML document adapters.

Work Log:

- Read worklog (Task 0 plan + Task 3-c AI routes already shipped; data adapters live under `src/documents/adapters/*` and register with the singleton `documentRegistry` from `src/documents/core/registry.ts`).
- Re-read `src/documents/core/types.ts` (full `DocumentAdapter`, `ParseResult`, `PreviewModel`, `Diagnostic`, `TextEdit`, `CompletionContext`/`CompletionItem` contracts — all 1-based line/column) and `registry.ts` (extension-keyed map; first registration wins per extension; `TextFallbackAdapter` handles unknown paths).
- Inspected package APIs at `node_modules/*/package.json` and `*.d.ts`:
  - `jsonc-parser@3.3.1`: `parse`, `parseTree`, `getNodeValue`, `printParseErrorCode`, `ParseError{error,offset,length}`, `Node{offset,length,...}`. `ParseOptions{disallowComments?, allowTrailingComma?, allowEmptyContent?}` — by default comments are allowed, so `.json` and `.jsonc` share one parse path.
  - `json5@2.2.3`: default export has `parse(text, reviver?)`; thrown errors carry `message`, optional `at` (0-based offset) and optional `lineNumber`/`column` (1-based).
  - `yaml@2.9.1`: `parseDocument(source, options?)` is non-throwing; `doc.errors` and `doc.warnings` are `YAMLError[]` with `code`, `pos:[start,end]`, optional `linePos:[{line,col}, ...]`. `LineCounter` lets us translate offsets to 1-based `{line,col}`. `doc.toJS({maxAliasCount})` for partial recovery. `doc.toString({indent, lineWidth})` already appends a trailing newline.
  - `smol-toml@1.9.1`: ESM-first; exports `parse`, `stringify`, `TomlError`. `TomlError` carries `line` and `column` (1-based).
- Created `src/documents/adapters/markdown/markdown.ts`:
  - `id:"markdown"`, `extensions:["md","markdown"]`, `languageId:"markdown"`, `displayName:"Markdown"`.
  - `parse` always succeeds (markdown is permissive): returns `{valid:true, value:source, diagnostics:lintMarkdown(source,filePath)}`.
  - `createPreview` returns `{kind:"markdown", source}`.
  - `validate` returns the deterministic lint set: MD018 (heading with no space after `#`, warning, with a "insert space" quick-fix) and MD009 (trailing whitespace, info, with a "remove" quick-fix). Ranges are 1-based, span the offending columns.
  - `format` trims trailing whitespace on every line, normalises CRLF→LF, ensures exactly one trailing newline — emits a whole-file `TextEdit`.
  - `getCompletions` returns a small fixed set of ATX heading / list / blockquote / code-fence snippets (best-effort, no AST).
- Created `src/documents/adapters/json/json.ts`:
  - `id:"json"`, `extensions:["json","jsonc","json5","jsonl","ndjson"]`, `languageId:"json"`, `displayName:"JSON"`.
  - Helper `getVariant(filePath)` dispatches by extension. Helpers `lineOffsets(source)` (start offset per line) and `offsetToRange(source, offset, length)` (binary search over `lineOffsets` → 1-based `SourceRange`) are exported for reuse by diagnostics/AI tooling.
  - `.json`/`.jsonc` use `jsonc-parseTree` (fault-tolerant; allows trailing commas & comments) → `getNodeValue` for the value, errors mapped via `printParseErrorCode` to 1-based ranges via `offsetToRange`. On errors the partial fault-tolerant value is returned as `result.partial` so the preview can still render.
  - `.json5` uses `JSON5.parse`; thrown errors are mapped to diagnostics using `lineNumber`/`column` if present, else `at` via `offsetToRange`, else a whole-line range.
  - `.jsonl`/`.ndjson` parse each non-blank line separately via `jsonc-parseTree`; per-line diagnostics carry the line number directly; the value is the array of parsed values.
  - `createPreview` returns `{kind:"structured-data", format:"json", value}` on success, falls back to `partial` if invalid (still structured-data), else `{kind:"text-fallback", source, language:"json"}`.
  - `format` is variant-aware: json/jsonc re-stringify with `JSON.stringify(value, null, 2) + "\n"`, json5 parses with JSON5 then 2-space stringifies, jsonl minifies each line and skips blank lines (idempotent: no-op when source already matches).
  - `getCompletions` offers a curated package.json-style set (`"name":`, `"version":`, `"dependencies":` etc.) plus primitive values `true`/`false`/`null`.
- Created `src/documents/adapters/yaml/yaml.ts`:
  - `id:"yaml"`, `extensions:["yaml","yml"]`, `languageId:"yaml"`, `displayName:"YAML"`.
  - `parse` uses `parseDocument(source, {lineCounter: new LineCounter(), prettyErrors:true})` (non-throwing). `doc.errors` → error severity, `doc.warnings` → warning severity; each error's `linePos` (preferred) or `pos`+`LineCounter` is mapped to a 1-based `SourceRange`. On success returns `{valid:true, value:doc.toJS()}`; on failure returns `{valid:false, diagnostics, partial}` where `partial` is `doc.toJS({maxAliasCount:100})` guarded by try/catch.
  - `createPreview` returns structured-data on success or when `partial` is defined, else text-fallback so the UI still shows something.
  - `validate` returns parse diagnostics.
  - `format` re-emits via `doc.toString({indent:2, lineWidth:80})` (already includes trailing newline); idempotent when the document is already canonical; returns no edits if parsing fails.
- Created `src/documents/adapters/toml/toml.ts`:
  - `id:"toml"`, `extensions:["toml"]`, `languageId:"toml"`, `displayName:"TOML"`.
  - `parse` uses `tomlParse`; on throw, the `TomlError`'s `line`/`column` (1-based) become a whole-line range, falling back to line 1 when positions are missing. Returns `{valid:false, diagnostics:[...]}` on failure.
  - `createPreview` returns `{kind:"structured-data", format:"toml", value}` on success, `{kind:"text-fallback", source, language:"toml"}` on failure.
  - `validate` returns parse diagnostics.
  - `format` attempts `tomlStringify(value)` (smol-toml DOES export `stringify`, so the "unavailable" notice branch is only a safety net); idempotent no-op when source matches or parse fails.
- Created `src/documents/adapters/index.ts`:
  - Statically imports `markdownAdapter`, `jsonAdapter`, `yamlAdapter`, `tomlAdapter` and re-exports them.
  - `registerStaticAdapters()` (idempotent via a `staticRegistered` flag) registers all four with the singleton `documentRegistry` — called once on module import so a plain `import` is enough to wire the registry.
  - `registerAllAdapters()` is async, idempotent, and additionally tries dynamic `import("../mermaid/mermaid")`, `import("../xml/xml")`, `import("../toon/toon")` — if the sibling module exports a `register` function it is invoked, otherwise the module is silently skipped. All dynamic imports are wrapped in try/catch and use `Promise.allSettled` so a missing sibling never crashes the editor (the 3-b subagent's files land later).
  - Clear comment marker notes that mermaid/xml/toon self-register when present.
- Verified each adapter end-to-end with a temporary `bun run` smoke test (now deleted) covering: parse success/failure, preview shape per variant, format idempotency and exact output bytes, validate diagnostics' `source`/`code`/`range`, getCompletions presence, and registry resolution. All 47 assertions passed.
- Iterated on two formatter bugs found by the smoke test: (1) JSONL formatter was double-adding a trailing newline because `split("\n")` produced a trailing empty string — fixed by skipping blank lines and only appending `\n` when output is non-empty; (2) YAML formatter was appending an extra `\n` on top of `Document.toString()`'s built-in trailing newline — fixed by trusting the YAML library's own EOL.
- Ran `bun run lint` against the whole project — only 2 errors remain (in `src/features/workbench/hooks.ts`, owned by another agent). My 5 adapter files produce zero lint errors when targeted directly.
- Ran `bunx tsc --noEmit` against the whole project — only pre-existing errors remain (in `examples/*`, `skills/*`, and the 3-c route's dynamic `@/documents/adapters/toon/toon` import path — the 3-b subagent's file). My 5 adapter files produce zero TypeScript errors.

Stage Summary:

- Files created:
  - `src/documents/adapters/markdown/markdown.ts` (Markdown adapter: MD018/MD009 lint + EOL normaliser formatter)
  - `src/documents/adapters/json/json.ts` (JSON family adapter: json, jsonc, json5, jsonl, ndjson + offsetToRange helper)
  - `src/documents/adapters/yaml/yaml.ts` (YAML adapter using `parseDocument` + `LineCounter`)
  - `src/documents/adapters/toml/toml.ts` (TOML adapter using smol-toml `parse`/`stringify`)
  - `src/documents/adapters/index.ts` (static registration of the four + `registerAllAdapters()` dynamic loader)
- Adapters registered: `markdown`, `json`, `yaml`, `toml` (all four wired into the singleton `documentRegistry` on module import; `registerAllAdapters()` additionally probes for `mermaid`/`xml`/`toon` siblings without breaking when absent).
- Lint status: pass (zero errors across all 5 created files; the 2 remaining project lint errors are in `src/features/workbench/hooks.ts` and are owned by another agent).
- TypeScript: pass (zero errors across all 5 created files).
- Key decisions:
  - All diagnostics use 1-based line/column per `core/types.ts`; whole-line ranges use `endColumn = Number.MAX_SAFE_INTEGER` when only the line is known.
  - Markdown is intentionally permissive (`parse` always succeeds) — diagnostics are advisory (warning/info) and never block the editor.
  - JSON family is fault-tolerant: jsonc-parser returns a partial value even on error, exposed as `result.partial` so the live preview can render something useful while still flagging the errors.
  - JSONL/NDJSON are treated as one value per line, with diagnostics scoped to the offending line (offset translated against that single line, not the whole document).
  - YAML uses `LineCounter` so even errors without `linePos` get accurate ranges via the parser's character offset.
  - TOML's `TomlError` already exposes 1-based `line`/`column`; the "stringify unavailable" info-diagnostic branch is preserved as defence-in-depth even though smol-toml does export `stringify`.
  - The formatter contract is idempotent and safe: when the parsed value can't be re-emitted safely (parse failure or stringify throw), the formatter returns `edits:[]` and the original `source` unchanged — no destructive rewrites.
  - Registry registration happens as a side effect of importing `src/documents/adapters/index.ts`, so any caller that touches the adapter barrel gets a fully-wired registry. `registerAllAdapters()` is the explicit async entry point that the UI shell can call on boot to also pick up the 3-b subagent's diagram/xml/toon adapters once they land.

---
Task ID: FINAL
Agent: orchestrator (main)
Task: Build out the UI shell, all panel components, sample workspace, persistence, wire everything in src/app/page.tsx, and verify end-to-end with Agent Browser.

Work Log:

- Created sample workspace (src/platform/filesystem/sample-workspace.ts) with 10 files covering every supported format.
- Implemented WorkspaceFileSystem contract + InMemoryWorkspace (always-available fallback) + FileSystemAccessWorkspace (real FSA API when browser supports it) + pickDirectory helper + isFileSystemAccessSupported feature detector.
- Built IndexedDB persistence (recent-workspaces, recovery-drafts, settings) via idb.
- Built useWorkspaceController hook that opens the sample workspace on boot, lazily loads directory children, persists dirty drafts every 5s, and restores drafts on workspace re-open.
- Built document adapter bootstrap.ts that registers all adapters (markdown, json, yaml, toml, mermaid, xml, toon) on the client.
- Built the WorkspaceShell layout:
  - Sticky-footer-aware root: `flex h-screen w-full flex-col overflow-hidden`
  - main (flex-1, min-h-0) containing ResizablePanelGroup [Explorer | EditorArea | PreviewPane]
  - Diagnostics panel as a fixed-height (200px) bottom strip
  - AI Assistant sidebar (360px) visible on lg+ screens
  - StatusBar footer (h-7)
  - Command palette + welcome overlay
- Built FileExplorer with lazy directory loading, file/directory icons, dirty indicators, new file / new folder actions, fuzzy filter.
- Built EditorTabs with close confirmation on dirty tabs.
- Built EditorPane using @monaco-editor/react (dynamic, ssr:false) with debounced parse+validate pipeline that pushes diagnostics to Monaco markers and the store. Stale-result guard via revision comparison.
- Built PreviewPane with Preview/Source toggle and dispatching to Markdown / StructuredData / Mermaid / XmlTree / TextFallback renderers.
- Built Markdown renderer that pre-splits mermaid code fences so react-markdown doesn't try to nest <pre> inside <p> (which caused the React hydration error initially).
- Built Mermaid renderer (dynamic import of mermaid v12, securityLevel:"strict").
- Built StructuredData renderer (recursive collapsible tree with type-aware icons).
- Built XmlTree renderer (element vs attribute awareness).
- Built TextFallback renderer (raw <pre> with monospace).
- Built DiagnosticsPanel showing aggregated diagnostics with severity icons and source codes.
- Built AIAssistant panel with: streaming chat (SSE consumption), five structured actions (Explain, Fix, Convert, Generate-Diagram, Improve-Docs), proposed-edit review-and-apply UI (never auto-applied), cancel button.
- Built CommandPalette (cmdk) with fuzzy file search + action commands (Save, Save all, Toggle explorer/preview/AI/diagnostics, Theme switch, Open local folder, Open sample workspace, New file, Refresh).
- Built StatusBar footer with workspace name, active file, dirty count, diagnostics summary, AI provider status, theme toggle.
- Built ThemeProvider that toggles `dark` class on <html>.
- Built ErrorBoundary (React class component) to catch render errors so the page shows a useful message instead of the Next.js global-error overlay.
- Added keyboard shortcuts: Cmd+P (palette), Cmd+B (explorer), Cmd+J (diagnostics), Cmd+Shift+A (AI), Cmd+S (save active).
- Exposed workspace controller via window.__workbenchController for the command palette.

Bugs caught and fixed during Agent Browser verification:

1. Monaco "Cannot add model because it already exists" — was calling createModel manually in onMount while @monaco-editor/react also creates one via the `path` prop. Removed manual createModel; let @monaco-editor/react own models.
2. react-markdown v10 hydration error "<pre> cannot be a descendant of <p>" — was rendering my own <pre><code> inside the `code` component, but react-markdown v10 already wraps block code in <pre>. Fixed by pre-splitting mermaid segments and not customising the `code` component.
3. Zustand infinite re-render warning "getSnapshot should be cached" — selector functions were returning fresh arrays on every state read (Object.values(...).flat()). Fixed by reading the stable map ref and memoising the derived array.
4. Sticky footer hidden below viewport — ResizablePanelGroup was adding inline `height: 100%` that overrode the `h-[200px]` className on the bottom diagnostics panel. Replaced the bottom ResizablePanelGroup with a plain div with `h-[200px] shrink-0`.
5. ScrollArea `viewportRef` prop warning — shadcn ScrollArea doesn't accept viewportRef; replaced with a native div with overflow-y-auto.
6. XML adapter only handled `.xml`; added `.xsd` (and `.svg`, `.xsl`, `.rss`, `.atom`) so the sample config.xsd opens in the XML tree preview.

Stage Summary:

- Files created in this stage (in addition to subagent-produced adapters & AI routes):
  - src/app/page.tsx (rewritten to load WorkbenchShell dynamically with ssr:false inside ErrorBoundary)
  - src/app/layout.tsx (metadata updated)
  - src/documents/bootstrap.ts (registers all adapters on the client)
  - src/documents/adapters/index.ts (re-exports all adapter singletons)
  - src/platform/filesystem/sample-workspace.ts
  - src/platform/filesystem/workspace-fs.ts
  - src/platform/filesystem/use-workspace-controller.ts
  - src/platform/persistence/persistence.ts
  - src/features/workbench/store.ts
  - src/features/workbench/hooks.ts
  - src/features/workbench/shell/workbench-shell.tsx
  - src/features/workbench/shell/theme-provider.tsx
  - src/features/workbench/shell/welcome-overlay.tsx
  - src/features/workbench/shell/error-boundary.tsx
  - src/features/workbench/file-explorer/file-explorer.tsx
  - src/features/workbench/tabs/editor-tabs.tsx
  - src/features/workbench/editor/editor-pane.tsx
  - src/features/workbench/editor/editor-empty-state.tsx
  - src/features/workbench/preview/preview-pane.tsx
  - src/features/workbench/diagnostics/diagnostics-panel.tsx
  - src/features/workbench/ai-assistant/ai-assistant.tsx
  - src/features/workbench/command-palette/command-palette.tsx
  - src/features/workbench/status-bar/status-bar.tsx
  - src/lib/preview-renderers/markdown-renderer.tsx
  - src/lib/preview-renderers/mermaid-renderer.tsx
  - src/lib/preview-renderers/structured-data-renderer.tsx
  - src/lib/preview-renderers/xml-tree-renderer.tsx
  - src/lib/preview-renderers/text-fallback-renderer.tsx

- Lint: PASS (0 errors, 0 warnings).
- End-to-end Agent Browser verification:
  1. Initial load — sample workspace auto-opens, README.md opens in editor, Markdown preview renders correctly with headings, paragraphs, lists, blockquote, inline code, mermaid diagram. ✅
  2. Open all 8 sample files — each tab opens, preview switches to the correct format:
     - README.md → Rendered Markdown
     - package.json → Structured data (json)
     - config.yaml → Structured data (yaml)
     - pyproject.toml → Structured data (toml)
     - manifest.toon → Structured data (toon)
     - architecture.mmd → Diagram (mermaid)
     - events.jsonl → Structured data (json) (JSONL parsed as array)
     - config.xsd → XML tree
     ✅
  3. Diagnostics panel — "No problems detected" for valid files. ✅
  4. Command palette (Cmd+P) — opens, shows all files + actions, fuzzy filter works. ✅
  5. Theme toggle — dark ↔ light, persisted via IndexedDB. ✅
  6. AI Assistant — "AI connected" status; chat sends POST /api/ai/chat; SSE stream returns delta chunks; UI displays "Assistant: 2 + 2 = 4" after ~4s. ✅
  7. Sticky footer — verified: footer bottom = 900 = viewport height; main = 672px; bottom panel = 200px; footer = 28px; sums to 900. ✅
  8. Console errors — none. ✅
  9. AI backend tested via curl: /api/ai/models returns the model list; /api/ai/chat streams deltas correctly.

- Dev server: running on port 3000 via `bun run dev`. Lint clean. Ready for preview.

---
Task ID: WS-SWITCHER
Agent: orchestrator (main)
Task: Add visible UI to switch workspace/project/directory (was missing — only command palette had the actions).

Work Log:

- Added `closeAllTabs` action to the workbench store so switching workspaces doesn't leave stale tabs from the previous workspace.
- Added `confirmSwitchWorkspace()` helper to the workspace controller — prompts before switching when there are unsaved changes (recovery drafts are still preserved in IndexedDB).
- Updated `openSampleWorkspace` and `openLocalDirectory` to call `closeAllTabs` and `confirmSwitchWorkspace` before opening the new workspace.
- Created `src/features/workbench/shell/workspace-switcher.tsx`:
  - Dropdown button (Radix DropdownMenu) with current workspace info, "Open local folder…", "Open sample workspace", and a "Recent" list (loaded from IndexedDB on open).
  - Recent workspaces are clickable to reopen. For in-memory (sample) workspaces we reopen directly; for FSA workspaces we re-trigger the picker because browser security prevents persisting the handle across sessions.
  - Each recent item has a relative timestamp ("just now", "5m ago", "2d ago") and an × button to remove it from recents.
  - `variant="compact"` for the status bar; `variant="default"` for the explorer.
- Wired into `FileExplorer`:
  - Added an always-visible "Open folder…" icon button in the explorer header (FolderOpen icon, before New file/New folder/Refresh).
  - Replaced the static workspace name row with the `<WorkspaceSwitcher />` dropdown.
- Wired into `StatusBar`:
  - Replaced the static workspace name + source span with `<WorkspaceSwitcher variant="compact" />`.

Stage Summary:

- Files added: src/features/workbench/shell/workspace-switcher.tsx
- Files modified:
  - src/features/workbench/store.ts (added closeAllTabs action + interface decl)
  - src/platform/filesystem/use-workspace-controller.ts (confirmSwitchWorkspace + closeAllTabs on switch)
  - src/features/workbench/file-explorer/file-explorer.tsx (FolderOpen button + WorkspaceSwitcher)
  - src/features/workbench/status-bar/status-bar.tsx (compact WorkspaceSwitcher)
- Lint: PASS.
- Agent Browser verification:
  - Explorer header has a FolderOpen button (always visible, disabled if FSA API unavailable). ✅
  - Clicking the workspace switcher opens a dropdown with: current workspace info, Open local folder…, Open sample workspace, Recent list. ✅
  - Clicking "Open sample workspace" in the menu reopens the sample workspace (closeAllTabs fired, fresh state). ✅
  - The same switcher is in the status bar (compact variant) — opens the same dropdown. ✅
  - Sticky footer still works: footerBottom === viewportHeight (900 === 900). ✅
  - No console errors. ✅
- Dev server: running on port 3000 via `bun run dev`.
