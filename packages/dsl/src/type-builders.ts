/**
 * Type DSL (plan §2.6/Task 14). Builders produce plain semantic type AST
 * nodes from @execspec/core; insertion order of authoring records is
 * never semantically meaningful (canonicalization sorts at compile time).
 */

import {
  booleanType,
  int64Type,
  float64Type,
  bytesType,
  mapType,
  listType,
  refType,
  stringType,
  unitType,
  structDeclaration,
  enumDeclaration,
  unionDeclaration,
} from "@execspec/core";
import type {
  EnumDeclaration,
  ListType,
  MapType,
  PrimitiveType,
  StructDeclaration,
  TypeDeclaration,
  TypeRef,
  UnionDeclaration,
  UnionCase,
  ValueType,
} from "@execspec/core";

export function unit(): PrimitiveType {
  return unitType();
}

export function boolean(): PrimitiveType {
  return booleanType();
}

export function int64(): PrimitiveType {
  return int64Type();
}

export function float64(): PrimitiveType {
  return float64Type();
}

export function bytes(): PrimitiveType {
  return bytesType();
}

export function string(): PrimitiveType {
  return stringType();
}

export function list(element: ValueType): ListType {
  return listType(element);
}

/** Map keys are restricted to string and int64. */
export function map(key: ValueType, value: ValueType): MapType {
  return mapType(key, value);
}

export function ref(typeId: string): TypeRef {
  return refType(typeId);
}

/** Field-only optionality marker. Rejected anywhere outside struct fields. */
export interface OptionalFieldMarker {
  readonly __execspecOptionalField: ValueType;
}

export function optional(type: ValueType): OptionalFieldMarker {
  if (isOptionalFieldMarker(type)) {
    throw new Error("optional() cannot wrap another optional()");
  }
  return { __execspecOptionalField: type };
}

export function isOptionalFieldMarker(value: unknown): value is OptionalFieldMarker {
  return (
    typeof value === "object" &&
    value !== null &&
    "__execspecOptionalField" in value
  );
}

export type FieldSpec = ValueType | OptionalFieldMarker;

export function struct(typeId: string, fields: Record<string, FieldSpec>): StructDeclaration {
  const built: { name: string; type: ValueType; optional: boolean }[] = [];
  for (const [name, spec] of Object.entries(fields)) {
    if (isOptionalFieldMarker(spec)) {
      built.push({ name, type: spec.__execspecOptionalField, optional: true });
    } else {
      built.push({ name, type: spec, optional: false });
    }
  }
  return structDeclaration(typeId, built);
}

export function enumeration(typeId: string, cases: readonly string[]): EnumDeclaration {
  return enumDeclaration(typeId, cases);
}

export function union(typeId: string, cases: Record<string, ValueType>): UnionDeclaration {
  const built: UnionCase[] = Object.entries(cases).map(([name, payload]) => ({
    name,
    payload,
  }));
  return unionDeclaration(typeId, built);
}

export function isTypeDeclaration(value: unknown): value is TypeDeclaration {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const kind = (value as { readonly kind?: unknown }).kind;
  return kind === "struct" || kind === "enum" || kind === "union";
}
