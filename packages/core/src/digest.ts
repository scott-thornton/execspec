/**
 * Canonical IR serialization, specification digest, and strict document
 * decoding (docs/ir-v1.md §3-§4).
 */

import { createHash } from "node:crypto";

import { canonicalJSONStringify, compareByCodePoint } from "./canonical-json.js";
import type { JSONValue } from "./canonical-json.js";
import { semanticValueToJSON, decodeSemanticValue } from "./semantic-value-json.js";
import { validateSemanticIR, inferExpressionType, buildIRTypeEnvironment } from "./validate-ir.js";
import type { IRDiagnostic } from "./validate-ir.js";
import type {
  OperationIR,
  ScenarioIR,
  ScenarioStepIR,
  SemanticIR,
  SemanticIRDocument,
  SourceLocation,
  ValueExpressionIR,
} from "./ir.js";
import type {
  EnumDeclaration,
  StructDeclaration,
  TypeDeclaration,
  UnionDeclaration,
  ValueType,
} from "./types.js";
import type { SemanticValue } from "./semantic-value.js";
import type { OperationId, ScenarioId, TypeId } from "./ids.js";
import { isMemberName, isOperationId, isScenarioId, isTypeId } from "./ids.js";
import type { TypeEnvironment, ValidationIssue } from "./validate-value.js";

export type DocumentDecodeResult =
  | { readonly ok: true; readonly document: SemanticIRDocument; readonly diagnostics: readonly IRDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly IRDiagnostic[] };

function sortDeclarations<T extends { readonly id: string }>(declarations: readonly T[]): readonly T[] {
  return [...declarations].sort((left, right) => compareByCodePoint(left.id, right.id));
}

function valueTypeToJSON(type: ValueType): JSONValue {
  switch (type.kind) {
    case "unit":
      return { kind: "unit" };
    case "boolean":
      return { kind: "boolean" };
    case "int64":
      return { kind: "int64" };
    case "float64":
      return { kind: "float64" };
    case "string":
      return { kind: "string" };
    case "bytes":
      return { kind: "bytes" };
    case "ref":
      return { kind: "ref", typeId: type.typeId };
    case "list":
      return { kind: "list", element: valueTypeToJSON(type.element) };
    case "map":
      return { kind: "map", key: valueTypeToJSON(type.key), value: valueTypeToJSON(type.value) };
  }
}

function typeDeclarationToJSON(declaration: TypeDeclaration): JSONValue {
  if (declaration.kind === "struct") {
    const fields = [...declaration.fields]
      .sort((left, right) => compareByCodePoint(left.name, right.name))
      .map((field): JSONValue => {
        const encoded: { [key: string]: JSONValue } = {
          name: field.name,
          type: valueTypeToJSON(field.type),
        };
        if (field.optional) {
          encoded.optional = true;
        }
        return encoded;
      });
    return { kind: "struct", id: declaration.id, fields };
  }
  if (declaration.kind === "enum") {
    return {
      kind: "enum",
      id: declaration.id,
      cases: [...declaration.cases].sort(compareByCodePoint),
    };
  }
  return {
    kind: "union",
    id: declaration.id,
    cases: [...declaration.cases]
      .sort((left, right) => compareByCodePoint(left.name, right.name))
      .map((unionCase) => ({ name: unionCase.name, payload: valueTypeToJSON(unionCase.payload) })),
  };
}

function expressionToJSON(expression: ValueExpressionIR): JSONValue {
  switch (expression.kind) {
    case "literal":
      return { kind: "literal", value: semanticValueToJSON(expression.value) };
    case "binding":
      return { kind: "binding", binding: expression.binding };
    case "field":
      return { kind: "field", base: expressionToJSON(expression.base), field: expression.field };
  }
}

function stepToJSON(step: ScenarioStepIR): JSONValue {
  if (step.kind === "call") {
    return {
      kind: "call",
      binding: step.binding,
      operationId: step.operationId,
      input: expressionToJSON(step.input),
    };
  }
  return {
    kind: "expectEqual",
    actual: expressionToJSON(step.actual),
    expected: expressionToJSON(step.expected),
  };
}

