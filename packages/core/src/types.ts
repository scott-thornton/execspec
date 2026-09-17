/**
 * Semantic type AST (docs/semantic-model.md §1).
 *
 * All declarations are nominal; anonymous composites cannot be
 * constructed through these helpers.
 */

import { isMemberName, isTypeId, parseTypeId, parseMemberName } from "./ids.js";

export type PrimitiveType =
  | { readonly kind: "unit" }
  | { readonly kind: "boolean" }
  | { readonly kind: "int64" }
  | { readonly kind: "float64" }
  | { readonly kind: "string" }
  | { readonly kind: "bytes" };

export interface TypeRef {
  readonly kind: "ref";
  readonly typeId: string;
}

export interface ListType {
  readonly kind: "list";
  readonly element: ValueType;
}

/** Map with a restricted key type (string or int64) so wire keys stay
 *  canonical and deterministic. */
export interface MapType {
  readonly kind: "map";
  readonly key: ValueType;
  readonly value: ValueType;
}

export type ValueType = PrimitiveType | TypeRef | ListType | MapType;

export interface StructField {
  readonly name: string;
  readonly type: ValueType;
  readonly optional: boolean;
}

export interface StructDeclaration {
  readonly kind: "struct";
  readonly id: string;
  readonly fields: readonly StructField[];
}

export interface EnumDeclaration {
  readonly kind: "enum";
  readonly id: string;
  readonly cases: readonly string[];
}

export interface UnionCase {
  readonly name: string;
  readonly payload: ValueType;
}

export interface UnionDeclaration {
  readonly kind: "union";
  readonly id: string;
  readonly cases: readonly UnionCase[];
}

export type TypeDeclaration =
  | StructDeclaration
  | EnumDeclaration
  | UnionDeclaration;

export function unitType(): PrimitiveType {
  return { kind: "unit" };
}

export function booleanType(): PrimitiveType {
  return { kind: "boolean" };
}

export function int64Type(): PrimitiveType {
  return { kind: "int64" };
}

export function float64Type(): PrimitiveType {
  return { kind: "float64" };
}

export function bytesType(): PrimitiveType {
  return { kind: "bytes" };
}

export function stringType(): PrimitiveType {
  return { kind: "string" };
}

export function listType(element: ValueType): ListType {
  return { kind: "list", element };
}

/** Map keys are restricted to `string` and `int64` (docs/semantic-model.md). */
export function mapType(key: ValueType, value: ValueType): MapType {
  if (key.kind !== "string" && key.kind !== "int64") {
    throw new Error(`map keys must be string or int64, got '${key.kind}'`);
  }
  return { kind: "map", key, value };
}

export function refType(typeId: string): TypeRef {
  return { kind: "ref", typeId: parseTypeId(typeId) };
}

function field(
  name: string,
  type: ValueType,
  optional: boolean,
): StructField {
  return { name: parseMemberName(name), type, optional };
}

export function structDeclaration(
  id: string,
  fields: readonly StructField[],
): StructDeclaration {
  const parsedId = parseTypeId(id);
  const seen = new Set<string>();
  for (const structField of fields) {
    parseMemberName(structField.name);
    if (seen.has(structField.name)) {
      throw new Error(`Duplicate field '${structField.name}' in struct '${id}'`);
    }
    seen.add(structField.name);
  }
  return { kind: "struct", id: parsedId, fields: [...fields] };
}

export function enumDeclaration(
  id: string,
  cases: readonly string[],
): EnumDeclaration {
  const parsedId = parseTypeId(id);
  const seen = new Set<string>();
  for (const caseName of cases) {
    parseMemberName(caseName);
    if (seen.has(caseName)) {
      throw new Error(`Duplicate case '${caseName}' in enum '${id}'`);
    }
    seen.add(caseName);
  }
  return { kind: "enum", id: parsedId, cases: [...cases] };
}

export function unionDeclaration(
  id: string,
  cases: readonly UnionCase[],
): UnionDeclaration {
  const parsedId = parseTypeId(id);
  const seen = new Set<string>();
  for (const unionCase of cases) {
    parseMemberName(unionCase.name);
    if (seen.has(unionCase.name)) {
      throw new Error(`Duplicate case '${unionCase.name}' in union '${id}'`);
    }
    seen.add(unionCase.name);
  }
  return { kind: "union", id: parsedId, cases: [...cases] };
}

const PRIMITIVE_KINDS = new Set(["unit", "boolean", "int64", "float64", "string", "bytes"]);

export function isPrimitiveType(value: unknown): value is PrimitiveType {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as { readonly kind?: unknown }).kind;
  return typeof kind === "string" && PRIMITIVE_KINDS.has(kind);
}

export function isTypeRef(value: unknown): value is TypeRef {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { readonly kind?: unknown; readonly typeId?: unknown };
  return (
    candidate.kind === "ref" &&
    typeof candidate.typeId === "string" &&
    isTypeId(candidate.typeId)
  );
}

export function isListType(value: unknown): value is ListType {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { readonly kind?: unknown; readonly element?: unknown };
  return candidate.kind === "list" && isValueType(candidate.element);
}

export function isMapType(value: unknown): value is MapType {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as { readonly kind?: unknown; readonly key?: unknown; readonly value?: unknown };
  if (candidate.kind !== "map" || !isValueType(candidate.key) || !isValueType(candidate.value)) {
    return false;
  }
  const keyKind = (candidate.key as { readonly kind: string }).kind;
  return keyKind === "string" || keyKind === "int64";
}

export function isValueType(value: unknown): value is ValueType {
  return isPrimitiveType(value) || isTypeRef(value) || isListType(value) || isMapType(value);
}

export function isStructField(value: unknown): value is StructField {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as {
    readonly name?: unknown;
    readonly type?: unknown;
    readonly optional?: unknown;
  };
  return (
    typeof candidate.name === "string" &&
    isMemberName(candidate.name) &&
    isValueType(candidate.type) &&
    typeof candidate.optional === "boolean"
  );
}

export function isUnionCase(value: unknown): value is UnionCase {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as {
    readonly name?: unknown;
    readonly payload?: unknown;
  };
  return (
    typeof candidate.name === "string" &&
    isMemberName(candidate.name) &&
    isValueType(candidate.payload)
  );
}

export function isTypeDeclaration(value: unknown): value is TypeDeclaration {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as {
    readonly kind?: unknown;
    readonly id?: unknown;
    readonly fields?: unknown;
    readonly cases?: unknown;
  };
  if (typeof candidate.id !== "string" || !isTypeId(candidate.id)) {
    return false;
  }
  switch (candidate.kind) {
    case "struct":
      return (
        Array.isArray(candidate.fields) &&
        candidate.fields.every((entry) => isStructField(entry))
      );
    case "enum":
      return (
        Array.isArray(candidate.cases) &&
        candidate.cases.every((entry) => typeof entry === "string" && isMemberName(entry))
      );
    case "union":
      return (
        Array.isArray(candidate.cases) &&
        candidate.cases.every((entry) => isUnionCase(entry))
      );
    default:
      return false;
  }
}

export { field as structField };
