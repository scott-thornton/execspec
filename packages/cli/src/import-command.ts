/**
 * `execspec import --openapi <file>`: generate a compilable execspec
 * TypeScript module from an OpenAPI 3.x JSON specification. Types and
 * operations are filled in; scenarios are left empty (the user adds
 * behavioral scenarios).
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { importOpenAPI, resetInputTypes, getInputTypeDeclarations } from "./openapi-importer.js";
import type { CliIO } from "./index.js";

export async function importCommand(args: readonly string[], io: CliIO): Promise<number> {
  const openapiIndex = args.indexOf("--openapi");
  const outIndex = args.indexOf("--out");
  const openapiPath = openapiIndex >= 0 ? args[openapiIndex + 1] : undefined;
  const outPath = outIndex >= 0 ? args[outIndex + 1] : undefined;

  if (openapiPath === undefined || outPath === undefined) {
    io.writeErr("import: requires --openapi <file.json> --out <spec.ts>\n");
    return 2;
  }

  let raw: string;
  try {
    raw = await readFile(resolve(openapiPath), "utf8");
  } catch (error) {
    io.writeErr(`import: cannot read ${openapiPath}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    io.writeErr(`import: invalid JSON: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }

  resetInputTypes();
  const result = importOpenAPI(parsed);

  // Insert input type declarations before operations
  const inputTypes = getInputTypeDeclarations();
  let source = result.specSource;
  if (inputTypes.length > 0) {
    source = source.replace(
      "// --- Operations (imported from OpenAPI paths) ---",
      `// --- Generated input types (from OpenAPI request bodies) ---\n\n${inputTypes.join("\n\n")}\n\n// --- Operations (imported from OpenAPI paths) ---`,
    );
  }

  await mkdir(dirname(resolve(outPath)), { recursive: true });
  await writeFile(resolve(outPath), source, "utf8");

  io.writeOut(`imported ${result.typeCount} types, ${result.operationCount} operations\n`);
  io.writeOut(`written to ${outPath}\n`);

  if (result.warnings.length > 0) {
    io.writeOut(`\nwarnings (${result.warnings.length}):\n`);
    for (const warning of result.warnings.slice(0, 20)) {
      io.writeOut(`  ${warning}\n`);
    }
    if (result.warnings.length > 20) {
      io.writeOut(`  ... and ${result.warnings.length - 20} more\n`);
    }
  }

  io.writeOut(`\nnext: add scenarios to ${outPath}, then compile:\n`);
  io.writeOut(`  npx execspec compile --module <compiled-spec.js> --out <contract.execspec.json>\n`);

  return 0;
}
