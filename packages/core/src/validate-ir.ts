/**
 * Semantic IR validation and static expression type inference
 * (docs/ir-v1.md §5). Invalid specifications fail here, before any
 * target code is generated.
 */

import type { OperationId, ScenarioId, TypeId } from "./ids.js";
import { isMemberName, isOperationId, isScenarioId, isTypeId } from "./ids.js";
import type { TypeDeclaration, ValueType } from "./types.js";
import type { OperationIR, ScenarioIR, ScenarioStepIR, SemanticIR, ValueExpressionIR } from "./ir.js";
import type { SemanticValue } from "./semantic-value.js";
import { validateValue } from "./validate-value.js";
import type { TypeEnvironment, ValidationIssue } from "./validate-value.js";

export interface IRTypeEnvironment {
  readonly declarations: ReadonlyMap<TypeId, TypeDeclaration>;
  readonly operations: ReadonlyMap<OperationId, OperationIR>;
}

export interface IRDiagnostic {
  readonly code: string;
  readonly message: string;
  readonly scope: string;
}

export class IRTypeError extends Error {
  public constructor(message: string) {
    super(message);
    this.name = "IRTypeError";
  }
}

export function buildIRTypeEnvironment(ir: SemanticIR): IRTypeEnvironment {
  return {
    declarations: new Map(ir.types.map((declaration) => [declaration.id as TypeId, declaration])),
    operations: new Map(ir.operations.map((operation) => [operation.id, operation])),
  };
}

function typeEnvironment(environment: IRTypeEnvironment): TypeEnvironment {
  return { declarations: environment.declarations };
}

export function typeEquals(left: ValueType, right: ValueType): boolean {
  if (left.kind !== right.kind) {
    return false;
  }
  switch (left.kind) {
    case "unit":
    case "boolean":
    case "int64":
    case "string":
      return true;
    case "ref":
      return left.typeId === (right as { typeId: string }).typeId;
    case "list":
      return typeEquals(left.element, (right as { element: ValueType }).element);
  }
}

/** Static type of a semantic value: primitives map to their kind,
 *  nominal values map to their type reference. */
export function staticTypeOfValue(value: SemanticValue): ValueType {
  switch (value.kind) {
    case "unit":
      return { kind: "unit" };
    case "boolean":
      return { kind: "boolean" };
    case "int64":
      return { kind: "int64" };
    case "string":
      return { kind: "string" };
    case "list": {
      if (value.values.length === 0) {
        throw new IRTypeError("cannot infer a static type for an empty list literal");
      }
      const elementTypes = value.values.map((element) => staticTypeOfValue(element));
      const first = elementTypes[0];
      if (first === undefined || !elementTypes.every((type) => typeEquals(type, first))) {
        throw new IRTypeError("cannot infer a static type for a heterogeneous list literal");
      }
      return { kind: "list", element: first };
    }
    case "struct":
    case "enum":
    case "union":
      return { kind: "ref", typeId: value.typeId };
  }
}

export function inferExpressionType(
  expression: ValueExpressionIR,
  bindings: ReadonlyMap<string, ValueType>,
  environment: IRTypeEnvironment,
): ValueType {
  switch (expression.kind) {
    case "literal":
      return staticTypeOfValue(expression.value);
    case "binding": {
      const bound = bindings.get(expression.binding);
      if (bound === undefined) {
        throw new IRTypeError(`unknown binding '${expression.binding}'`);
      }
      return bound;
    }
    case "field": {
      const base = inferExpressionType(expression.base, bindings, environment);
      if (base.kind !== "ref") {
        throw new IRTypeError(
          `field '${expression.field}' applied to non-nominal type '${base.kind}'`,
        );
      }
      const declaration = environment.declarations.get(base.typeId as TypeId);
      if (declaration === undefined) {
        throw new IRTypeError(`unknown type reference '${base.typeId}'`);
      }
      if (!isMemberName(expression.field)) {
        throw new IRTypeError(`invalid member name '${expression.field}'`);
      }
      if (declaration.kind === "struct") {
        const field = declaration.fields.find((entry) => entry.name === expression.field);
        if (field === undefined) {
          throw new IRTypeError(
            `struct '${declaration.id}' has no field '${expression.field}'`,
          );
        }
        return field.type;
      }
      if (declaration.kind === "union") {
        if (expression.field !== "value") {
          throw new IRTypeError(
            `union '${declaration.id}' only supports the pseudo-field 'value'`,
          );
        }
        const payloads = declaration.cases
          .filter((entry) => entry.payload.kind !== "unit")
          .map((entry) => entry.payload);
        if (payloads.length === 0) {
          throw new IRTypeError(
            `union '${declaration.id}' has no payload cases, 'value' is not traversable`,
          );
        }
        const first = payloads[0];
        if (first === undefined || !payloads.every((payload) => typeEquals(payload, first))) {
          throw new IRTypeError(
            `union '${declaration.id}' has mixed payload types; 'value' traversal is ambiguous`,
          );
        }
        return first;
      }
      throw new IRTypeError(
        `type '${declaration.id}' is an enum; it has no traversable fields`,
      );
    }
  }
}

