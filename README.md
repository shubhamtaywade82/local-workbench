# Local-First AI Document Editor

A powerful, local-first document editor with AI assistance, built with Next.js 16, React 19, and Monaco Editor. Features a VS Code-like interface with file explorer, tabs, live preview, diagnostics, and an AI assistant panel.

## Features

- **Multi-format Support**: Markdown, JSON, YAML, TOML, XML, Mermaid, TOON, and plain text
- **Live Preview**: Real-time rendered preview for all supported formats
- **Live view**: A Code/Live toggle in the tab bar. In Live, a Markdown document is rendered block by block: click a block to edit its source with a side-by-side preview, and use **Suggest** for an AI rewrite of that block, which you accept or discard as a diff. Other formats show the read-only preview.
- **File Explorer**: Tree view with lazy loading, workspace switching, and recent workspaces
- **Editor Tabs**: Monaco-based editor with dirty indicators and keyboard shortcuts
- **AI Assistant**: Streaming chat plus Explain, Fix, Convert, Improve, Diagram, Archify diagram and architecture review. Edits arrive as reviewable proposals, and nothing is written until you apply one
- **Responsive layouts**: three panes on desktop, the assistant as a sheet on tablets, and Editor / Preview tabs with sheets on phones
- **Command Palette**: Fuzzy file search and actions (⌘/Ctrl + P)
- **Diagnostics Panel**: Problems view with severity levels
- **Archify live diagrams**: ten Archify diagram types rendered live from their JSON IR (see below)
- **Local-First**: File System Access API for direct disk access (Chrome/Edge)
- **Sample Workspace**: 10 pre-loaded files covering all formats
- **Persistence**: IndexedDB for recent workspaces, recovery drafts, and settings

## Tech Stack

| Layer | Technology |
| ------- | ------------ |
| Framework | Next.js 16 (App Router, Turbopack) |
| Runtime | Bun (recommended) / Node.js 22+ |
| Language | TypeScript 5 |
| Styling | Tailwind CSS 4 + shadcn/ui |
| Editor | Monaco Editor (React wrapper) |
| State | Zustand |
| Database | Prisma + SQLite |
| AI SDK | OpenAI Node.js SDK + @nemesis-oss/ollama-sdk (OpenAI-compatible Chat Completions API) |
| File System | File System Access API + in-memory fallback |

## Prerequisites

| Tool | Version | Notes |
| ------ | --------- | ------- |
| Node.js | 22+ | Required by the OpenAI SDK |
| Bun | 1.3+ | Recommended for fastest installs |
| Git | Any | For cloning |
| Chrome/Edge | Recent | Required for File System Access API |

## Quick Start

```bash
# 1. Clone the repository
git clone <your-repo-url> local-workbench
cd local-workbench

# 2. Install dependencies
bun install    # or npm install / pnpm install

# 3. Configure AI backend (optional)
# Set OPENAI_API_KEY in your environment or .env.local
# Optional: OPENAI_BASE_URL and OPENAI_MODEL for compatible endpoints/models

# 4. Set up database (optional)
bun run db:push     # Creates SQLite DB
bun run db:generate # Generates Prisma client

# 5. Start development server
bun run dev        # or npm run dev

# 6. Open http://localhost:3000 in Chrome/Edge
```

## AI Configuration

The AI Assistant uses the OpenAI Chat Completions API (via the standard `openai` SDK) and supports **Ollama** for local inference via `@nemesis-oss/ollama-sdk`.

### Option 1: OpenAI / OpenAI-compatible (cloud)

```dotenv
AI_PROVIDER=openai
OPENAI_API_KEY=your-api-key
# Optional; defaults to the OpenAI API URL
OPENAI_BASE_URL=https://api.openai.com/v1
# Optional; defaults to gpt-4o-mini
OPENAI_MODEL=gpt-4o-mini
```

Works with any OpenAI-compatible endpoint (OpenAI, Azure, Together, Groq, Fireworks, etc.).

### Option 2: Ollama (local, no API key needed)

```dotenv
AI_PROVIDER=ollama
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=llama3.1:8b
```

