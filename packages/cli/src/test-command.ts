/**
 * `execspec test` (plan Task 37): run every scenario against a host
 * executable; exit nonzero when any scenario fails.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { decodeSemanticIRDocument } from "@execspec/core";
import { runSpecification } from "@execspec/harness";
import { renderReport, summarize } from "@execspec/harness";
import type { CliIO } from "./index.js";
import { parseFlags } from "./compile-command.js";

const DEFAULT_TIMEOUT_MS = 5000;

export async function testCommand(args: readonly string[], io: CliIO): Promise<number> {
  const { values, missing } = parseFlags(args, ["--ir", "--host"], ["--timeout-ms"]);
  if (missing.length > 0) {
    io.writeErr(`test: missing required flags: ${missing.join(", ")}\n`);
    return 2;
  }
  const timeoutRaw = values["--timeout-ms"];
  let timeoutMs = DEFAULT_TIMEOUT_MS;
  if (timeoutRaw !== undefined) {
    const parsed = Number.parseInt(timeoutRaw, 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
      io.writeErr(`test: --timeout-ms must be a positive integer, got ${timeoutRaw}\n`);
      return 2;
    }
    timeoutMs = parsed;
  }

  const irPath = resolve(values["--ir"] ?? "");
  let raw: string;
  try {
    raw = await readFile(irPath, "utf8");
  } catch (error) {
    io.writeErr(`test: cannot read ${irPath}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    io.writeErr(`test: IR file is not JSON: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const decoded = decodeSemanticIRDocument(parsed);
  if (!decoded.ok) {
    const formatted = decoded.diagnostics
      .map((diagnostic) => `${diagnostic.scope}: ${diagnostic.code}: ${diagnostic.message}`)
      .join("\n");
    io.writeErr(`test: IR rejected:\n${formatted}\n`);
    return 1;
  }

  const results = await runSpecification(decoded.document, {
    hostCommand: { executable: resolve(values["--host"] ?? ""), args: [] },
    timeoutMs,
  });
  io.writeOut(renderReport(results));
  const { failed } = summarize(results);
  return failed === 0 ? 0 : 1;
}
