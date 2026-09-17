/**
 * Swift codec emission (plan Task 25). Explicit encode/decode per named
 * type plus structural helpers for inline value types. Codec failures
 * are request failures (ExecSpecHostFailure.invalidRequest), never
 * domain outputs. Rules mirror docs/semantic-model.md §3 exactly.
 */

import type { SemanticIR, TypeDeclaration, ValueType } from "@execspec/core";
import { swiftEnumCaseName, swiftPropertyName, swiftTypeName } from "./identifiers.js";
import { swiftValueTypeName } from "./emit-types.js";

function structuralComponent(type: ValueType): string {
  switch (type.kind) {
    case "unit":
      return "unit";
    case "boolean":
      return "boolean";
    case "int64":
      return "int64";
    case "string":
      return "string";
    case "ref":
      return type.typeId;
    case "list":
      return `list_of_${structuralComponent(type.element)}`;
  }
}

function registerStructuralHelpers(type: ValueType, registered: Set<string>): void {
  if (type.kind === "ref") {
    return;
  }
  registered.add(structuralComponent(type));
  if (type.kind === "list") {
    registerStructuralHelpers(type.element, registered);
  }
}

export function decoderExpression(type: ValueType): string {
  return type.kind === "ref"
    ? `decode${swiftTypeName(type.typeId)}`
    : `decodeValue_${structuralComponent(type)}`;
}

export function encoderExpression(type: ValueType): string {
  return type.kind === "ref"
    ? `encode${swiftTypeName(type.typeId)}`
    : `encodeValue_${structuralComponent(type)}`;
}

function rebuildType(component: string): ValueType {
  if (component === "unit" || component === "boolean" || component === "int64" || component === "string") {
    return { kind: component };
  }
  if (component.startsWith("list_of_")) {
    return { kind: "list", element: rebuildType(component.slice("list_of_".length)) };
  }
  return { kind: "ref", typeId: component };
}

function labelFor(type: ValueType): string {
  switch (type.kind) {
    case "unit":
      return "unit";
    case "boolean":
      return "boolean";
    case "int64":
      return "int64";
    case "string":
      return "string";
    case "ref":
      return type.typeId;
    case "list":
      return `list<${labelFor(type.element)}>`;
  }
}

const SHARED_HELPERS = `func rejectUnknownFields(
    _ object: [String: JSONValue],
    _ allowed: Set<String>,
    _ typeName: String
) throws {
    for key in object.keys.sorted() where !allowed.contains(key) {
        throw ExecSpecHostFailure.invalidRequest("\\(typeName): unknown field '\\(key)'")
    }
}

func requireStructField(
    _ object: [String: JSONValue],
    _ name: String,
    _ typeName: String
) throws -> JSONValue {
    guard let raw = object[name] else {
        throw ExecSpecHostFailure.invalidRequest("\\(typeName): missing required field '\\(name)'")
    }
    if case .null = raw {
        throw ExecSpecHostFailure.invalidRequest("\\(typeName): field '\\(name)' must not be null")
    }
    return raw
}

func optionalStructField(
    _ object: [String: JSONValue],
    _ name: String,
    _ typeName: String
) throws -> JSONValue? {
    guard let raw = object[name] else {
        return nil
    }
    if case .null = raw {
        throw ExecSpecHostFailure.invalidRequest("\\(typeName): field '\\(name)' must not be null")
    }
    return raw
}`;

function primitiveHelperSource(component: string): string {
  switch (component) {
    case "unit":
      return `func decodeValue_unit(_ value: JSONValue) throws -> ExecSpecUnit {
    guard case .object(let object) = value, object.isEmpty else {
        throw ExecSpecHostFailure.invalidRequest("unit: expected {}")
    }
    return ExecSpecUnit()
}

func encodeValue_unit(_ value: ExecSpecUnit) throws -> JSONValue {
    .object([:])
}`;
    case "boolean":
      return `func decodeValue_boolean(_ value: JSONValue) throws -> Bool {
    guard case .bool(let flag) = value else {
        throw ExecSpecHostFailure.invalidRequest("boolean: expected a JSON boolean")
    }
    return flag
}

func encodeValue_boolean(_ value: Bool) throws -> JSONValue {
    .bool(value)
}`;
    case "int64":
      return `func decodeValue_int64(_ value: JSONValue) throws -> Int64 {
    guard case .object(let object) = value, object.count == 1,
          case .string(let spelling)? = object["$i64"] else {
        throw ExecSpecHostFailure.invalidRequest("int64: expected {\\"$i64\\":\\"...\\"}")
    }
    guard ExecSpecWire.isCanonicalInt64Spelling(spelling), let parsed = Int64(spelling) else {
        throw ExecSpecHostFailure.invalidRequest("int64: invalid spelling '\\(spelling)'")
    }
    return parsed
}

func encodeValue_int64(_ value: Int64) throws -> JSONValue {
    .object(["$i64": .string(String(value))])
}`;
    case "string":
      return `func decodeValue_string(_ value: JSONValue) throws -> String {
    guard case .string(let text) = value else {
        throw ExecSpecHostFailure.invalidRequest("string: expected a JSON string")
    }
    return text
}

func encodeValue_string(_ value: String) throws -> JSONValue {
    .string(value)
}`;
    default:
      return listHelperSource(component);
  }
}