function scenarioToJSON(scenario: ScenarioIR): JSONValue {
  return {
    id: scenario.id,
    description: scenario.description,
    steps: scenario.steps.map(stepToJSON),
  };
}

export function semanticIRToJSON(ir: SemanticIR): JSONValue {
  return {
    specificationName: ir.specificationName,
    specificationVersion: ir.specificationVersion,
    types: sortDeclarations(ir.types).map(typeDeclarationToJSON),
    operations: sortDeclarations(ir.operations).map((operation): JSONValue => ({
      id: operation.id,
      input: valueTypeToJSON(operation.input),
      output: valueTypeToJSON(operation.output),
    })),
    scenarios: sortDeclarations(ir.scenarios).map(scenarioToJSON),
  };
}

export function serializeSemanticIR(ir: SemanticIR): string {
  return canonicalJSONStringify(semanticIRToJSON(ir));
}

export function specificationDigest(ir: SemanticIR): string {
  return createHash("sha256")
    .update(Buffer.from(serializeSemanticIR(ir), "utf8"))
    .digest("hex");
}

export function semanticIRDocumentToJSON(document: SemanticIRDocument): JSONValue {
  return {
    format: document.format,
    irVersion: document.irVersion,
    semantic: semanticIRToJSON(document.semantic),
    metadata: {
      sourceLocations: document.metadata.sourceLocations as unknown as JSONValue,
    },
  };
}

// ---------------------------------------------------------------------------
// Strict decoding of IR documents from unknown JSON.
// ---------------------------------------------------------------------------

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function decodeValueType(value: unknown, issues: ValidationIssue[], path: string): ValueType | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    issues.push({ path, code: "expectedObject", message: `${path}: value type must be an object` });
    return undefined;
  }
  switch (record.kind) {
    case "unit":
      return { kind: "unit" };
    case "boolean":
      return { kind: "boolean" };
    case "int64":
      return { kind: "int64" };
    case "float64":
      return { kind: "float64" };
    case "string":
      return { kind: "string" };
    case "bytes":
      return { kind: "bytes" };
    case "ref":
      if (typeof record.typeId === "string" && isTypeId(record.typeId)) {
        return { kind: "ref", typeId: record.typeId };
      }
      issues.push({ path, code: "invalidTypeRef", message: `${path}: invalid type reference` });
      return undefined;
    case "list": {
      const element = decodeValueType(record.element, issues, `${path}.element`);
      return element === undefined ? undefined : { kind: "list", element };
    }
    case "map": {
      const key = decodeValueType(record.key, issues, `${path}.key`);
      const value = decodeValueType(record.value, issues, `${path}.value`);
      if (key === undefined || value === undefined) {
        return undefined;
      }
      if (key.kind !== "string" && key.kind !== "int64") {
        issues.push({ path, code: "invalidMapKey", message: `${path}: map keys must be string or int64` });
        return undefined;
      }
      return { kind: "map", key, value };
    }
    default:
      issues.push({ path, code: "invalidValueType", message: `${path}: unknown value type kind` });
      return undefined;
  }
}

