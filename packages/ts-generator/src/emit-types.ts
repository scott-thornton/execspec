/**
 * TypeScript type emission: interfaces for structs, string-literal
 * unions for enums, tagged unions on `kind` for unions. Fields are
 * readonly; optional fields are absent-when-unset.
 */

import type { TypeDeclaration, ValueType } from "@execspec/core";
import { tsPropertyName, tsTypeName } from "./identifiers.js";

export function tsValueTypeName(type: ValueType): string {
  switch (type.kind) {
    case "unit":
      return "ExecSpecUnit";
    case "boolean":
      return "boolean";
    case "int64":
      return "bigint";
    case "float64":
      return "number";
    case "string":
      return "string";
    case "bytes":
      return "Uint8Array";
    case "ref":
      return tsTypeName(type.typeId);
    case "list":
      return `${tsValueTypeName(type.element)}[]`;
    case "map":
      return `Map<${tsValueTypeName(type.key)}, ${tsValueTypeName(type.value)}>`;
  }
}

export function emitTsTypes(types: readonly TypeDeclaration[]): string {
  const chunks: string[] = [];
  chunks.push(`export type ExecSpecUnit = void;\n`);
  for (const declaration of types) {
    if (declaration.kind === "struct") {
      const lines: string[] = [];
      lines.push(`export interface ${tsTypeName(declaration.id)} {`);
      for (const field of declaration.fields) {
        const name = tsPropertyName(field.name);
        const type = tsValueTypeName(field.type);
        lines.push(field.optional ? `    readonly ${name}?: ${type};` : `    readonly ${name}: ${type};`);
      }
      lines.push(`}`);
      chunks.push(lines.join("\n") + "\n");
    } else if (declaration.kind === "enum") {
      const cases = declaration.cases.map((caseName) => `"${caseName}"`).join(" | ");
      chunks.push(`export type ${tsTypeName(declaration.id)} = ${cases};\n`);
    } else {
      const variants = declaration.cases.map((unionCase) => {
        const name = tsPropertyName(unionCase.name);
        if (unionCase.payload.kind === "unit") {
          return `    | { readonly kind: "${name}" }`;
        }
        return `    | { readonly kind: "${name}"; readonly value: ${tsValueTypeName(unionCase.payload)} }`;
      });
      chunks.push(`export type ${tsTypeName(declaration.id)} =\n${variants.join("\n")};\n`);
    }
  }
  return chunks.join("\n");
}
