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

The integration uses `@nemesis-oss/ollama-sdk`'s `OpenAICompatClient`, which provides the exact same interface as the OpenAI SDK — all AI actions (chat, explain, fix, convert, diagram, improve) work identically.

Without a configured provider, the AI panel shows "offline" but all other features work.

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