function decodeTypeDeclaration(value: unknown, issues: ValidationIssue[], path: string): TypeDeclaration | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    issues.push({ path, code: "expectedObject", message: `${path}: declaration must be an object` });
    return undefined;
  }
  if (typeof record.id !== "string" || !isTypeId(record.id)) {
    issues.push({ path, code: "invalidTypeId", message: `${path}: invalid type ID` });
    return undefined;
  }
  if (record.kind === "struct") {
    if (!Array.isArray(record.fields)) {
      issues.push({ path, code: "expectedArray", message: `${path}: struct fields must be an array` });
      return undefined;
    }
    const fields: { name: string; type: ValueType; optional: boolean }[] = [];
    for (const [index, rawField] of record.fields.entries()) {
      const fieldRecord = asRecord(rawField);
      const fieldPath = `${path}.fields[${index}]`;
      if (fieldRecord === undefined || typeof fieldRecord.name !== "string" || !isMemberName(fieldRecord.name)) {
        issues.push({ path: fieldPath, code: "invalidField", message: `${fieldPath}: invalid struct field` });
        return undefined;
      }
      const type = decodeValueType(fieldRecord.type, issues, `${fieldPath}.type`);
      if (type === undefined) {
        return undefined;
      }
      fields.push({
        name: fieldRecord.name,
        type,
        optional: fieldRecord.optional === true,
      });
    }
    return { kind: "struct", id: record.id, fields };
  }
  if (record.kind === "enum") {
    if (!Array.isArray(record.cases)) {
      issues.push({ path, code: "expectedArray", message: `${path}: enum cases must be an array` });
      return undefined;
    }
    const cases: string[] = [];
    for (const rawCase of record.cases) {
      if (typeof rawCase !== "string" || !isMemberName(rawCase)) {
        issues.push({ path, code: "invalidCase", message: `${path}: invalid enum case` });
        return undefined;
      }
      cases.push(rawCase);
    }
    return { kind: "enum", id: record.id, cases };
  }
  if (record.kind === "union") {
    if (!Array.isArray(record.cases)) {
      issues.push({ path, code: "expectedArray", message: `${path}: union cases must be an array` });
      return undefined;
    }
    const cases: { name: string; payload: ValueType }[] = [];
    for (const [index, rawCase] of record.cases.entries()) {
      const caseRecord = asRecord(rawCase);
      const casePath = `${path}.cases[${index}]`;
      if (caseRecord === undefined || typeof caseRecord.name !== "string" || !isMemberName(caseRecord.name)) {
        issues.push({ path: casePath, code: "invalidCase", message: `${casePath}: invalid union case` });
        return undefined;
      }
      const payload = decodeValueType(caseRecord.payload, issues, `${casePath}.payload`);
      if (payload === undefined) {
        return undefined;
      }
      cases.push({ name: caseRecord.name, payload });
    }
    return { kind: "union", id: record.id, cases };
  }
  issues.push({ path, code: "invalidDeclarationKind", message: `${path}: unknown declaration kind` });
  return undefined;
}

/** Structural decode of a wire literal into a SemanticValue, given the
 *  expected type. Uses the semantic value codec, not factories. */
function decodeLiteral(
  value: unknown,
  type: ValueType,
  typeEnvironment: TypeEnvironment,
  issues: ValidationIssue[],
  path: string,
): SemanticValue | undefined {
  const result = decodeSemanticValue(value as JSONValue, type, typeEnvironment);
  if (result.ok) {
    return result.value;
  }
  issues.push(...result.issues);
  if (issues.length === 0) {
    issues.push({ path, code: "invalidLiteral", message: `${path}: literal failed to decode` });
  }
  return undefined;
}

interface PartialStep {
  readonly kind: "call" | "expectEqual";
  readonly raw: Record<string, unknown>;
}

function decodeExpressionStructure(
  value: unknown,
  issues: ValidationIssue[],
  path: string,
): ValueExpressionIR | { readonly kind: "literal"; readonly rawLiteral: unknown } | undefined {
  const record = asRecord(value);
  if (record === undefined) {
    issues.push({ path, code: "expectedObject", message: `${path}: expression must be an object` });
    return undefined;
  }
  if (record.kind === "literal") {
    return { kind: "literal", rawLiteral: record.value };
  }
  if (record.kind === "binding") {
    if (typeof record.binding !== "string") {
      issues.push({ path, code: "invalidBinding", message: `${path}: binding name must be a string` });
      return undefined;
    }
    return { kind: "binding", binding: record.binding };
  }
  if (record.kind === "field") {
    if (typeof record.field !== "string") {
      issues.push({ path, code: "invalidField", message: `${path}: field name must be a string` });
      return undefined;
    }
    const base = decodeExpressionStructure(record.base, issues, `${path}.base`);
    if (base === undefined || base.kind === "literal") {
      issues.push({ path, code: "field.literalBase", message: `${path}: field base must not be a literal` });
      return undefined;
    }
    return { kind: "field", base, field: record.field };
  }
  issues.push({ path, code: "invalidExpression", message: `${path}: unknown expression kind` });
  return undefined;
}

