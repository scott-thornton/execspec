/**
 * Swift type emission (plan Task 23). Sendable, no Codable, no
 * Equatable — portable equality belongs to the semantic layer.
 */

import type { TypeDeclaration, ValueType } from "@execspec/core";
import {
  assertNoEscapedCollisions,
  swiftEnumCaseName,
  swiftPropertyName,
  swiftTypeName,
} from "./identifiers.js";

/** Reserved generated type names user declarations must not shadow. */
export const RESERVED_SWIFT_TYPE_NAMES: ReadonlySet<string> = new Set([
  "ExecSpecUnit",
]);

export function swiftValueTypeName(type: ValueType): string {
  switch (type.kind) {
    case "unit":
      return "ExecSpecUnit";
    case "boolean":
      return "Bool";
    case "int64":
      return "Int64";
    case "string":
      return "String";
    case "ref":
      return swiftTypeName(type.typeId);
    case "list":
      return `[${swiftValueTypeName(type.element)}]`;
  }
}

function assertDeclarationSafe(declaration: TypeDeclaration): void {
  if (RESERVED_SWIFT_TYPE_NAMES.has(declaration.id)) {
    throw new Error(`type name '${declaration.id}' is reserved by the generator`);
  }
  assertNoEscapedCollisions([declaration.id], "type namespace", swiftTypeName);
  if (declaration.kind === "struct") {
    assertNoEscapedCollisions(
      declaration.fields.map((field) => field.name),
      `struct ${declaration.id}`,
      swiftPropertyName,
    );
  } else if (declaration.kind === "enum") {
    assertNoEscapedCollisions(declaration.cases, `enum ${declaration.id}`, swiftEnumCaseName);
  } else {
    assertNoEscapedCollisions(
      declaration.cases.map((entry) => entry.name),
      `union ${declaration.id}`,
      swiftEnumCaseName,
    );
  }
}

export function emitSwiftTypes(types: readonly TypeDeclaration[]): string {
  for (const declaration of types) {
    assertDeclarationSafe(declaration);
  }

  const chunks: string[] = [];
  chunks.push(`public struct ExecSpecUnit: Sendable {
    public init() {}
}
`);

  for (const declaration of types) {
    chunks.push(emitDeclaration(declaration));
  }
  return chunks.join("\n");
}

function emitDeclaration(declaration: TypeDeclaration): string {
  switch (declaration.kind) {
    case "struct":
      return emitStruct(declaration);
    case "enum":
      return emitEnum(declaration);
    case "union":
      return emitUnion(declaration);
  }
}

function emitStruct(
  declaration: { readonly id: string; readonly fields: readonly { readonly name: string; readonly type: ValueType; readonly optional: boolean }[] },
): string {
  const name = swiftTypeName(declaration.id);
  const lines: string[] = [];
  lines.push(`public struct ${name}: Sendable {`);
  const initParams: string[] = [];
  for (const field of declaration.fields) {
    const fieldName = swiftPropertyName(field.name);
    const swiftType = swiftValueTypeName(field.type);
    if (field.optional) {
      lines.push(`    public let ${fieldName}: ${swiftType}?`);
      initParams.push(`        ${fieldName}: ${swiftType}? = nil`);
    } else {
      lines.push(`    public let ${fieldName}: ${swiftType}`);
      initParams.push(`        ${fieldName}: ${swiftType}`);
    }
  }
  lines.push("");
  if (initParams.length === 0) {
    lines.push(`    public init() {}`);
  } else {
    lines.push(`    public init(`);
    lines.push(initParams.join(",\n"));
    lines.push(`    ) {`);
    for (const field of declaration.fields) {
      const fieldName = swiftPropertyName(field.name);
      lines.push(`        self.${fieldName} = ${fieldName}`);
    }
    lines.push(`    }`);
  }
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

function emitEnum(
  declaration: { readonly id: string; readonly cases: readonly string[] },
): string {
  const name = swiftTypeName(declaration.id);
  const lines: string[] = [];
  lines.push(`public enum ${name}: Sendable {`);
  for (const caseName of declaration.cases) {
    lines.push(`    case ${swiftEnumCaseName(caseName)}`);
  }
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

function emitUnion(
  declaration: { readonly id: string; readonly cases: readonly { readonly name: string; readonly payload: ValueType }[] },
): string {
  const name = swiftTypeName(declaration.id);
  const lines: string[] = [];
  lines.push(`public enum ${name}: Sendable {`);
  for (const unionCase of declaration.cases) {
    const caseName = swiftEnumCaseName(unionCase.name);
    if (unionCase.payload.kind === "unit") {
      lines.push(`    case ${caseName}`);
    } else {
      lines.push(`    case ${caseName}(${swiftValueTypeName(unionCase.payload)})`);
    }
  }
  lines.push(`}`);
  return lines.join("\n") + "\n";
}