function literalIssuesAsDiagnostics(
  issues: readonly ValidationIssue[],
  scope: string,
): readonly IRDiagnostic[] {
  return issues.map((issue) => ({
    code: `literal.${issue.code}`,
    message: issue.message,
    scope,
  }));
}

export function validateSemanticIR(ir: SemanticIR): readonly IRDiagnostic[] {
  const diagnostics: IRDiagnostic[] = [];
  const scope = "specification";

  if (typeof ir.specificationName !== "string" || ir.specificationName.length === 0) {
    diagnostics.push({ code: "specification.name", message: "specification name must be a non-empty string", scope });
  }
  if (typeof ir.specificationVersion !== "string" || ir.specificationVersion.length === 0) {
    diagnostics.push({ code: "specification.version", message: "specification version must be a non-empty string", scope });
  }
  if (ir.operations.length === 0) {
    diagnostics.push({ code: "specification.noOperations", message: "a specification must declare at least one operation", scope });
  }
  if (ir.scenarios.length === 0) {
    diagnostics.push({ code: "specification.noScenarios", message: "a specification must declare at least one scenario", scope });
  }

  // Duplicate and grammar checks per namespace.
  const typeIds = new Set<string>();
  for (const declaration of ir.types) {
    if (!isTypeId(declaration.id)) {
      diagnostics.push({ code: "types.idGrammar", message: `invalid type ID '${String(declaration.id)}'`, scope: `type ${String(declaration.id)}` });
      continue;
    }
    if (typeIds.has(declaration.id)) {
      diagnostics.push({ code: "types.duplicate", message: `duplicate type '${declaration.id}'`, scope: `type ${declaration.id}` });
    }
    typeIds.add(declaration.id);
  }

  const operationIds = new Set<string>();
  for (const operation of ir.operations) {
    if (!isOperationId(operation.id)) {
      diagnostics.push({ code: "operations.idGrammar", message: `invalid operation ID '${String(operation.id)}'`, scope: `operation ${String(operation.id)}` });
      continue;
    }
    if (operationIds.has(operation.id)) {
      diagnostics.push({ code: "operations.duplicate", message: `duplicate operation '${operation.id}'`, scope: `operation ${operation.id}` });
    }
    operationIds.add(operation.id);
  }

  const scenarioIds = new Set<string>();
  for (const scenario of ir.scenarios) {
    if (!isScenarioId(scenario.id)) {
      diagnostics.push({ code: "scenarios.idGrammar", message: `invalid scenario ID '${String(scenario.id)}'`, scope: `scenario ${String(scenario.id)}` });
      continue;
    }
    if (scenarioIds.has(scenario.id)) {
      diagnostics.push({ code: "scenarios.duplicate", message: `duplicate scenario '${scenario.id}'`, scope: `scenario ${scenario.id}` });
    }
    scenarioIds.add(scenario.id);
  }

  const environment = buildIRTypeEnvironment(ir);

  // Declaration-local checks.
  for (const declaration of ir.types) {
    const declScope = `type ${String(declaration.id)}`;
    if (declaration.kind === "struct") {
      const fieldNames = new Set<string>();
      for (const field of declaration.fields) {
        if (!isMemberName(field.name)) {
          diagnostics.push({ code: "struct.fieldGrammar", message: `invalid field name '${field.name}'`, scope: declScope });
        }
        if (fieldNames.has(field.name)) {
          diagnostics.push({ code: "struct.duplicateField", message: `duplicate field '${field.name}'`, scope: declScope });
        }
        fieldNames.add(field.name);
        if (field.optional && field.type.kind === "unit") {
          diagnostics.push({ code: "struct.optionalUnit", message: `field '${field.name}' cannot be an optional unit`, scope: declScope });
        }
        diagnostics.push(...checkValueType(field.type, environment, declScope));
      }
    } else if (declaration.kind === "enum") {
      const caseNames = new Set<string>();
      for (const caseName of declaration.cases) {
        if (!isMemberName(caseName)) {
          diagnostics.push({ code: "enum.caseGrammar", message: `invalid case name '${caseName}'`, scope: declScope });
        }
        if (caseNames.has(caseName)) {
          diagnostics.push({ code: "enum.duplicateCase", message: `duplicate case '${caseName}'`, scope: declScope });
        }
        caseNames.add(caseName);
      }
    } else {
      const caseNames = new Set<string>();
      for (const unionCase of declaration.cases) {
        if (!isMemberName(unionCase.name)) {
          diagnostics.push({ code: "union.caseGrammar", message: `invalid case name '${unionCase.name}'`, scope: declScope });
        }
        if (caseNames.has(unionCase.name)) {
          diagnostics.push({ code: "union.duplicateCase", message: `duplicate case '${unionCase.name}'`, scope: declScope });
        }
        caseNames.add(unionCase.name);
        diagnostics.push(...checkValueType(unionCase.payload, environment, declScope));
      }
    }
  }

  diagnostics.push(...checkTypeCycles(ir, environment));

  for (const operation of ir.operations) {
    const operationScope = `operation ${String(operation.id)}`;
    diagnostics.push(...checkValueType(operation.input, environment, operationScope));
    diagnostics.push(...checkValueType(operation.output, environment, operationScope));
  }

  for (const scenario of ir.scenarios) {
    diagnostics.push(...validateScenario(scenario, environment));
  }

  return diagnostics;
}

