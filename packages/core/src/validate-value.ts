/**
 * Validation of semantic values against semantic types
 * (docs/semantic-model.md §5). Ordinary validation failures are issues,
 * never exceptions.
 */

import type { TypeDeclaration, ValueType } from "./types.js";
import { INT64_MAX, INT64_MIN } from "./semantic-value.js";
import type { SemanticValue } from "./semantic-value.js";
import type { TypeId } from "./ids.js";

export interface TypeEnvironment {
  readonly declarations: ReadonlyMap<TypeId, TypeDeclaration>;
}

export interface ValidationIssue {
  readonly path: string;
  readonly code: string;
  readonly message: string;
}

function issue(path: string, code: string, message: string): ValidationIssue {
  return { path, code, message };
}

export function validateValue(
  value: SemanticValue,
  expectedType: ValueType,
  environment: TypeEnvironment,
): readonly ValidationIssue[] {
  return validate(value, expectedType, environment, "$");
}

function validate(
  value: SemanticValue,
  expectedType: ValueType,
  environment: TypeEnvironment,
  path: string,
): readonly ValidationIssue[] {
  switch (expectedType.kind) {
    case "unit":
      return value.kind === "unit" ? [] : mismatch(path, "unit", value.kind);
    case "boolean":
      return value.kind === "boolean" ? [] : mismatch(path, "boolean", value.kind);
    case "int64":
      if (value.kind !== "int64") {
        return mismatch(path, "int64", value.kind);
      }
      if (value.value < INT64_MIN || value.value > INT64_MAX) {
        return [issue(path, "int64OutOfRange", "int64 outside signed 64-bit range")];
      }
      return [];
    case "string":
      return value.kind === "string" ? [] : mismatch(path, "string", value.kind);
    case "ref":
      return validateRef(value, expectedType.typeId, environment, path);
    case "list":
      if (value.kind !== "list") {
        return mismatch(path, "list", value.kind);
      }
      const issues: ValidationIssue[] = [];
      value.values.forEach((element, index) => {
        issues.push(
          ...validate(element, expectedType.element, environment, `${path}[${index}]`),
        );
      });
      return issues;
  }
}

function mismatch(
  path: string,
  expected: string,
  actual: string,
): readonly ValidationIssue[] {
  return [
    issue(path, "typeMismatch", `expected ${expected}, got ${actual} at ${path}`),
  ];
}

function validateRef(
  value: SemanticValue,
  typeId: string,
  environment: TypeEnvironment,
  path: string,
): readonly ValidationIssue[] {
  const declaration = environment.declarations.get(typeId as TypeId);
  if (declaration === undefined) {
    return [
      issue(`${path}.typeId`, "unknownTypeReference", `no declaration for '${typeId}'`),
    ];
  }
  switch (declaration.kind) {
    case "struct":
      return validateStruct(value, declaration, environment, path);
    case "enum":
      return validateEnum(value, declaration, path);
    case "union":
      return validateUnion(value, declaration, environment, path);
  }
}

function validateStruct(
  value: SemanticValue,
  declaration: { readonly id: string; readonly fields: readonly { readonly name: string; readonly type: ValueType; readonly optional: boolean }[] },
  environment: TypeEnvironment,
  path: string,
): readonly ValidationIssue[] {
  if (value.kind !== "struct") {
    return mismatch(path, `struct ${declaration.id}`, value.kind);
  }
  const issues: ValidationIssue[] = [];
  if (value.typeId !== declaration.id) {
    issues.push(
      issue(
        `${path}.typeId`,
        "nominalTypeMismatch",
        `expected struct '${declaration.id}', got '${value.typeId}'`,
      ),
    );
  }
  const declaredFields = new Map(declaration.fields.map((field) => [field.name, field]));
  for (const name of value.fields.keys()) {
    if (!declaredFields.has(name)) {
      issues.push(
        issue(`${path}.${name}`, "unknownStructField", `unknown field '${name}'`),
      );
    }
  }
  for (const field of declaration.fields) {
    const present = value.fields.get(field.name);
    if (present === undefined) {
      if (!field.optional) {
        issues.push(
          issue(`${path}.${field.name}`, "missingRequiredField", `missing field '${field.name}'`),
        );
      }
      continue;
    }
    issues.push(...validate(present, field.type, environment, `${path}.${field.name}`));
  }
  return issues;
}

function validateEnum(
  value: SemanticValue,
  declaration: { readonly id: string; readonly cases: readonly string[] },
  path: string,
): readonly ValidationIssue[] {
  if (value.kind !== "enum") {
    return mismatch(path, `enum ${declaration.id}`, value.kind);
  }
  const issues: ValidationIssue[] = [];
  if (value.typeId !== declaration.id) {
    issues.push(
      issue(
        `${path}.typeId`,
        "nominalTypeMismatch",
        `expected enum '${declaration.id}', got '${value.typeId}'`,
      ),
    );
  }
  if (!declaration.cases.includes(value.case)) {
    issues.push(
      issue(`${path}.case`, "invalidEnumCase", `unknown case '${value.case}'`),
    );
  }
  return issues;
}

function validateUnion(
  value: SemanticValue,
  declaration: { readonly id: string; readonly cases: readonly { readonly name: string; readonly payload: ValueType }[] },
  environment: TypeEnvironment,
  path: string,
): readonly ValidationIssue[] {
  if (value.kind !== "union") {
    return mismatch(path, `union ${declaration.id}`, value.kind);
  }
  const issues: ValidationIssue[] = [];
  if (value.typeId !== declaration.id) {
    issues.push(
      issue(
        `${path}.typeId`,
        "nominalTypeMismatch",
        `expected union '${declaration.id}', got '${value.typeId}'`,
      ),
    );
  }
  const matchedCase = declaration.cases.find((entry) => entry.name === value.case);
  if (matchedCase === undefined) {
    issues.push(
      issue(`${path}.case`, "invalidUnionCase", `unknown case '${value.case}'`),
    );
    return issues;
  }
  const payloadIsUnit = matchedCase.payload.kind === "unit";
  if (payloadIsUnit && value.value !== undefined) {
    issues.push(
      issue(`${path}.value`, "unexpectedUnionPayload", "unit-payload case carries no payload"),
    );
    return issues;
  }
  if (!payloadIsUnit && value.value === undefined) {
    issues.push(
      issue(`${path}.value`, "missingUnionPayload", "case requires a payload"),
    );
    return issues;
  }
  if (value.value !== undefined) {
    issues.push(...validate(value.value, matchedCase.payload, environment, `${path}.value`));
  }
  return issues;
}