Requires [Ollama](https://ollama.ai) running locally. Pull a model first:

```bash
ollama pull llama3.1:8b
```

The integration uses `@nemesis-oss/ollama-sdk`'s `OpenAICompatClient` (`/v1/chat/completions`) behind the same typed `ChatCompletionsClient` used for OpenAI (`src/lib/ai/server.ts`), so every AI task (chat, explain, fix, convert, improve, diagram, Archify diagram, architecture review) works identically. Note that `OpenAICompatClient` is **not** shape-compatible with the `openai` SDK (it exposes `createChatCompletion`, not `chat.completions.create`); the adapter in `server.ts` bridges the two.

For multiple Ollama hosts / Ollama Cloud keys with failover, see `OLLAMA_ENDPOINTS` in `.env.example` (higher `priority` is tried first). `OLLAMA_TIMEOUT_MS` (default `120000`) bounds the whole request, including the full streamed response.

Without a configured provider, the AI panel shows "offline" but all other features work.

### Per-action models

Each AI action can run on its own model. Set `AI_MODEL_CHAT`, `AI_MODEL_FIX`, `AI_MODEL_EXPLAIN`, `AI_MODEL_CONVERT`, `AI_MODEL_DIAGRAM` or `AI_MODEL_IMPROVE`. An action without a variable uses the default model. The overrides apply to whichever provider is active, so use names that provider serves. An invalid name is logged and ignored.

Example with the MiniCPM5 variants from [agent-tui](https://github.com/shubhamtaywade82/agent-tui) (`supervisor/modelfiles/`, built with `supervisor/scripts/seed-models.sh`):

| Action | Variable | Suggested variant | Why |
|---|---|---|---|
| Chat | `AI_MODEL_CHAT` | `minicpm5-reasoning` | Multi-step answers; no stop sequences |
| Fix | `AI_MODEL_FIX` | `minicpm5-coding-agent` | 16K context and 4096 output tokens for whole-file edits |
| Explain | `AI_MODEL_EXPLAIN` | `minicpm5-summarizer` | Condensed explanations |
| Convert | `AI_MODEL_CONVERT` | `minicpm5-coding-agent` | Code and format conversion |
| Diagram | `AI_MODEL_DIAGRAM` | `minicpm5-coding-agent` | Mermaid is code |
| Improve docs | `AI_MODEL_IMPROVE` | `minicpm5-low-repetition` | Prose; compare with `minicpm5-coding-agent` |

- **Do not assign code-returning actions** to `minicpm5-analyst`, `minicpm5-long-context`, `minicpm5-toolagent` or `minicpm5-tool-agent`. Their Modelfiles stop generation at a code fence (```` ``` ````), which cuts fenced code off.
- **Do not assign `minicpm5-cloud-escalation`.** It prepares prompts for a cloud model, and this app keeps prompts on the machine.
- **Unverified:** whether a request's system message replaces the Modelfile's system prompt. If it does, a variant's prompt rules do not apply to these routes, and only its parameters take effect. Test it with `curl` against `/api/chat` before relying on the variant prompts.

### Generative UI (experimental, OpenUI Lang)

With `AI_GENERATIVE_UI=1`, chat and **Explain** answers may include interactive UI built from a small workbench component library: `Stack`, `Card`, `Text`, `Callout`, `KeyValue`, `Table`, `CodeBlock`, `ProposedEdit`. The model writes [OpenUI Lang](https://www.openui.com/docs/openui-lang) in fenced ```` ```openui-lang ```` blocks (inline mode: plain text by default); `@openuidev/react-lang`'s `Renderer` draws them progressively as they stream.

- **Single contract:** `src/lib/ai/generative-ui/components.ts` defines names, descriptions and zod prop schemas once. The server builds the system prompt from it (`prompt.ts`, no React), and the client attaches shadcn renderers (`src/features/workbench/ai-assistant/generative-ui/library.tsx`). No CLI-generated spec to keep in sync.
- **Edits stay review-only:** `ProposedEdit` never writes. Its *Review diff* button emits a `workbench.propose_edit` action, which fills the existing diff-then-Apply flow for the document the message was generated against. All other action types (`OpenUrl`, …) are ignored.
- **Only `openui-lang` fences are UI:** ```` ```json ````/```` ```yaml ```` blocks stay text (`segments.ts`). A finished block that parses to nothing falls back to showing its source.
- **Opt-in on both sides:** the server flag gates the prompt; the client asks for it per request, and the `generativeUi` field of the text result confirms it was used. With the flag off, prompts and responses are unchanged.
- **Cost:** the component prompt is about 1.4k tokens. On Ollama, raise the context window on the server (e.g. `OLLAMA_CONTEXT_LENGTH=8192`), or long documents will be truncated silently.
- **Measure before enabling:** `bun run eval:genui -- --runs 3 --min-rate 0.8` runs the real prompt against your configured model and reports the clean-parse rate.
- **Not used:** OpenUI Gateway and Autofix (paid Thesys cloud, would send prompts off-box) and `@openuidev/react-ui` (requires zustand 4; this app uses zustand 5).
- **Telemetry:** `@openuidev/lang-core` sends pseudonymous install telemetry from its `postinstall` script unless `OPENUI_TELEMETRY_DISABLED=1` (or `DO_NOT_TRACK=1`) is set. Runtime telemetry is opt-in and stays off.

## Server Workspace (WSL, Docker, remote dev boxes)

The browser's folder picker can only open folders the browser can reach directly, which makes folders inside WSL slow and awkward. A **server workspace** instead edits files on the machine running the Next.js server. Run the workbench *inside* WSL and open WSL folders from your Windows browser:

```bash
# inside WSL
export WORKSPACE_ROOTS=/home/you/projects,/home/you/notes
bun run dev            # then open http://localhost:3000 in your Windows browser
```

The roots appear under **Server folders** in the workspace switcher and reopen from **Recent** without a picker or permission prompt. Files are read and written natively in WSL; saves are atomic (temp file + rename).

| Variable | Default | Purpose |
|---|---|---|
| `WORKSPACE_ROOTS` | unset (feature off) | Comma-separated absolute directories. Only files inside these are reachable. |
| `WORKSPACE_MAX_FILE_BYTES` | `5242880` | Largest file that can be opened or saved. |
| `WORKSPACE_ALLOWED_HOSTS` | — | Extra `Host` names to accept (by default only `localhost`, `127.0.0.1`, `[::1]`). |

**Security model** (`src/lib/server-fs/`): this gives a web page read/write access to your disk, so the API is locked down.
- Off unless `WORKSPACE_ROOTS` is set: the `/api/fs` routes return 404.
- Every client path is validated in one place. Absolute paths, `..`, NUL bytes and symlinks resolving outside a root are rejected. Symlinks pointing outside are also hidden from listings.
- Requests must come from this app on this machine. The `Host` allowlist blocks DNS rebinding, `Origin` must match, and a custom `X-Workbench-FS` header plus a JSON body force a CORS preflight, which the server never grants. Cross-site fetch metadata is rejected.
- Text files only (binary files are refused). Size limits apply to both reads and request bodies. Deleting a symlink removes the link, never its target. Real paths are never sent to the browser.

Not watched: changes made outside the workbench appear after reopening the folder (or refreshing the explorer).

## Project Structure

```
src/
├── app/
│   ├── api/ai/              # /api/ai/task (streamed AI tasks) and /api/ai/models (provider status)
│   ├── api/archify/render/  # Archify live-diagram render (server-side)
│   ├── layout.tsx
│   └── page.tsx             # Entry point, loads WorkbenchShell
├── documents/
│   ├── core/                # Framework-agnostic types, registry, session
│   ├── adapters/            # Format adapters (markdown, json, yaml, toml, mermaid, xml, toon)
│   └── bootstrap.ts         # Registers all adapters on client
├── features/workbench/
│   ├── shell/               # WorkbenchShell (desktop, tablet and phone layouts), header, WorkspaceSwitcher
│   ├── file-explorer/       # Lazy tree + workspace switcher
│   ├── tabs/                # Editor tabs with dirty indicators
│   ├── editor/              # Monaco wrapper (dynamic, ssr:false)
│   ├── preview/             # PreviewPane dispatching to renderers
│   ├── diagnostics/         # Problems panel
│   ├── ai/                  # Assistant store and controller, document port, workspace snapshot
│   ├── ai-assistant/        # Panel, thread, composer, and proposal / Archify / review views
│   ├── dialogs/             # Confirm and prompt dialogs (replace native confirm and prompt)
│   ├── command-palette/     # Cmdk fuzzy search + actions
│   ├── status-bar/          # Sticky footer + workspace switcher
│   ├── store.ts             # Zustand store (tabs, sessions, diagnostics, layout)
│   └── hooks.ts             # useDebounced / useDebouncedWithPending
├── lib/preview-renderers/   # Markdown / StructuredData / Mermaid / XmlTree / TextFallback
├── lib/ai/                  # Task contract, runner, parsers, SSE endpoint (tasks/), browser client (client/), provider clients (server.ts), generative UI (generative-ui/)
├── lib/archify/             # Archify contract, detection, render service (server-only parts marked)
├── platform/
│   ├── filesystem/          # WorkspaceFileSystem contract + In-memory & FSA impls
│   └── persistence/         # IndexedDB (recent workspaces, recovery drafts, settings)
└── components/ui/           # shadcn/ui components
```

## Keyboard Shortcuts

| Shortcut | Action |
| ---------- | -------- |
| `⌘/Ctrl + P` | Open command palette |
| `⌘/Ctrl + B` | Toggle Explorer panel |
| `⌘/Ctrl + J` | Toggle Diagnostics panel |
| `⌘/Ctrl + Shift + A` | Toggle AI Assistant panel |
| `⌘/Ctrl + S` | Save active file |

## Responsive Layouts

| Width | Layout |
| --- | --- |
| 1280 px and wider | Files, editor, preview and assistant side by side. Each pane resizes, and the sizes are remembered in the browser. |
| 768 to 1279 px | Files, editor and preview side by side. The assistant opens as a sheet. |
| Under 768 px | One pane at a time, switched with the Editor and Preview tabs. Files, problems and the assistant open as sheets. |

The keyboard shortcuts work at every width. On phones the status bar shows problem counts as icons beside their numbers.

## AI Assistant

The assistant sends every request to one endpoint, `POST /api/ai/task`. The document and workspace text reach the model as delimited data, and the prompt tells the model to treat them as data, not instructions.

- **Chat** streams its answer with the open document as context. Long documents are windowed to 48,000 characters: the first 20 lines stay, and a window around the cursor or the first problem fills the rest. When the history is full, the oldest turns drop first.
- **Explain** describes the open document and flags ambiguous parts.
- **Fix** proposes a corrected document. It opens as a proposal with a diff, Apply and Discard.
- **Improve** rewrites Markdown in a concise, detailed or friendly tone, keeping its structure and code blocks.
- **Convert** targets JSON, JSONC, JSON5, YAML, TOML, TOON, XML or Markdown. A supported pair converts in-process and is labelled "No model used". Any other pair goes to the model, and the result is labelled as model output. The result is saved as a new file with the target extension, and the source is left as it is.
- **Diagram** writes a Mermaid flowchart, sequence, state, ER or class diagram to `diagrams/<slug>.mmd`.
- **Archify diagram** generates an Archify IR document for one of the ten diagram types. Each attempt is checked by Archify's delivery gate, and the gate's messages go back to the model, for up to three attempts. Save as a new file keeps a diagram that still fails the gate, and its preview shows the failure. Replacing the open document needs a diagram that passed the gate, and a confirmation.
- **Architecture review** reads a bounded workspace snapshot (60 files, 4,000 characters each, 120,000 in total) and returns up to six candidates. Each candidate is rated Strong, Worth exploring or Speculative, and carries its files, problem, solution, wins, and before and after Mermaid diagrams. **Explore** sends a candidate to the chat as a follow-up.

Proposals and safety:

- **Apply** writes through the editor, so **Ctrl+Z** undoes it.
- If the document changed after the proposal was made, Apply asks before it replaces the newer text.
- **Stop** cancels the run. The partial answer stays, marked as stopped.
- Without a provider, the panel says why, and the rest of the workbench works.

## AI Task API

`POST /api/ai/task` takes an `application/json` body of at most 6 MiB. Its `task` field is one of `chat`, `explain`, `fix`, `convert`, `improve-docs`, `generate-diagram`, `archify-diagram` or `architecture-review`. A request that fails validation gets HTTP 400 (`invalid-request`, with an `issues` list) or 413 (`too-large`) before anything runs. An accepted request streams `text/event-stream` frames, each one a `data: {json}` line:

| Event | Fields | Meaning |
| --- | --- | --- |
| `status` | `message` | Progress, such as a conversion going to the model. |
| `delta` | `text` | A chunk of streamed text. |
| `result` | `result` | The final value: `text`, `edit`, `archify` or `review`. |
| `error` | `code`, `message` | The run failed. `code` is `provider-unavailable`, `provider-error`, `runtime-unavailable`, `unparseable-output` or `internal`. |

A closed connection cancels the run, so no model call outlives the page that asked for it. `GET /api/ai/models` reports the configured provider, whether it is available, the reason when it is not, and the models it offers.

## Archify Live Diagrams

Open an [Archify](https://github.com/tt-a1i/archify) IR document (a `.json` file whose top-level `diagram_type` is `architecture`, `workflow`, `sequence`, `dataflow`, `lifecycle`, `erd`, `tree`, `class`, `timeline` or `waterfall`) and the preview pane renders it as an interactive diagram. Edits re-render after a short pause. The sample workspace includes one (`diagrams/local-workbench.architecture.json`).

- **Verified output only.** HTML is shown only after Archify's delivery gates pass (schema, layout, HTML/SVG and route checks) and the receipt's digest matches the rendered bytes.
- **The last good revision stays.** An incomplete or invalid edit keeps the last verified diagram on screen, with the failure above it. Each failure shows Archify's rule code and its supported fix, and the same entries appear in **Problems**.
- **Quality profiles.** `showcase` (default) fails composition issues. `standard` reports them as warnings. Warnings appear in the preview and in Problems.
- **Download HTML** saves the verified, self-contained file. Nothing is written to your workspace.
- **Sandboxed.** The diagram runs in a frame that allows scripts only, with no access to the workbench's origin, storage or cookies.

**How it works.** `POST /api/archify/render` receives the editor draft (never a file path) and runs Archify's own `deliver --json` pipeline, the same gate `archify preview` uses, in a private temporary directory. The runtime is the vendored Archify 3.2.0 tree in `vendor/archify`, which runs under Node.js 18 or later (`node` on `PATH` when the server itself runs under Bun). Archify's update check is disabled for these renders. The browser keeps the last verified revision; the server caches identical renders.

| Setting | Default | Purpose |
|---|---|---|
| `ARCHIFY_RENDER_TIMEOUT_MS` | `20000` | Wall-clock budget for one render (minimum 1000). |
| Document size | 1 MiB | Larger documents are refused before Archify starts. |
| Concurrency | 2 running, 8 queued | Further renders are answered `busy` and retried on the next edit. |

**Not supported in the live preview.**
- Explainer documents (Archify's Markdown-based explainer type). Use the Archify CLI.
- Repository evidence (`sources`). Without a pinned `meta.repository`, Archify reports `repository-evidence/repository-required`.
- Remote brand captures (`brand: { url, sha256 }`). Archify would fetch that URL while rendering, so the workbench refuses it with `brand/remote-capture-disabled`. Built-in brand IDs work (`archify brands` lists them).

**Updating the runtime.** The runtime is a pinned copy of the Archify Skill's runtime files. `vendor/archify/VENDOR.json` records the upstream version and commit, and the Apache-2.0 license and notices are included.

```bash
node scripts/sync-archify.mjs --from /path/to/tt-a1i/archify          # copy the runtime subset
node scripts/sync-archify.mjs --from /path/to/tt-a1i/archify --check  # verify it matches the checkout
```

After syncing, run `bun run test`. The archify tests render all ten fixtures through the vendored runtime.

## Browser Support

| Browser | Sample Workspace | Open Local Folder |
| --------- | ------------------ | ------------------- |
| Chrome Desktop | ✅ | ✅ |
| Edge Desktop | ✅ | ✅ |
| Opera Desktop | ✅ | ✅ |
| Firefox | ✅ | ❌ |
| Safari | ✅ | ❌ |
| Mobile Chrome | ✅ | ❌ |

Without FSA support, "Open folder…" is disabled — sample workspace still works.

## Available Scripts

```bash
bun run dev        # Start dev server (port 3000)
bun run build      # Production build (standalone output)
bun run start      # Start production server
bun run lint       # Run ESLint
bun run lint --fix # Auto-fix lint errors
bun run test       # Unit tests (bun test)
bun run eval:genui # Generative-UI reliability eval against the configured model
bun run db:push    # Push schema to SQLite
bun run db:generate # Generate Prisma client
bun run db:migrate # Run migrations
bun run db:reset   # Reset database
```

## Production Build

```bash
bun run build    # Outputs to .next/standalone/
bun run start    # Runs standalone server
```

The `next.config.ts` has `output: "standalone"` for self-contained deployment.

## Troubleshooting

| Issue | Solution |
| ------- | ---------- |
| AI shows "offline" | The assistant panel shows the reason. Set `OPENAI_API_KEY` (or `AI_PROVIDER=ollama`) in the server environment |
| "Open folder…" disabled | Use Chrome/Edge desktop; Firefox/Safari use sample workspace |
| Dev server dies on terminal close | Use `nohup bun run dev > dev.log 2>&1 & disown` or `tmux`/`screen` |
| Monaco loads forever | Monaco is fetched from cdn.jsdelivr.net at runtime, so the editor needs network access. There is no bundled offline copy yet |
| Hot reload stuck | Restart dev server; clear cache: `rm -rf .next` |

## License

MIT
