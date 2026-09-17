/**
 * TypeScript codec emission. Mirrors the Swift codecs byte-for-byte on
 * the wire: int64/float64/bytes tagged strings, struct/enum/union
 * shapes, encoded-key maps. All failures are ExecSpecHostFailure
 * ("invalidRequest") — never domain outputs.
 */

import type { SemanticIR, TypeDeclaration, ValueType } from "@execspec/core";
import { INT64_MAX, INT64_MIN } from "@execspec/core";
import { tsPropertyName, tsTypeName } from "./identifiers.js";
import { tsValueTypeName } from "./emit-types.js";

function structuralComponent(type: ValueType): string {
  switch (type.kind) {
    case "unit":
      return "unit";
    case "boolean":
      return "boolean";
    case "int64":
      return "int64";
    case "float64":
      return "float64";
    case "string":
      return "string";
    case "bytes":
      return "bytes";
    case "ref":
      return type.typeId;
    case "list":
      return `list_of_${structuralComponent(type.element)}`;
    case "map":
      return `map_of_${structuralComponent(type.key)}_to_${structuralComponent(type.value)}`;
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
  if (type.kind === "map") {
    registerStructuralHelpers(type.key, registered);
    registerStructuralHelpers(type.value, registered);
  }
}

function rebuildType(component: string): ValueType {
  if (
    component === "unit" || component === "boolean" || component === "int64"
    || component === "float64" || component === "string" || component === "bytes"
  ) {
    return { kind: component };
  }
  if (component.startsWith("list_of_")) {
    return { kind: "list", element: rebuildType(component.slice("list_of_".length)) };
  }
  if (component.startsWith("map_of_")) {
    const rest = component.slice("map_of_".length);
    const key = rest.startsWith("string_") ? "string" : "int64";
    const value = rest.slice(key.length + "_to_".length);
    return { kind: "map", key: rebuildType(key), value: rebuildType(value) };
  }
  return { kind: "ref", typeId: component };
}

export function decoderExpression(type: ValueType): string {
  return type.kind === "ref"
    ? `decode${tsTypeName(type.typeId)}`
    : `decodeValue_${structuralComponent(type)}`;
}

export function encoderExpression(type: ValueType): string {
  return type.kind === "ref"
    ? `encode${tsTypeName(type.typeId)}`
    : `encodeValue_${structuralComponent(type)}`;
}

function primitiveHelperSource(component: string): string {
  switch (component) {
    case "unit":
      return `export function decodeValue_unit(value: WireValue): ExecSpecUnit {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 0) {
        throw new ExecSpecHostFailure("invalidRequest", "unit: expected {}");
    }
    return undefined;
}

export function encodeValue_unit(value: ExecSpecUnit): WireValue {
    void value;
    return {};
}`;
    case "boolean":
      return `export function decodeValue_boolean(value: WireValue): boolean {
    if (typeof value !== "boolean") {
        throw new ExecSpecHostFailure("invalidRequest", "boolean: expected a JSON boolean");
    }
    return value;
}

export function encodeValue_boolean(value: boolean): WireValue {
    return value;
}`;
    case "int64":
      return `export function decodeValue_int64(value: WireValue): bigint {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 1) {
        throw new ExecSpecHostFailure("invalidRequest", "int64: expected {\\"$i64\\":\\"...\\"}");
    }
    const spelling = (value as { readonly $i64?: WireValue }).$i64;
    if (typeof spelling !== "string" || !/^-?(0|[1-9][0-9]*)$/.test(spelling) || spelling === "-0") {
        throw new ExecSpecHostFailure("invalidRequest", \`int64: invalid spelling '\${spelling}'\`);
    }
    const parsed = BigInt(spelling);
    if (parsed < INT64_MIN_BUILTIN || parsed > INT64_MAX_BUILTIN) {
        throw new ExecSpecHostFailure("invalidRequest", "int64: out of range");
    }
    return parsed;
}

export function encodeValue_int64(value: bigint): WireValue {
    return { $i64: value.toString(10) };
}`;
    case "float64":
      return `export function decodeValue_float64(value: WireValue): number {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 1) {
        throw new ExecSpecHostFailure("invalidRequest", "float64: expected {\\"$f64\\":\\"...\\"}");
    }
    const spelling = (value as { readonly $f64?: WireValue }).$f64;
    if (typeof spelling !== "string" || !isCanonicalFloat64Spelling(spelling)) {
        throw new ExecSpecHostFailure("invalidRequest", \`float64: invalid spelling '\${spelling}'\`);
    }
    const parsed = parseFloat64Spelling(spelling);
    if (parsed === undefined) {
        throw new ExecSpecHostFailure("invalidRequest", \`float64: invalid spelling '\${spelling}'\`);
    }
    return parsed;
}

export function encodeValue_float64(value: number): WireValue {
    return { $f64: canonicalFloat64Spelling(value) };
}`;
    case "string":
      return `export function decodeValue_string(value: WireValue): string {
    if (typeof value !== "string") {
        throw new ExecSpecHostFailure("invalidRequest", "string: expected a JSON string");
    }
    return value;
}

export function encodeValue_string(value: string): WireValue {
    return value;
}`;
    case "bytes":
      return `export function decodeValue_bytes(value: WireValue): Uint8Array {
    if (typeof value !== "object" || value === null || Array.isArray(value) || Object.keys(value).length !== 1) {
        throw new ExecSpecHostFailure("invalidRequest", "bytes: expected {\\"$b64\\":\\"...\\"}");
    }
    const spelling = (value as { readonly $b64?: WireValue }).$b64;
    if (typeof spelling !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(spelling)) {
        throw new ExecSpecHostFailure("invalidRequest", "bytes: invalid base64");
    }
    const decoded = Buffer.from(spelling, "base64");
    if (Buffer.from(decoded).toString("base64") !== spelling) {
        throw new ExecSpecHostFailure("invalidRequest", "bytes: non-canonical base64");
    }
    return new Uint8Array(decoded);
}

export function encodeValue_bytes(value: Uint8Array): WireValue {
    return { $b64: Buffer.from(value).toString("base64") };
}`;
    default:
      if (component.startsWith("map_of_")) {
        return mapHelperSource(component);
      }
      return listHelperSource(component);
  }
}

function listHelperSource(component: string): string {
  const element = rebuildType(component.slice("list_of_".length));
  const decoder = decoderExpression(element);
  const encoder = encoderExpression(element);
  const type = tsValueTypeName(element);
  return `export function decodeValue_${component}(value: WireValue): ${type}[] {
    if (!Array.isArray(value)) {
        throw new ExecSpecHostFailure("invalidRequest", "list: expected a JSON array");
    }
    return value.map((entry) => ${decoder}(entry));
}

export function encodeValue_${component}(value: ${type}[]): WireValue {
    return value.map((entry) => ${encoder}(entry));
}`;
}

function mapHelperSource(component: string): string {
  const map = rebuildType(component) as { kind: "map"; key: ValueType; value: ValueType };
  const keyType = tsValueTypeName(map.key);
  const valueType = tsValueTypeName(map.value);
  const decodeKey = map.key.kind === "string"
    ? `        result.set(entry[0], ${decoderExpression(map.value)}(entry[1]));`
    : `        const key = entry[0];
        if (!/^-?(0|[1-9][0-9]*)$/.test(key) || key === "-0") {
            throw new ExecSpecHostFailure("invalidRequest", \`map: invalid key '\${key}'\`);
        }
        const parsedKey = BigInt(key);
        if (parsedKey < INT64_MIN_BUILTIN || parsedKey > INT64_MAX_BUILTIN) {
            throw new ExecSpecHostFailure("invalidRequest", "map: int64 key out of range");
        }
        result.set(parsedKey, ${decoderExpression(map.value)}(entry[1]));`;
  const encodeEntry = map.key.kind === "string"
    ? `        object[entry[0]] = ${encoderExpression(map.value)}(entry[1]);`
    : `        object[entry[0].toString(10)] = ${encoderExpression(map.value)}(entry[1]);`;
  return `export function decodeValue_${component}(value: WireValue): Map<${keyType}, ${valueType}> {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new ExecSpecHostFailure("invalidRequest", "map: expected a JSON object");
    }
    const result = new Map<${keyType}, ${valueType}>();
    for (const entry of Object.entries(value)) {
${decodeKey}
    }
    return result;
}

export function encodeValue_${component}(value: Map<${keyType}, ${valueType}>): WireValue {
    const object: { [key: string]: WireValue } = {};
    for (const entry of value) {
${encodeEntry}
    }
    return object;
}`;
}

function emitStructCodec(
  declaration: { readonly id: string; readonly fields: readonly { readonly name: string; readonly type: ValueType; readonly optional: boolean }[] },
): string {
  const name = tsTypeName(declaration.id);
  const lines: string[] = [];
  lines.push(`export function decode${name}(value: WireValue): ${name} {`);
  lines.push(`    if (typeof value !== "object" || value === null || Array.isArray(value)) {`);
  lines.push(`        throw new ExecSpecHostFailure("invalidRequest", "${name}: expected a JSON object");`);
  lines.push(`    }`);
  lines.push(`    const object = value as { readonly [key: string]: WireValue };`);
  lines.push(`    for (const key of Object.keys(object)) {`);
  lines.push(`        switch (key) {`);
  for (const field of declaration.fields) {
    lines.push(`            case "${field.name}":`);
  }
  if (declaration.fields.length === 0) {
    lines.push(`            default:`);
    lines.push(`                throw new ExecSpecHostFailure("invalidRequest", \`${name}: unknown field '\${key}'\`);`);
  } else {
    lines.push(`                break;`);
    lines.push(`            default:`);
    lines.push(`                throw new ExecSpecHostFailure("invalidRequest", \`${name}: unknown field '\${key}'\`);`);
    lines.push(`        }`);
  }
  if (declaration.fields.length === 0) {
    lines.push(`        }`);
  }
  lines.push(`    }`);
  const parts: string[] = [];
  for (const field of declaration.fields) {
    const property = tsPropertyName(field.name);
    if (field.optional) {
      lines.push(`    let ${property}: ${tsValueTypeName(field.type)} | undefined;`);
      lines.push(`    if ("${field.name}" in object) {`);
      lines.push(`        const raw = object["${field.name}"];`);
      lines.push(`        if (raw === null) {`);
      lines.push(`            throw new ExecSpecHostFailure("invalidRequest", "${name}: field '${field.name}' must not be null");`);
      lines.push(`        }`);
      lines.push(`        ${property} = ${decoderExpression(field.type)}(raw);`);
      lines.push(`    }`);
      parts.push(`        ${property},`);
    } else {
      lines.push(`    if (!("${field.name}" in object)) {`);
      lines.push(`        throw new ExecSpecHostFailure("invalidRequest", "${name}: missing required field '${field.name}'");`);
      lines.push(`    }`);
      lines.push(`    const raw${property} = object["${field.name}"];`);
      lines.push(`    if (raw${property} === null) {`);
      lines.push(`        throw new ExecSpecHostFailure("invalidRequest", "${name}: field '${field.name}' must not be null");`);
      lines.push(`    }`);
      parts.push(`        ${property}: ${decoderExpression(field.type)}(raw${property}),`);
    }
  }
  if (parts.length === 0) {
    lines.push(`    return {};`);
  } else {
    lines.push(`    return {`);
    lines.push(parts.join("\n"));
    lines.push(`    };`);
  }
  lines.push(`}`);
  lines.push(``);
  lines.push(`export function encode${name}(value: ${name}): WireValue {`);
  lines.push(`    const object: { [key: string]: WireValue } = {};`);
  for (const field of declaration.fields) {
    const property = tsPropertyName(field.name);
    if (field.optional) {
      lines.push(`    if (value.${property} !== undefined) {`);
      lines.push(`        object["${field.name}"] = ${encoderExpression(field.type)}(value.${property});`);
      lines.push(`    }`);
    } else {
      lines.push(`    object["${field.name}"] = ${encoderExpression(field.type)}(value.${property});`);
    }
  }
  lines.push(`    return object;`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

function emitEnumCodec(
  declaration: { readonly id: string; readonly cases: readonly string[] },
): string {
  const name = tsTypeName(declaration.id);
  const lines: string[] = [];
  lines.push(`export function decode${name}(value: WireValue): ${name} {`);
  lines.push(`    if (typeof value !== "string") {`);
  lines.push(`        throw new ExecSpecHostFailure("invalidRequest", "${name}: expected a JSON string");`);
  lines.push(`    }`);
  lines.push(`    switch (value) {`);
  for (const caseName of declaration.cases) {
    lines.push(`        case "${caseName}":`);
    lines.push(`            return value;`);
  }
  lines.push(`        default:`);
  lines.push(`            throw new ExecSpecHostFailure("invalidRequest", \`${name}: unknown case '\${value}'\`);`);
  lines.push(`    }`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export function encode${name}(value: ${name}): WireValue {`);
  lines.push(`    return value;`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

function emitUnionCodec(
  declaration: { readonly id: string; readonly cases: readonly { readonly name: string; readonly payload: ValueType }[] },
): string {
  const name = tsTypeName(declaration.id);
  const lines: string[] = [];
  lines.push(`export function decode${name}(value: WireValue): ${name} {`);
  lines.push(`    if (typeof value !== "object" || value === null || Array.isArray(value)) {`);
  lines.push(`        throw new ExecSpecHostFailure("invalidRequest", "${name}: expected a JSON object");`);
  lines.push(`    }`);
  lines.push(`    const object = value as { readonly $case?: WireValue; readonly value?: WireValue };`);
  lines.push(`    if (typeof object.$case !== "string") {`);
  lines.push(`        throw new ExecSpecHostFailure("invalidRequest", "${name}: missing '$case'");`);
  lines.push(`    }`);
  lines.push(`    switch (object.$case) {`);
  for (const unionCase of declaration.cases) {
    const caseName = tsPropertyName(unionCase.name);
    const isUnit = unionCase.payload.kind === "unit";
    if (isUnit) {
      lines.push(`        case "${unionCase.name}":`);
      lines.push(`            if (Object.keys(value as object).length !== 1) {`);
      lines.push(`                throw new ExecSpecHostFailure("invalidRequest", "${name}: case '${unionCase.name}' must not carry 'value'");`);
      lines.push(`            }`);
      lines.push(`            return { kind: "${caseName}" };`);
    } else {
      lines.push(`        case "${unionCase.name}":`);
      lines.push(`            const raw${caseName} = object.value;`);
      lines.push(`            if (raw${caseName} === undefined || Object.keys(value as object).length !== 2) {`);
      lines.push(`                throw new ExecSpecHostFailure("invalidRequest", "${name}: case '${unionCase.name}' requires exactly 'value'");`);
      lines.push(`            }`);
      lines.push(`            return { kind: "${caseName}", value: ${decoderExpression(unionCase.payload)}(raw${caseName}) };`);
    }
  }
  lines.push(`        default:`);
  lines.push(`            throw new ExecSpecHostFailure("invalidRequest", \`${name}: unknown case '\${object.$case}'\`);`);
  lines.push(`    }`);
  lines.push(`}`);
  lines.push(``);
  lines.push(`export function encode${name}(value: ${name}): WireValue {`);
  lines.push(`    switch (value.kind) {`);
  for (const unionCase of declaration.cases) {
    const caseName = tsPropertyName(unionCase.name);
    if (unionCase.payload.kind === "unit") {
      lines.push(`        case "${caseName}":`);
      lines.push(`            return { $case: "${unionCase.name}" };`);
    } else {
      lines.push(`        case "${caseName}":`);
      lines.push(`            return { $case: "${unionCase.name}", value: ${encoderExpression(unionCase.payload)}(value.value) };`);
    }
  }
  lines.push(`    }`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

function runtimeImports(ir: SemanticIR): string {
    const typeNames = [...ir.types.map((declaration) => tsTypeName(declaration.id)), "ExecSpecUnit"].sort();
    return `import {
    ExecSpecHostFailure,
    canonicalFloat64Spelling,
    isCanonicalFloat64Spelling,
    parseFloat64Spelling,
} from "@execspec/ts-generator";
import type { WireValue } from "@execspec/ts-generator";
import type { ${typeNames.join(", ")} } from "./ExecSpecTypes.js";

const INT64_MIN_BUILTIN = ${INT64_MIN}n;
const INT64_MAX_BUILTIN = ${INT64_MAX}n;`;
}

export function emitTsCodecs(ir: SemanticIR): string {
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
  for (const component of [...registered]) {
    if (component.startsWith("list_of_") || component.startsWith("map_of_")) {
      registerStructuralHelpers(rebuildType(component), registered);
    }
  }

  const chunks: string[] = [runtimeImports(ir)];
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
