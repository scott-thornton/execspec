/**
 * `execspec generate swift` (plan Task 36): read IR, strict parse,
 * validate, recompute digest, generate in memory, atomically replace the
 * output directory so no half-generated tree is ever visible.
 */

import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import { decodeSemanticIRDocument, specificationDigest } from "@execspec/core";
import { generateSwift } from "@execspec/swift-generator";
import type { GeneratedFile } from "@execspec/swift-generator";
import type { CliIO } from "./index.js";
import { parseFlags } from "./compile-command.js";

export async function generateSwiftCommand(args: readonly string[], io: CliIO): Promise<number> {
  const { values, missing } = parseFlags(args, ["--ir", "--out"]);
  if (missing.length > 0) {
    io.writeErr(`generate swift: missing required flags: ${missing.join(", ")}\n`);
    return 2;
  }
  const irPath = resolve(values["--ir"] ?? "");
  const outDir = resolve(values["--out"] ?? "");

  let raw: string;
  try {
    raw = await readFile(irPath, "utf8");
  } catch (error) {
    io.writeErr(`generate swift: cannot read ${irPath}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    io.writeErr(`generate swift: IR file is not JSON: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const decoded = decodeSemanticIRDocument(parsed);
  if (!decoded.ok) {
    const formatted = decoded.diagnostics
      .map((diagnostic) => `${diagnostic.scope}: ${diagnostic.code}: ${diagnostic.message}`)
      .join("\n");
    io.writeErr(`generate swift: IR rejected:\n${formatted}\n`);
    return 1;
  }
  const digest = specificationDigest(decoded.document.semantic);
  let files: readonly GeneratedFile[];
  try {
    files = generateSwift(decoded.document, digest);
  } catch (error) {
    io.writeErr(`generate swift: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  await writeAtomically(outDir, files);
  io.writeOut(`${files.map((file) => file.relativePath).join("\n")}\n`);
  return 0;
}

async function writeAtomically(outDir: string, files: readonly GeneratedFile[]): Promise<void> {
  const parent = dirname(outDir);
  await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(resolve(tmpdir(), `${basename(outDir)}.staging-`));
  try {
    for (const file of files) {
      await writeFile(resolve(staging, file.relativePath), file.contents, "utf8");
    }
    const previous = resolve(tmpdir(), `${basename(outDir)}.previous-`);
    await rm(previous, { recursive: true, force: true });
    let hadPrevious = false;
    try {
      await readdir(outDir);
      hadPrevious = true;
      await rename(outDir, previous);
    } catch {
      hadPrevious = false;
    }
    try {
      await rename(staging, outDir);
    } catch (error) {
      if (hadPrevious) {
        await rename(previous, outDir);
      }
      throw error;
    }
    if (hadPrevious) {
      await rm(previous, { recursive: true, force: true });
    }
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}
