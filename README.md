# Local-First AI Document Editor

A powerful, local-first document editor with AI assistance, built with Next.js 16, React 19, and Monaco Editor. Features a VS Code-like interface with file explorer, tabs, live preview, diagnostics, and an AI assistant panel.

## Features

- **Multi-format Support**: Markdown, JSON, YAML, TOML, XML, Mermaid, TOON, and plain text
- **Live Preview**: Real-time rendered preview for all supported formats
- **File Explorer**: Tree view with lazy loading, workspace switching, and recent workspaces
- **Editor Tabs**: Monaco-based editor with dirty indicators and keyboard shortcuts
- **AI Assistant**: Chat + 5 structured actions (Explain, Fix, Convert, Diagram, Improve)
- **Command Palette**: Fuzzy file search and actions (⌘/Ctrl + P)
- **Diagnostics Panel**: Problems view with severity levels
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

The integration uses `@nemesis-oss/ollama-sdk`'s `OpenAICompatClient` (`/v1/chat/completions`) behind the same typed `ChatCompletionsClient` used for OpenAI (`src/lib/ai/server.ts`), so all AI actions (chat, explain, fix, convert, diagram, improve) work identically. Note that `OpenAICompatClient` is **not** shape-compatible with the `openai` SDK (it exposes `createChatCompletion`, not `chat.completions.create`); the adapter in `server.ts` bridges the two.

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
- **Opt-in on both sides:** the server flag gates the prompt; the client requests it and the response header `X-Generative-UI` confirms it. With the flag off, prompts and responses are unchanged.
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

## Desktop App (Electron)

The workbench also runs in its own window, opened from a `local-workbench` command. The web app is unchanged.

```bash
bun run desktop:build                       # production build + Electron bundle
bun run desktop:install-cli                 # links local-workbench into ~/.local/bin (Linux/macOS, and WSL)

local-workbench                             # focus the app, or open a folder picker
local-workbench ~/projects/crypto-agent     # open a folder
local-workbench notes/plan.md               # open a file; its folder becomes the workspace
local-workbench --new-window ~/notes        # always open a new window
```

- **One app per user.** A second `local-workbench` call forwards its path to the running app. A folder that is already open is focused; a file inside an open folder opens in that window; any other folder opens a new window.
- **Scoped filesystem.** Each window is bound to one folder. `..`, absolute paths and symlinks that leave the folder are refused.
- **No silent overwrites.** A save that conflicts with a change on disk asks first: overwrite the disk version, load the disk version (discarding your edits, after a second confirmation), or keep editing. Nothing is written unless you choose so.
- **Loopback server.** The app starts its own Next.js server on `127.0.0.1` and remembers its port, so recovery drafts survive restarts. `/api/*` requires a token generated per launch.
- **Content security policy.** The window only loads from the app origin; other origins and `eval` are blocked. The development server gets the relaxed policy it needs for hot reload.
- **Logs.** `desktop.log` lives in the app's log folder (Electron's `logs` path) and rotates at 5 MB, keeping three old files.
- **Development.** Run `bun run dev`, then `LOCAL_WORKBENCH_DEV_URL=http://127.0.0.1:3000 bun run desktop:start` to load the dev server instead of the production build.

### WSL

The workbench can run inside WSL with its window shown on Windows through WSLg. Install and build inside the distribution, next to your projects.

Requirements: WSL 2 with WSLg (Windows 11, or Windows 10 with WSLg), Bun 1.4.2 (the version CI uses), and git. `echo "$DISPLAY$WAYLAND_DISPLAY"` must print a value.

```bash
# inside WSL (Ubuntu)
git clone https://github.com/shubhamtaywade82/local-workbench ~/projects/local-workbench
cd ~/projects/local-workbench
bun install --frozen-lockfile
bunx prisma generate                     # the production build imports the Prisma client
node node_modules/electron/install.js    # Electron downloads its binary on first use, not during bun install
bun run desktop:build
bun run desktop:install-cli              # puts local-workbench in ~/.local/bin; add that folder to PATH if needed
local-workbench ~/projects/crypto-agent
```

If the launcher prints a `chown`/`chmod` line for `chrome-sandbox`, run that line once (see **Sandbox** below).

- **Windows paths work in WSL.** `local-workbench C:\Users\me\projects\app` becomes `/mnt/c/Users/me/projects/app`. `\\wsl.localhost\<this distribution>\home\me\app` becomes `/home/me/app`. A path inside another distribution is refused with a message.
- **From PowerShell or cmd.** Inside WSL, run `bun run desktop:install-cli -- --windows` once. It writes `local-workbench.cmd` into `%LOCALAPPDATA%\Microsoft\WindowsApps`, and the command forwards to this distribution with your current folder. Then `local-workbench .` works in PowerShell.
- **Rendering.** Hardware acceleration is off inside WSL, because Chromium's GPU path misbehaves under some WSLg drivers. `LOCAL_WORKBENCH_GPU=1` turns it back on.
- **Links.** Web links open in the Windows default browser (through `explorer.exe`).
- **Sandbox.** Ubuntu 24.04 and recent WSL images restrict user namespaces, which Electron's sandbox needs. The launcher prints the one-line fix when it detects this; the `.deb` applies it at install.
- **WSLg missing.** The launcher says so and gives the `wsl --update` / `wsl --shutdown` steps.

