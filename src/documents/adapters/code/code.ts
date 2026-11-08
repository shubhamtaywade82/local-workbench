// Code document adapters. Provides Monaco language mapping and syntax-highlighted
// previews for common programming, scripting, stylesheet, config, and text files.

import type { DocumentAdapter, ParseResult, PreviewModel } from "@/documents/core/types";

function createCodeAdapter(
  id: string,
  extensions: readonly string[],
  languageId: string,
  displayName: string
): DocumentAdapter {
  return {
    id,
    extensions,
    languageId,
    displayName,
    parse(source: string): ParseResult {
      return { valid: true, value: source, diagnostics: [] };
    },
    createPreview(source: string): PreviewModel {
      if (languageId === "diff") {
        return { kind: "diff", source };
      }
      return { kind: "code", source, language: languageId };
    },
  };
}

export const typescriptAdapter = createCodeAdapter("typescript", ["ts", "tsx"], "typescript", "TypeScript");
export const javascriptAdapter = createCodeAdapter("javascript", ["js", "jsx", "mjs", "cjs"], "javascript", "JavaScript");
export const pythonAdapter = createCodeAdapter("python", ["py", "pyw"], "python", "Python");
export const shellAdapter = createCodeAdapter("shell", ["sh", "bash", "zsh"], "shell", "Shell Script");
export const sqlAdapter = createCodeAdapter("sql", ["sql"], "sql", "SQL");
export const cssAdapter = createCodeAdapter("css", ["css", "scss", "less"], "css", "CSS");
export const diffAdapter = createCodeAdapter("diff", ["diff", "patch"], "diff", "Diff / Patch");
export const configAdapter = createCodeAdapter("config", ["ini", "conf", "cfg", "env", "properties"], "ini", "Configuration");
export const textAdapter = createCodeAdapter("text", ["txt", "text", "log"], "plaintext", "Plain Text");
export const dockerAdapter = createCodeAdapter("dockerfile", ["dockerfile"], "dockerfile", "Dockerfile");
export const makeAdapter = createCodeAdapter("makefile", ["makefile"], "makefile", "Makefile");
export const gitAdapter = createCodeAdapter("git", ["gitignore", "gitattributes", "gitmodules", "editorconfig"], "ini", "Git Config");
export const graphqlAdapter = createCodeAdapter("graphql", ["graphql", "gql"], "graphql", "GraphQL");

export const codeAdapters: readonly DocumentAdapter[] = [
  typescriptAdapter,
  javascriptAdapter,
  pythonAdapter,
  shellAdapter,
  sqlAdapter,
  cssAdapter,
  diffAdapter,
  configAdapter,
  textAdapter,
  dockerAdapter,
  makeAdapter,
  gitAdapter,
  graphqlAdapter,
];