function checkValueType(
  type: ValueType,
  environment: IRTypeEnvironment,
  scope: string,
): readonly IRDiagnostic[] {
  if (type.kind === "ref") {
    if (!environment.declarations.has(type.typeId as TypeId)) {
      return [{ code: "types.unknownReference", message: `unknown type reference '${type.typeId}'`, scope }];
    }
    return [];
  }
  if (type.kind === "list") {
    return checkValueType(type.element, environment, scope);
  }
  return [];
}

function referencedTypeIds(type: ValueType): readonly string[] {
  if (type.kind === "ref") {
    return [type.typeId];
  }
  if (type.kind === "list") {
    return referencedTypeIds(type.element);
  }
  return [];
}

function checkTypeCycles(
  ir: SemanticIR,
  environment: IRTypeEnvironment,
): readonly IRDiagnostic[] {
  const graph = new Map<string, readonly string[]>();
  for (const declaration of ir.types) {
    if (declaration.kind === "struct") {
      graph.set(
        declaration.id,
        declaration.fields.flatMap((field) => referencedTypeIds(field.type)),
      );
    } else if (declaration.kind === "union") {
      graph.set(
        declaration.id,
        declaration.cases.flatMap((unionCase) => referencedTypeIds(unionCase.payload)),
      );
    } else {
      graph.set(declaration.id, []);
    }
  }

  const diagnostics: IRDiagnostic[] = [];
  const state = new Map<string, "visiting" | "done">();
  const stack: string[] = [];

  const visit = (id: string): void => {
    const marked = state.get(id);
    if (marked === "done") {
      return;
    }
    if (marked === "visiting") {
      const cycleStart = stack.indexOf(id);
      const cycle = [...stack.slice(cycleStart === -1 ? 0 : cycleStart), id].join(" -> ");
      diagnostics.push({
        code: "types.recursive",
        message: `recursive types are not allowed in v0.1: ${cycle}`,
        scope: `type ${id}`,
      });
      return;
    }
    state.set(id, "visiting");
    stack.push(id);
    for (const next of graph.get(id) ?? []) {
      if (environment.declarations.has(next as TypeId)) {
        visit(next);
      }
    }
    stack.pop();
    state.set(id, "done");
  };

  for (const id of graph.keys()) {
    visit(id);
  }
  return diagnostics;
}