function listHelperSource(component: string): string {
  const element = rebuildType(component.slice("list_of_".length));
  const decoder = decoderExpression(element);
  const encoder = encoderExpression(element);
  const swiftType = swiftValueTypeName({ kind: "list", element });
  const label = `list<${labelFor(element)}>`;
  return `func decodeValue_${component}(_ value: JSONValue) throws -> ${swiftType} {
    guard case .array(let items) = value else {
        throw ExecSpecHostFailure.invalidRequest("${label}: expected a JSON array")
    }
    return try items.map { try ${decoder}($0) }
}

func encodeValue_${component}(_ value: ${swiftType}) throws -> JSONValue {
    .array(value.map { try ${encoder}($0) })
}`;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function emitStructCodec(
  declaration: { readonly id: string; readonly fields: readonly { readonly name: string; readonly type: ValueType; readonly optional: boolean }[] },
): string {
  const name = swiftTypeName(declaration.id);
  const allowed = `[${declaration.fields.map((field) => `"${field.name}"`).join(", ")}]`;
  const lines: string[] = [];
  lines.push(`func decode${name}(_ value: JSONValue) throws -> ${name} {`);
  lines.push(`    guard case .object(let object) = value else {`);
  lines.push(`        throw ExecSpecHostFailure.invalidRequest("${name}: expected a JSON object")`);
  lines.push(`    }`);
  lines.push(`    try rejectUnknownFields(object, ${allowed}, "${name}")`);

  const initArgs: string[] = [];
  for (const field of declaration.fields) {
    const propertyName = swiftPropertyName(field.name);
    if (field.optional) {
      const local = `raw${capitalize(propertyName)}`;
      lines.push(`    let ${propertyName}: ${swiftValueTypeName(field.type)}?`);
      lines.push(`    if let ${local} = try optionalStructField(object, "${field.name}", "${name}") {`);
      lines.push(`        ${propertyName} = try ${decoderExpression(field.type)}(${local})`);
      lines.push(`    } else {`);
      lines.push(`        ${propertyName} = nil`);
      lines.push(`    }`);
      initArgs.push(`        ${propertyName}: ${propertyName}`);
    } else {
      initArgs.push(
        `        ${propertyName}: try ${decoderExpression(field.type)}(requireStructField(object, "${field.name}", "${name}"))`,
      );
    }
  }
  if (initArgs.length === 0) {
    lines.push(`    return ${name}()`);
  } else {
    lines.push(`    return ${name}(`);
    lines.push(initArgs.join(",\n"));
    lines.push(`    )`);
  }
  lines.push(`}`);
  lines.push("");
  lines.push(`func encode${name}(_ value: ${name}) throws -> JSONValue {`);
  lines.push(`    var object: [String: JSONValue] = [:]`);
  for (const field of declaration.fields) {
    const propertyName = swiftPropertyName(field.name);
    if (field.optional) {
      lines.push(`    if let ${propertyName} = value.${propertyName} {`);
      lines.push(`        object["${field.name}"] = try ${encoderExpression(field.type)}(${propertyName})`);
      lines.push(`    }`);
    } else {
      lines.push(`    object["${field.name}"] = try ${encoderExpression(field.type)}(value.${propertyName})`);
    }
  }
  lines.push(`    return .object(object)`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

function emitEnumCodec(
  declaration: { readonly id: string; readonly cases: readonly string[] },
): string {
  const name = swiftTypeName(declaration.id);
  const lines: string[] = [];
  lines.push(`func decode${name}(_ value: JSONValue) throws -> ${name} {`);
  lines.push(`    guard case .string(let raw) = value else {`);
  lines.push(`        throw ExecSpecHostFailure.invalidRequest("${name}: expected a JSON string")`);
  lines.push(`    }`);
  lines.push(`    switch raw {`);
  for (const caseName of declaration.cases) {
    lines.push(`    case "${caseName}":`);
    lines.push(`        return .${swiftEnumCaseName(caseName)}`);
  }
  lines.push(`    default:`);
  lines.push(`        throw ExecSpecHostFailure.invalidRequest("${name}: unknown case '\\(raw)'")`);
  lines.push(`    }`);
  lines.push(`}`);
  lines.push("");
  lines.push(`func encode${name}(_ value: ${name}) throws -> JSONValue {`);
  lines.push(`    switch value {`);
  for (const caseName of declaration.cases) {
    lines.push(`    case .${swiftEnumCaseName(caseName)}:`);
    lines.push(`        return .string("${caseName}")`);
  }
  lines.push(`    }`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

function emitUnionCodec(
  declaration: { readonly id: string; readonly cases: readonly { readonly name: string; readonly payload: ValueType }[] },
): string {
  const name = swiftTypeName(declaration.id);
  const lines: string[] = [];
  lines.push(`func decode${name}(_ value: JSONValue) throws -> ${name} {`);
  lines.push(`    guard case .object(let object) = value else {`);
  lines.push(`        throw ExecSpecHostFailure.invalidRequest("${name}: expected a JSON object")`);
  lines.push(`    }`);
  lines.push(`    guard case .string(let rawCase)? = object["$case"] else {`);
  lines.push(`        throw ExecSpecHostFailure.invalidRequest("${name}: missing '$case'")`);
  lines.push(`    }`);
  lines.push(`    switch rawCase {`);
  for (const unionCase of declaration.cases) {
    const caseName = swiftEnumCaseName(unionCase.name);
    const isUnit = unionCase.payload.kind === "unit";
    if (isUnit) {
      lines.push(`    case "${unionCase.name}":`);
      lines.push(`        guard object.count == 1 else {`);
      lines.push(`            throw ExecSpecHostFailure.invalidRequest("${name}: case '${unionCase.name}' must not carry 'value'")`);
      lines.push(`        }`);
      lines.push(`        return .${caseName}`);
    } else {
      const local = `raw${capitalize(caseName)}`;
      lines.push(`    case "${unionCase.name}":`);
      lines.push(`        guard object.count == 2, let ${local} = object["value"] else {`);
      lines.push(`            throw ExecSpecHostFailure.invalidRequest("${name}: case '${unionCase.name}' requires exactly 'value'")`);
      lines.push(`        }`);
      lines.push(`        return .${caseName}(try ${decoderExpression(unionCase.payload)}(${local}))`);
    }
  }
  lines.push(`    default:`);
  lines.push(`        throw ExecSpecHostFailure.invalidRequest("${name}: unknown case '\\(rawCase)'")`);
  lines.push(`    }`);
  lines.push(`}`);
  lines.push("");
  lines.push(`func encode${name}(_ value: ${name}) throws -> JSONValue {`);
  lines.push(`    switch value {`);
  for (const unionCase of declaration.cases) {
    const caseName = swiftEnumCaseName(unionCase.name);
    if (unionCase.payload.kind === "unit") {
      lines.push(`    case .${caseName}:`);
      lines.push(`        return .object(["$case": .string("${unionCase.name}")])`);
    } else {
      lines.push(`    case .${caseName}(let payload):`);
      lines.push(`        return .object(["$case": .string("${unionCase.name}"), "value": try ${encoderExpression(unionCase.payload)}(payload)])`);
    }
  }
  lines.push(`    }`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

export function emitSwiftCodecs(ir: SemanticIR): string {
  // Every structural helper reachable from declaration members and
  // operation input/output positions must be emitted.
  const registered = new Set<string>();
  for (const declaration of ir.types) {
    if (declaration.kind === "struct") {
      for (const field of declaration.fields) {
        registerStructuralHelpers(field.type, registered);
      }
    } else if (declaration.kind === "union") {
      for (const unionCase of declaration.cases) {
        registerStructuralHelpers(unionCase.payload, registered);
      }
    }
  }
  for (const operation of ir.operations) {
    registerStructuralHelpers(operation.input, registered);
    registerStructuralHelpers(operation.output, registered);
  }
  // Nested list helpers used only by enclosing list helpers.
  for (const component of [...registered]) {
    if (component.startsWith("list_of_")) {
      registerStructuralHelpers(rebuildType(component), registered);
    }
  }

  const chunks: string[] = [];
  chunks.push(SHARED_HELPERS);
  for (const component of [...registered].sort()) {
    chunks.push(primitiveHelperSource(component));
  }
  for (const declaration of ir.types as readonly TypeDeclaration[]) {
    if (declaration.kind === "struct") {
      chunks.push(emitStructCodec(declaration));
    } else if (declaration.kind === "enum") {
      chunks.push(emitEnumCodec(declaration));
    } else {
      chunks.push(emitUnionCodec(declaration));
    }
  }
  return chunks.join("\n\n");
}
