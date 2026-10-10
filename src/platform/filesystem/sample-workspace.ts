// Sample workspace content shipped with the app. Used as the default fallback
// when the browser doesn't support the File System Access API, or when the user
// picks "Try with sample workspace" instead of opening a folder.
//
// All paths are workspace-relative (forward slashes). The keys are sorted into
// a tree by the explorer.

export interface SampleFile {
  path: string;
  content: string;
}

export const SAMPLE_WORKSPACE_NAME = "sample-workbench-project";

export const SAMPLE_FILES: SampleFile[] = [
  {
    path: "README.md",
    content: `# Local Workbench

A browser-based, workspace-aware document editor with a pluggable preview engine
and an AI development assistant.

## Features

- **Workspace IDE**: open a local directory, browse nested files, open multiple tabs
- **Live preview**: Markdown, JSON, YAML, TOML, XML, Mermaid, TOON
- **Diagnostics**: parser and linter errors with quick fixes
- **AI assistant**: explain, fix, convert, generate diagrams, improve docs

## Quick start

1. Open a file from the explorer on the left
2. Edit in the Monaco editor
3. Watch the live preview update on the right
4. Run an AI action from the assistant panel

> Tip: Use \`Cmd/Ctrl + P\` to open the command palette.

\`\`\`mermaid
flowchart LR
    A[Explorer] --> B[Editor]
    B --> C[Preview]
    B --> D[Diagnostics]
    B --> E[AI Assistant]
\`\`\`
`,
  },
  {
    path: "package.json",
    content: `{
  "name": "local-workbench",
  "version": "1.0.0",
  "description": "Browser-based local-first document editor",
  "main": "index.js",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "react": "^19.0.0",
    "react-dom": "^19.0.0",
    "monaco-editor": "^0.57.0",
    "yaml": "^2.9.1",
    "mermaid": "^12.1.0"
  },
  "devDependencies": {
    "typescript": "^5.0.0",
    "vite": "^6.0.0"
  },
  "license": "MIT"
}
`,
  },
  {
    path: "config.yaml",
    content: `app:
  name: workbench
  port: 3000
  features:
    preview: true
    ai: true
    diagnostics: true
logging:
  level: info
  destinations:
    - console
    - file
server:
  host: localhost
  cors:
    origins:
      - http://localhost:3000
`,
  },
  {
    path: "pyproject.toml",
    content: `[project]
name = "local-workbench"
version = "1.0.0"
description = "Browser-based local-first document editor"
requires-python = ">=3.10"
dependencies = [
    "fastapi",
    "uvicorn",
]

[tool.ruff]
line-length = 100
target-version = "py310"

[tool.ruff.lint]
select = ["E", "F", "I", "UP"]
`,
  },
  {
    path: "docs/architecture.mmd",
    content: `flowchart TB
    UI["Workspace UI"]
    UI --> EX["File Explorer and Tabs"]
    UI --> ED["Editor Controller"]
    UI --> PV["Preview Pane"]
    ED --> DS["Document Sessions"]
    DS --> FS["Workspace File Adapter"]
    FS --> BROWSER["Browser File System API"]
    DS --> REG["Document Adapter Registry"]
    REG --> PARSE["Parsers and Validators"]
    REG --> RENDER["Preview Renderers"]
    REG --> LINT["Diagnostics and Formatters"]
    PARSE --> PV
    RENDER --> PV
    LINT --> PROBLEMS["Problems Panel"]
    ED --> AI["AI Orchestrator"]
    PROBLEMS --> AI
    AI --> POLICY["Context and Privacy Policy"]
    POLICY --> PROVIDER["LLM Provider Interface"]
`,
  },
  {
    path: "data/team.json",
    content: `{
  "team": "platform",
  "members": [
    { "name": "Alice", "role": "lead", "tenure": 6 },
    { "name": "Bob", "role": "engineer", "tenure": 3 },
    { "name": "Carol", "role": "engineer", "tenure": 1 }
  ],
  "active": true,
  "metadata": {
    "createdAt": "2024-09-01",
    "tags": ["backend", "frontend", "devtools"]
  }
}
`,
  },
  {
    path: "data/events.jsonl",
    content: `{"id":1,"event":"open","path":"README.md"}
{"id":2,"event":"edit","path":"README.md","chars":1024}
{"id":3,"event":"save","path":"README.md"}
{"id":4,"event":"preview","path":"docs/architecture.mmd"}
{"id":5,"event":"ai","action":"explain","path":"config.yaml"}
`,
  },
  {
    path: "notes/todo.md",
    content: `# TODO

- [x] Build document adapter registry
- [x] Implement Markdown preview
- [ ] Add TOON round-trip tests
- [ ] Wire AI assistant streaming
- [ ] Persist recovery drafts to IndexedDB

## Notes

The adapter registry is the single most important architectural decision.
Everything else hangs off it.
`,
  },
  {
    path: "schema/config.xsd",
    content: `<?xml version="1.0" encoding="UTF-8"?>
<schema xmlns="http://www.w3.org/2001/XMLSchema" targetNamespace="urn:workbench:config">
  <element name="config">
    <complexType>
      <sequence>
        <element name="app" type="string"/>
        <element name="port" type="integer"/>
      </sequence>
    </complexType>
  </element>
</schema>
`,
  },
  {
    path: "manifest.toon",
    content: `# Sample TOON manifest
project: "workbench"
version: 1.0
features:
  preview: true
  ai: true
  diagnostics: true
authors:
  - "Alice"
  - "Bob"
  - "Carol"
metadata:
  createdAt: "2024-09-01"
  license: "MIT"
`,
  },
];