type TypedExpression =
  | { readonly kind: "literal"; readonly value: SemanticValue }
  | { readonly kind: "binding"; readonly binding: string }
  | { readonly kind: "field"; readonly base: TypedExpression; readonly field: string };

function decodeStepsTypeDirected(
  rawSteps: readonly PartialStep[],
  environment: { declarations: ReadonlyMap<TypeId, TypeDeclaration>; operations: ReadonlyMap<OperationId, OperationIR>; typeEnvironment: TypeEnvironment },
  issues: ValidationIssue[],
  scenarioPath: string,
): readonly ScenarioStepIR[] | undefined {
  const steps: ScenarioStepIR[] = [];
  const bindings = new Map<string, ValueType>();

  const typeExpression = (
    expression: ValueExpressionIR | { readonly kind: "literal"; readonly rawLiteral: unknown },
    path: string,
    expectedType: ValueType | undefined,
  ): TypedExpression | undefined => {
    if (expression.kind === "literal") {
      if ("rawLiteral" in expression) {
        if (expectedType === undefined) {
          issues.push({ path, code: "literalWithoutTypeContext", message: `${path}: literal has no static type context` });
          return undefined;
        }
        const decoded = decodeLiteral(
          (expression as { readonly rawLiteral: unknown }).rawLiteral,
          expectedType,
          environment.typeEnvironment,
          issues,
          path,
        );
        if (decoded === undefined) {
          return undefined;
        }
        return { kind: "literal", value: decoded };
      }
      return expression;
    }
    return expression;
  };

  for (const [index, rawStep] of rawSteps.entries()) {
    const stepPath = `${scenarioPath}.steps[${index}]`;
    const record = rawStep.raw;
    if (rawStep.kind === "call") {
      if (typeof record.operationId !== "string" || !isOperationId(record.operationId)) {
        issues.push({ path: stepPath, code: "invalidOperationId", message: `${stepPath}: invalid operation ID` });
        return undefined;
      }
      if (typeof record.binding !== "string" || !isMemberName(record.binding)) {
        issues.push({ path: stepPath, code: "invalidBinding", message: `${stepPath}: invalid binding name` });
        return undefined;
      }
      const operation = environment.operations.get(record.operationId as OperationId);
      if (operation === undefined) {
        issues.push({ path: stepPath, code: "unknownOperation", message: `${stepPath}: unknown operation '${record.operationId}'` });
        return undefined;
      }
      const rawInput = decodeExpressionStructure(record.input, issues, `${stepPath}.input`);
      if (rawInput === undefined) {
        return undefined;
      }
      const typedInput = typeExpression(rawInput, `${stepPath}.input`, operation.input);
      if (typedInput === undefined) {
        return undefined;
      }
      steps.push({
        kind: "call",
        binding: record.binding,
        operationId: record.operationId as OperationId,
        input: typedInput,
      });
      bindings.set(record.binding, operation.output);
      continue;
    }

    const rawActual = decodeExpressionStructure(record.actual, issues, `${stepPath}.actual`);
    const rawExpected = decodeExpressionStructure(record.expected, issues, `${stepPath}.expected`);
    if (rawActual === undefined || rawExpected === undefined) {
      return undefined;
    }
    const actualIsLiteral = rawActual.kind === "literal" && "rawLiteral" in rawActual;
    const expectedIsLiteral = rawExpected.kind === "literal" && "rawLiteral" in rawExpected;
    if (actualIsLiteral && expectedIsLiteral) {
      issues.push({ path: stepPath, code: "expectEqual.bothLiterals", message: `${stepPath}: expectEqual must not compare two literals` });
      return undefined;
    }
    let actualType: ValueType | undefined;
    if (!actualIsLiteral) {
      try {
        actualType = inferExpressionType(rawActual as ValueExpressionIR, bindings, {
          declarations: environment.declarations,
          operations: environment.operations,
        });
      } catch {
        actualType = undefined;
      }
    }
    let expectedType: ValueType | undefined;
    if (!expectedIsLiteral) {
      try {
        expectedType = inferExpressionType(rawExpected as ValueExpressionIR, bindings, {
          declarations: environment.declarations,
          operations: environment.operations,
        });
      } catch {
        expectedType = undefined;
      }
    }
    const typedActual = typeExpression(rawActual, `${stepPath}.actual`, actualIsLiteral ? expectedType : actualType);
    const typedExpected = typeExpression(rawExpected, `${stepPath}.expected`, expectedIsLiteral ? actualType : expectedType);
    if (typedActual === undefined || typedExpected === undefined) {
      return undefined;
    }
    steps.push({ kind: "expectEqual", actual: typedActual, expected: typedExpected });
  }
  return steps;
}

