/**
 * Canonical semantic value model (docs/semantic-model.md §2).
 *
 * Discriminated unions throughout; plain objects without discriminators
 * are never the internal representation.
 */

import { isMemberName, isTypeId, parseMemberName, parseTypeId } from "./ids.js";
import type { TypeId } from "./ids.js";

export const INT64_MIN = -9223372036854775808n;
export const INT64_MAX = 9223372036854775807n;

export interface UnitValue {
  readonly kind: "unit";
}

export interface BooleanValue {
  readonly kind: "boolean";
  readonly value: boolean;
}

export interface Int64Value {
  readonly kind: "int64";
  readonly value: bigint;
}

export interface StringValue {
  readonly kind: "string";
  readonly value: string;
}

export interface ListValue {
  readonly kind: "list";
  readonly values: readonly SemanticValue[];
}

export interface StructValue {
  readonly kind: "struct";
  readonly typeId: TypeId;
  readonly fields: ReadonlyMap<string, SemanticValue>;
}

export interface EnumValue {
  readonly kind: "enum";
  readonly typeId: TypeId;
  readonly case: string;
}

export interface UnionValue {
  readonly kind: "union";
  readonly typeId: TypeId;
  readonly case: string;
  readonly value?: SemanticValue;
}

export type SemanticValue =
  | UnitValue
  | BooleanValue
  | Int64Value
  | StringValue
  | ListValue
  | StructValue
  | EnumValue
  | UnionValue;

export function unitValue(): UnitValue {
  return { kind: "unit" };
}

export function booleanValue(value: boolean): BooleanValue {
  return { kind: "boolean", value };
}

export function int64Value(value: bigint): Int64Value {
  if (typeof value !== "bigint") {
    throw new Error("int64 values must be bigint, never number");
  }
  if (value < INT64_MIN || value > INT64_MAX) {
    throw new Error(`int64 out of range: ${value}`);
  }
  return { kind: "int64", value };
}

export function stringValue(value: string): StringValue {
  if (typeof value !== "string") {
    throw new Error("string values must be strings");
  }
  for (let i = 0; i < value.length; i += 1) {
    const codeUnit = value.charCodeAt(i);
    const isHighSurrogate = codeUnit >= 0xd800 && codeUnit <= 0xdbff;
    const isLowSurrogate = codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
    if (isHighSurrogate) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : -1;
      const nextIsLow = next >= 0xdc00 && next <= 0xdfff;
      if (!nextIsLow) {
        throw new Error("string contains an unpaired surrogate");
      }
      i += 1;
    } else if (isLowSurrogate) {
      throw new Error("string contains an unpaired surrogate");
    }
  }
  return { kind: "string", value };
}

export function listValue(values: readonly SemanticValue[]): ListValue {
  return { kind: "list", values: [...values] };
}

export function structValue(
  typeId: string,
  fields: ReadonlyMap<string, SemanticValue>,
): StructValue {
  const parsedId = parseTypeId(typeId);
  for (const name of fields.keys()) {
    parseMemberName(name);
  }
  return { kind: "struct", typeId: parsedId, fields: new Map(fields) };
}

export function enumValue(typeId: string, caseName: string): EnumValue {
  return { kind: "enum", typeId: parseTypeId(typeId), case: parseMemberName(caseName) };
}

export function unionValue(
  typeId: string,
  caseName: string,
  payload?: SemanticValue,
): UnionValue {
  const parsedId = parseTypeId(typeId);
  const parsedCase = parseMemberName(caseName);
  if (payload === undefined) {
    return { kind: "union", typeId: parsedId, case: parsedCase };
  }
  return { kind: "union", typeId: parsedId, case: parsedCase, value: payload };
}

export function isSemanticValue(candidate: unknown): candidate is SemanticValue {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }
  const value = candidate as {
    readonly kind?: unknown;
    readonly value?: unknown;
    readonly values?: unknown;
    readonly typeId?: unknown;
    readonly fields?: unknown;
    readonly case?: unknown;
  };
  switch (value.kind) {
    case "unit":
      return true;
    case "boolean":
      return typeof value.value === "boolean";
    case "int64":
      return typeof value.value === "bigint";
    case "string":
      return typeof value.value === "string";
    case "list":
      return (
        Array.isArray(value.values) &&
        value.values.every((entry) => isSemanticValue(entry))
      );
    case "struct":
      return (
        typeof value.typeId === "string" &&
        isTypeId(value.typeId) &&
        value.fields instanceof Map
      );
    case "enum":
      return (
        typeof value.typeId === "string" &&
        isTypeId(value.typeId) &&
        typeof value.case === "string" &&
        isMemberName(value.case)
      );
    case "union":
      return (
        typeof value.typeId === "string" &&
        isTypeId(value.typeId) &&
        typeof value.case === "string" &&
        isMemberName(value.case) &&
        (value.value === undefined || isSemanticValue(value.value))
      );
    default:
      return false;
  }
}