function validateScenario(
  scenario: ScenarioIR,
  environment: IRTypeEnvironment,
): readonly IRDiagnostic[] {
  const diagnostics: IRDiagnostic[] = [];
  const scope = `scenario ${String(scenario.id)}`;

  if (typeof scenario.description !== "string") {
    diagnostics.push({ code: "scenario.description", message: "scenario description must be a string", scope });
  }
  if (scenario.steps.length === 0) {
    diagnostics.push({ code: "scenario.noSteps", message: "a scenario must contain at least one step", scope });
    return diagnostics;
  }

  const bindings = new Map<string, ValueType>();

  scenario.steps.forEach((step: ScenarioStepIR, index: number) => {
    const stepScope = `${scope} step ${index + 1}`;
    if (step.kind === "call") {
      if (!isMemberName(step.binding)) {
        diagnostics.push({ code: "call.bindingGrammar", message: `invalid binding name '${step.binding}'`, scope: stepScope });
      }
      if (bindings.has(step.binding)) {
        diagnostics.push({ code: "call.duplicateBinding", message: `duplicate binding '${step.binding}'`, scope: stepScope });
      }
      const operation = environment.operations.get(step.operationId);
      if (operation === undefined) {
        diagnostics.push({
          code: "call.unknownOperation",
          message: `call to unknown operation '${String(step.operationId)}'`,
          scope: stepScope,
        });
        return;
      }
      const inputType = safeInfer(step.input, bindings, environment, stepScope, diagnostics);
      if (inputType !== undefined && !typeEquals(inputType, operation.input)) {
        diagnostics.push({
          code: "call.inputTypeMismatch",
          message: `input type ${describeType(inputType)} does not match operation input ${describeType(operation.input)}`,
          scope: stepScope,
        });
      }
      if (step.input.kind === "literal") {
        const issues = validateValue(
          step.input.value,
          operation.input,
          typeEnvironment(environment),
        );
        diagnostics.push(...literalIssuesAsDiagnostics(issues, stepScope));
      }
      bindings.set(step.binding, operation.output);
      return;
    }

    const actualType = safeInfer(step.actual, bindings, environment, stepScope, diagnostics);
    const expectedType = safeInfer(step.expected, bindings, environment, stepScope, diagnostics);
    if (actualType !== undefined && expectedType !== undefined && !typeEquals(actualType, expectedType)) {
      diagnostics.push({
        code: "expectEqual.typeMismatch",
        message: `expectEqual sides have different types: ${describeType(actualType)} vs ${describeType(expectedType)}`,
        scope: stepScope,
      });
    }
    if (actualType !== undefined && step.expected.kind === "literal") {
      const issues = validateValue(step.expected.value, actualType, typeEnvironment(environment));
      diagnostics.push(...literalIssuesAsDiagnostics(issues, stepScope));
    }
    if (expectedType !== undefined && step.actual.kind === "literal") {
      const issues = validateValue(step.actual.value, expectedType, typeEnvironment(environment));
      diagnostics.push(...literalIssuesAsDiagnostics(issues, stepScope));
    }
  });

  return diagnostics;
}

function safeInfer(
  expression: ValueExpressionIR,
  bindings: ReadonlyMap<string, ValueType>,
  environment: IRTypeEnvironment,
  scope: string,
  diagnostics: IRDiagnostic[],
): ValueType | undefined {
  try {
    return inferExpressionType(expression, bindings, environment);
  } catch (error) {
    diagnostics.push({
      code: "expression.typeError",
      message: error instanceof Error ? error.message : String(error),
      scope,
    });
    return undefined;
  }
}

function describeType(type: ValueType): string {
  switch (type.kind) {
    case "unit":
    case "boolean":
    case "int64":
    case "string":
      return type.kind;
    case "ref":
      return type.typeId;
    case "list":
      return `list<${describeType(type.element)}>`;
  }
}