function irDiagnosticFromIssues(issues: readonly ValidationIssue[]): readonly IRDiagnostic[] {
  return issues.map((issue) => ({
    code: `decode.${issue.code}`,
    message: issue.message,
    scope: issue.path,
  }));
}

export function decodeSemanticIRDocument(input: unknown): DocumentDecodeResult {
  const issues: ValidationIssue[] = [];
  const record = asRecord(input);
  if (record === undefined) {
    return { ok: false, diagnostics: [{ code: "decode.document", message: "document must be a JSON object", scope: "$" }] };
  }
  if (record.format !== "execspec") {
    return { ok: false, diagnostics: [{ code: "decode.format", message: `unexpected format ${JSON.stringify(record.format)}`, scope: "$" }] };
  }
  if (record.irVersion !== 1) {
    return { ok: false, diagnostics: [{ code: "decode.irVersion", message: `unsupported IR version ${JSON.stringify(record.irVersion)}`, scope: "$" }] };
  }
  const semantic = asRecord(record.semantic);
  if (semantic === undefined) {
    return { ok: false, diagnostics: [{ code: "decode.semantic", message: "semantic subtree must be an object", scope: "$.semantic" }] };
  }
  if (typeof semantic.specificationName !== "string" || typeof semantic.specificationVersion !== "string") {
    return { ok: false, diagnostics: [{ code: "decode.specification", message: "specificationName and specificationVersion must be strings", scope: "$.semantic" }] };
  }

  const types: TypeDeclaration[] = [];
  if (Array.isArray(semantic.types)) {
    for (const [index, rawType] of semantic.types.entries()) {
      const declaration = decodeTypeDeclaration(rawType, issues, `$.semantic.types[${index}]`);
      if (declaration !== undefined) {
        types.push(declaration);
      }
    }
  } else {
    issues.push({ path: "$.semantic.types", code: "expectedArray", message: "types must be an array" });
  }

  const operations: OperationIR[] = [];
  if (Array.isArray(semantic.operations)) {
    for (const [index, rawOperation] of semantic.operations.entries()) {
      const operationRecord = asRecord(rawOperation);
      const path = `$.semantic.operations[${index}]`;
      if (operationRecord === undefined || typeof operationRecord.id !== "string" || !isOperationId(operationRecord.id)) {
        issues.push({ path, code: "invalidOperationId", message: `${path}: invalid operation ID` });
        continue;
      }
      const inputType = decodeValueType(operationRecord.input, issues, `${path}.input`);
      const outputType = decodeValueType(operationRecord.output, issues, `${path}.output`);
      if (inputType === undefined || outputType === undefined) {
        continue;
      }
      operations.push({
        id: operationRecord.id as OperationId,
        input: inputType,
        output: outputType,
      });
    }
  } else {
    issues.push({ path: "$.semantic.operations", code: "expectedArray", message: "operations must be an array" });
  }

  if (issues.length > 0) {
    return { ok: false, diagnostics: irDiagnosticFromIssues(issues) };
  }

  const irTypeEnvironment = buildIRTypeEnvironment({
    specificationName: semantic.specificationName,
    specificationVersion: semantic.specificationVersion,
    types,
    operations,
    scenarios: [],
  });
  const typeEnvironment: TypeEnvironment = { declarations: irTypeEnvironment.declarations };

  const scenarios: ScenarioIR[] = [];
  if (Array.isArray(semantic.scenarios)) {
    for (const [index, rawScenario] of semantic.scenarios.entries()) {
      const scenarioRecord = asRecord(rawScenario);
      const path = `$.semantic.scenarios[${index}]`;
      if (
        scenarioRecord === undefined ||
        typeof scenarioRecord.id !== "string" ||
        !isScenarioId(scenarioRecord.id) ||
        typeof scenarioRecord.description !== "string" ||
        !Array.isArray(scenarioRecord.steps)
      ) {
        issues.push({ path, code: "invalidScenario", message: `${path}: invalid scenario shape` });
        continue;
      }
      const partialSteps: PartialStep[] = [];
      for (const [stepIndex, rawStep] of scenarioRecord.steps.entries()) {
        const stepRecord = asRecord(rawStep);
        const stepPath = `${path}.steps[${stepIndex}]`;
        if (stepRecord === undefined || (stepRecord.kind !== "call" && stepRecord.kind !== "expectEqual")) {
          issues.push({ path: stepPath, code: "invalidStep", message: `${stepPath}: unknown step kind` });
          continue;
        }
        partialSteps.push({ kind: stepRecord.kind, raw: stepRecord });
      }
      const steps = decodeStepsTypeDirected(
        partialSteps,
        { declarations: irTypeEnvironment.declarations, operations: irTypeEnvironment.operations, typeEnvironment },
        issues,
        path,
      );
      if (steps !== undefined) {
        scenarios.push({
          id: scenarioRecord.id as ScenarioId,
          description: scenarioRecord.description,
          steps,
        });
      }
    }
  } else {
    issues.push({ path: "$.semantic.scenarios", code: "expectedArray", message: "scenarios must be an array" });
  }

  if (issues.length > 0) {
    return { ok: false, diagnostics: irDiagnosticFromIssues(issues) };
  }

  const metadataRecord = asRecord(record.metadata);
  const sourceLocations: Record<string, SourceLocation> = {};
  if (metadataRecord !== undefined && asRecord(metadataRecord.sourceLocations) !== undefined) {
    const rawLocations = asRecord(metadataRecord.sourceLocations);
    for (const [key, rawLocation] of Object.entries(rawLocations ?? {})) {
      const location = asRecord(rawLocation);
      if (location === undefined || typeof location.file !== "string" || typeof location.line !== "number" || typeof location.column !== "number") {
        issues.push({ path: `$.metadata.sourceLocations.${key}`, code: "invalidSourceLocation", message: "source location must be {file, line, column}" });
        continue;
      }
      sourceLocations[key] = { file: location.file, line: location.line, column: location.column };
    }
  }

  if (issues.length > 0) {
    return { ok: false, diagnostics: irDiagnosticFromIssues(issues) };
  }

  const ir: SemanticIR = {
    specificationName: semantic.specificationName,
    specificationVersion: semantic.specificationVersion,
    types,
    operations,
    scenarios,
  };

  const validation = validateSemanticIR(ir);
  if (validation.length > 0) {
    return { ok: false, diagnostics: validation };
  }

  return {
    ok: true,
    document: {
      format: "execspec",
      irVersion: 1,
      semantic: ir,
      metadata: { sourceLocations },
    },
    diagnostics: [],
  };
}
