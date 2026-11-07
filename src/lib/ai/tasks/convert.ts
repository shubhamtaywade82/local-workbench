// In-process conversion between data formats. It needs no model, so Convert
// works offline and returns exact output. Markdown and XML are not data formats,
// so they go to the model instead.

import { parse as parseJsonc } from "jsonc-parser";
import JSON5 from "json5";
import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { parse as parseToml, stringify as stringifyToml } from "smol-toml";

import { parseToon, toonStringify } from "@/documents/adapters/toon/toon";

import type { ConvertFormat } from "./contract";

export type DataFormat = Exclude<ConvertFormat, "xml" | "markdown">;

const DATA_FORMATS: ReadonlySet<string> = new Set<DataFormat>(["json", "jsonc", "json5", "yaml", "toml", "toon"]);

export function isDataFormat(format: string): format is DataFormat {
  return DATA_FORMATS.has(format);
}

/** The Archify adapter claims JSON documents, so its id maps back to the JSON format. */
export function sourceFormatOf(adapterId: string): string {
  return adapterId === "archify" ? "json" : adapterId;
}

function parseDataFormat(format: DataFormat, source: string): unknown {
  switch (format) {
    case "json":
      return JSON.parse(source);
    case "jsonc": {
      const value = parseJsonc(source);
      if (value === undefined) throw new Error("Not valid JSONC.");
      return value;
    }
    case "json5":
      return JSON5.parse(source);
    case "yaml":
      return parseYaml(source);
    case "toml":
      return parseToml(source);
    case "toon": {
      const result = parseToon(source);
      const errors = result.diagnostics.filter((d) => d.severity === "error");
      if (errors.length > 0) throw new Error(errors[0].message);
      return result.value;
    }
  }
}

function stringifyDataFormat(format: DataFormat, value: unknown): string {
  switch (format) {
    case "json":
    case "jsonc":
      return `${JSON.stringify(value, null, 2)}\n`;
    case "json5":
      return `${JSON5.stringify(value, null, 2)}\n`;
    case "yaml":
      return stringifyYaml(value);
    case "toml":
      return stringifyToml(value as Record<string, unknown>);
    case "toon":
      return toonStringify(value);
  }
}

/**
 * Converts `source` without a model. Returns null when either format is not a
 * data format, or when the source cannot be parsed or represented in the target.
 * The caller then falls back to the model.
 */
export function convertDeterministically(source: string, from: string, to: string): string | null {
  if (!isDataFormat(from) || !isDataFormat(to)) return null;
  if (from === to) return source;
  try {
    return stringifyDataFormat(to, parseDataFormat(from, source));
  } catch {
    return null;
  }
}
