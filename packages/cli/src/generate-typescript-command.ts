/**
 * `execspec generate typescript`: read IR, strict parse, validate,
 * recompute digest, generate in memory, atomically replace the output
 * directory.
 */

import { decodeSemanticIRDocument, specificationDigest } from "@execspec/core";
import { generateTypeScript } from "@execspec/ts-generator";
import type { GeneratedTsFile } from "@execspec/ts-generator";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import type { CliIO } from "./index.js";
import { parseFlags } from "./compile-command.js";
import { writeDirectoryAtomically } from "./generate-swift-command.js";

export async function generateTypescriptCommand(args: readonly string[], io: CliIO): Promise<number> {
  const { values, missing } = parseFlags(args, ["--ir", "--out"]);
  if (missing.length > 0) {
    io.writeErr(`generate typescript: missing required flags: ${missing.join(", ")}\n`);
    return 2;
  }
  const irPath = resolve(values["--ir"] ?? "");
  const outDir = resolve(values["--out"] ?? "");

  let raw: string;
  try {
    raw = await readFile(irPath, "utf8");
  } catch (error) {
    io.writeErr(`generate typescript: cannot read ${irPath}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    io.writeErr(`generate typescript: IR file is not JSON: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const decoded = decodeSemanticIRDocument(parsed);
  if (!decoded.ok) {
    const formatted = decoded.diagnostics
      .map((diagnostic) => `${diagnostic.scope}: ${diagnostic.code}: ${diagnostic.message}`)
      .join("\n");
    io.writeErr(`generate typescript: IR rejected:\n${formatted}\n`);
    return 1;
  }
  const digest = specificationDigest(decoded.document.semantic);
  let files: readonly GeneratedTsFile[];
  try {
    files = generateTypeScript(decoded.document, digest);
  } catch (error) {
    io.writeErr(`generate typescript: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  await writeDirectoryAtomically(outDir, files.map((file) => ({ relativePath: file.relativePath, contents: file.contents })));
  io.writeOut(`${files.map((file) => file.relativePath).join("\n")}\n`);
  return 0;
}