**Acceptance test.** Run the end-to-end test against the real launcher and window. Run it as a normal WSL user, not root, because Chromium refuses to run as root:

```bash
cd ~/projects/local-workbench
bun add --no-save playwright-core       # test client only; package.json and bun.lock stay unchanged
bun tests/desktop/acceptance.mjs
```

The last line should read `39/39 checks passed`. The test opens and closes the app window on the Windows desktop several times.

**Logs and failures.**
- Log: `~/.config/Local Workbench/logs/desktop.log`, rotated at 5 MB into `desktop.log.1` to `desktop.log.3`. Fatal errors name this file in their dialog.
- Sandbox errors after the fix above: check that `node_modules/electron/dist/chrome-sandbox` is owned by root and setuid (`ls -l` shows `-rwsr-xr-x`).
- Build fails with a Prisma error: run `bunx prisma generate`.
- A `\\wsl.localhost\...` path is refused: that path belongs to another distribution. Open it from that distribution.

### Packaging

```bash
bun run desktop:package -- --linux AppImage deb   # Linux, on Linux
bun run desktop:package -- --win nsis             # Windows installer, on Windows
bun run desktop:package -- --mac dmg              # macOS disk image, on macOS
```

Output goes to `release/dist/`. The installers are unsigned: set `CSC_LINK` and `CSC_KEY_PASSWORD` (and remove `identity: null` from `electron-builder.yml`) to sign. Installing the `.deb` creates the `local-workbench` command at `/usr/bin`.

CI (`.github/workflows/desktop.yml`) runs the checks, the end-to-end acceptance test under Xvfb on Linux, and builds each installer on its own platform runner.

### What is verified

- Linux: unit tests (192), typecheck, lint, production build, the acceptance test (39 checks) against the development build, the unpacked and AppImage builds, and the installed `.deb` (install, `--version`, acceptance, removal).
- Development server: the desktop window loads `bun run dev` with the development policy.
- WSL: the WSL code paths are exercised with simulated environment variables on Linux. They have **not** been run on a real WSL distribution, nor are Windows or macOS builds run.

## Project Structure

```
src/
├── app/
│   ├── api/ai/              # AI backend routes (server-side)
│   ├── layout.tsx
│   └── page.tsx             # Entry point, loads WorkbenchShell
├── documents/
│   ├── core/                # Framework-agnostic types, registry, session
│   ├── adapters/            # Format adapters (markdown, json, yaml, toml, mermaid, xml, toon)
│   └── bootstrap.ts         # Registers all adapters on client
├── features/workbench/
│   ├── shell/               # WorkbenchShell, ThemeProvider, WorkspaceSwitcher
│   ├── file-explorer/       # Lazy tree + workspace switcher
│   ├── tabs/                # Editor tabs with dirty indicators
│   ├── editor/              # Monaco wrapper (dynamic, ssr:false)
│   ├── preview/             # PreviewPane dispatching to renderers
│   ├── diagnostics/         # Problems panel
│   ├── ai-assistant/        # Chat + 5 structured actions
│   ├── command-palette/     # Cmdk fuzzy search + actions
│   ├── status-bar/          # Sticky footer + workspace switcher
│   ├── store.ts             # Zustand store (tabs, sessions, diagnostics, AI)
│   └── hooks.ts             # useDebounced / useDebouncedWithPending
├── lib/preview-renderers/   # Markdown / StructuredData / Mermaid / XmlTree / TextFallback
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

## AI Assistant Actions

Click action chips in the AI panel:

- **Explain** — Describes current document + flags ambiguity
- **Fix** — Proposes corrected version (review diff, click Apply/Discard)
- **Convert** — Convert between JSON/YAML/TOML/XML/TOON/Markdown
- **Diagram** — Generate Mermaid diagram from description
- **Improve** — Rewrite Markdown preserving structure & code blocks

Or chat directly in the textbox — responses stream via SSE.

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
| AI shows "offline" | Configure `OPENAI_API_KEY` in the server environment |
| "Open folder…" disabled | Use Chrome/Edge desktop; Firefox/Safari use sample workspace |
| Dev server dies on terminal close | Use `nohup bun run dev > dev.log 2>&1 & disown` or `tmux`/`screen` |
| Monaco loads forever | Check network; for offline, copy `monaco-editor/min/vs` to `public/vs` |
| Hot reload stuck | Restart dev server; clear cache: `rm -rf .next` |

## License

MIT
