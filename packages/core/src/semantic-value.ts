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

/** IEEE 754 double. Portable equality and wire form are defined by the
 *  canonical ECMAScript spelling (docs/semantic-model.md §3.1): -0
 *  canonicalizes to "0", NaN equals NaN. */
export interface Float64Value {
  readonly kind: "float64";
  readonly value: number;
}

export interface BytesValue {
  readonly kind: "bytes";
  readonly value: Uint8Array;
}

export interface ListValue {
  readonly kind: "list";
  readonly values: readonly SemanticValue[];
}

/** Map value with string or bigint (int64) keys; order-insensitive. */
export interface MapValue {
  readonly kind: "map";
  readonly entries: ReadonlyMap<string | bigint, SemanticValue>;
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
  | Float64Value
  | StringValue
  | BytesValue
  | ListValue
  | MapValue
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

/** NaN and the infinities are legal semantic values; only the runtime
 *  type is validated (NaN is a value here, not IEEE arithmetic). */
export function float64Value(value: number): Float64Value {
  if (typeof value !== "number") {
    throw new Error("float64 values must be numbers");
  }
  return { kind: "float64", value };
}

export function bytesValue(value: Uint8Array): BytesValue {
  if (!(value instanceof Uint8Array)) {
    throw new Error("bytes values must be Uint8Array");
  }
  return { kind: "bytes", value: new Uint8Array(value) };
}

export function mapValue(entries: ReadonlyMap<string | bigint, SemanticValue>): MapValue {
  for (const key of entries.keys()) {
    if (typeof key !== "string" && typeof key !== "bigint") {
      throw new Error("map keys must be string or bigint");
    }
    if (typeof key === "string" && !isValidUnicodeString(key)) {
      throw new Error("map keys must be valid Unicode strings");
    }
  }
  return { kind: "map", entries: new Map(entries) };
}

function isValidUnicodeString(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const codeUnit = value.charCodeAt(i);
    const isHigh = codeUnit >= 0xd800 && codeUnit <= 0xdbff;
    const isLow = codeUnit >= 0xdc00 && codeUnit <= 0xdfff;
    if (isHigh) {
      const next = i + 1 < value.length ? value.charCodeAt(i + 1) : -1;
      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return false;
      }
      i += 1;
    } else if (isLow) {
      return false;
    }
  }
  return true;
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
    readonly entries?: unknown;
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
    case "float64":
      return typeof value.value === "number";
    case "bytes":
      return value.value instanceof Uint8Array;
    case "list":
      return (
        Array.isArray(value.values) &&
        value.values.every((entry) => isSemanticValue(entry))
      );
    case "map":
      return (
        value.entries instanceof Map &&
        [...value.entries.keys()].every(
          (key) => typeof key === "string" || typeof key === "bigint",
        )
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
