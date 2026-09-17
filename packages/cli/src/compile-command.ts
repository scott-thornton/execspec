/**
 * `execspec compile` (plan Task 35): import a compiled ESM spec module,
 * validate, compile, write canonical IR, print the digest. No direct
 * `.ts` loading in v0.1 — the example package builds explicitly.
 */

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { canonicalJSONStringify, semanticIRDocumentToJSON } from "@execspec/core";
import type { JSONValue } from "@execspec/core";
import { compileSpecification, formatDiagnostics, isAuthoringGraph } from "@execspec/compiler";
import type { CliIO } from "./index.js";

export interface ParsedFlags {
  readonly values: Readonly<Record<string, string>>;
  readonly missing: readonly string[];
}

export function parseFlags(
  args: readonly string[],
  required: readonly string[],
  optional: readonly string[] = [],
): ParsedFlags {
  const values: Record<string, string> = {};
  const known = new Set([...required, ...optional]);
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if (flag === undefined || value === undefined || !known.has(flag)) {
      return { values, missing: required.filter((name) => values[name] === undefined) };
    }
    values[flag] = value;
  }
  const missing = required.filter((name) => values[name] === undefined);
  return { values, missing };
}

export async function compileCommand(args: readonly string[], io: CliIO): Promise<number> {
  const { values, missing } = parseFlags(args, ["--module", "--out"]);
  if (missing.length > 0) {
    io.writeErr(`compile: missing required flags: ${missing.join(", ")}\n`);
    return 2;
  }
  const modulePath = resolve(values["--module"] ?? "");
  const outPath = resolve(values["--out"] ?? "");

  let imported: { default?: unknown };
  try {
    imported = (await import(pathToFileURL(modulePath).href)) as { default?: unknown };
  } catch (error) {
    io.writeErr(`compile: cannot import module ${modulePath}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const graph = imported.default;
  if (!isAuthoringGraph(graph)) {
    io.writeErr("compile: default export must be an AuthoringGraph built by @execspec/dsl\n");
    return 1;
  }
  const result = compileSpecification(graph);
  if (!result.ok) {
    io.writeErr(`compile: specification rejected:\n${formatDiagnostics(result.diagnostics)}\n`);
    return 1;
  }
  const contents = `${canonicalJSONStringify(
    semanticIRDocumentToJSON(result.document) as unknown as JSONValue,
  )}\n`;
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, contents, "utf8");
  io.writeOut(`${result.digest}\n`);
  return 0;
}
