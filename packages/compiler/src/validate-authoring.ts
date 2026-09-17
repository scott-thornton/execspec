/**
 * Structural validation of authoring graphs (plan Task 17, stage 1).
 *
 * The graph may come straight from a dynamically imported module, so
 * this walk is total (never throws) and treats everything as unknown.
 */

import {
  isMemberName,
  isOperationId,
  isScenarioId,
  isSemanticValue,
  isTypeDeclaration,
  isValueType,
} from "@execspec/core";
import type { CompilerDiagnostic } from "./diagnostics.js";

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function isOptionalMarker(value: unknown): boolean {
  return (
    typeof value === "object" &&
    value !== null &&
    "__execspecOptionalField" in value
  );
}

function checkNoOptionalMarkers(
  type: unknown,
  scope: string,
  diagnostics: CompilerDiagnostic[],
): void {
  if (isOptionalMarker(type)) {
    diagnostics.push({
      code: "authoring.optionalMisuse",
      message: "optional() is only permitted on struct fields",
      scope,
    });
    return;
  }
  const record = asRecord(type);
  if (record?.kind === "list") {
    checkNoOptionalMarkers(record.element, scope, diagnostics);
  }
}

function checkExpression(
  value: unknown,
  scope: string,
  diagnostics: CompilerDiagnostic[],
): void {
  const record = asRecord(value);
  if (record === undefined) {
    diagnostics.push({ code: "authoring.expression", message: "expression must be an object", scope });
    return;
  }
  if (record.kind === "literal") {
    if (!isSemanticValue(record.value)) {
      diagnostics.push({ code: "authoring.literal", message: "literal must be a canonical semantic value", scope });
    }
    return;
  }
  if (record.kind === "binding") {
    if (typeof record.binding !== "string" || !isMemberName(record.binding)) {
      diagnostics.push({ code: "authoring.binding", message: "binding name must be a lower camel case string", scope });
    }
    return;
  }
  if (record.kind === "field") {
    if (typeof record.field !== "string" || !isMemberName(record.field)) {
      diagnostics.push({ code: "authoring.fieldName", message: "field name must be a lower camel case string", scope });
    }
    checkExpression(record.base, `${scope}.base`, diagnostics);
    if (asRecord(record.base)?.kind === "literal") {
      diagnostics.push({
        code: "authoring.fieldLiteralBase",
        message: "field expressions must not traverse literal bases",
        scope,
      });
    }
    return;
  }
  diagnostics.push({ code: "authoring.expressionKind", message: "unknown expression kind", scope });
}

export function validateAuthoringGraph(graph: unknown): readonly CompilerDiagnostic[] {
  const diagnostics: CompilerDiagnostic[] = [];
  const record = asRecord(graph);
  if (record === undefined) {
    return [{ code: "authoring.graph", message: "authoring graph must be an object", scope: "$" }];
  }
  if (typeof record.specificationName !== "string" || record.specificationName.length === 0) {
    diagnostics.push({ code: "authoring.name", message: "specificationName must be a non-empty string", scope: "$" });
  }
  if (typeof record.specificationVersion !== "string" || record.specificationVersion.length === 0) {
    diagnostics.push({ code: "authoring.version", message: "specificationVersion must be a non-empty string", scope: "$" });
  }
  if (!Array.isArray(record.types)) {
    diagnostics.push({ code: "authoring.types", message: "types must be an array", scope: "$.types" });
  } else {
    record.types.forEach((entry, index) => {
      if (!isTypeDeclaration(entry)) {
        diagnostics.push({
          code: "authoring.typeDeclaration",
          message: `types[${index}] is not a valid declaration`,
          scope: `$.types[${index}]`,
        });
      }
    });
  }
  if (!Array.isArray(record.operations)) {
    diagnostics.push({ code: "authoring.operations", message: "operations must be an array", scope: "$.operations" });
  } else {
    record.operations.forEach((entry, index) => {
      const scope = `$.operations[${index}]`;
      const operation = asRecord(entry);
      if (
        operation === undefined ||
        typeof operation.id !== "string" ||
        !isOperationId(operation.id) ||
        !isValueType(operation.input) ||
        !isValueType(operation.output)
      ) {
        diagnostics.push({ code: "authoring.operation", message: "invalid operation shape", scope });
        return;
      }
      checkNoOptionalMarkers(operation.input, `${scope}.input`, diagnostics);
      checkNoOptionalMarkers(operation.output, `${scope}.output`, diagnostics);
    });
  }
  if (!Array.isArray(record.scenarios)) {
    diagnostics.push({ code: "authoring.scenarios", message: "scenarios must be an array", scope: "$.scenarios" });
  } else {
    record.scenarios.forEach((entry, index) => {
      const scope = `$.scenarios[${index}]`;
      const scenario = asRecord(entry);
      if (
        scenario === undefined ||
        typeof scenario.id !== "string" ||
        !isScenarioId(scenario.id) ||
        typeof scenario.description !== "string" ||
        !Array.isArray(scenario.steps)
      ) {
        diagnostics.push({ code: "authoring.scenario", message: "invalid scenario shape", scope });
        return;
      }
      scenario.steps.forEach((rawStep, stepIndex) => {
        const stepScope = `${scope}.steps[${stepIndex}]`;
        const step = asRecord(rawStep);
        if (step === undefined) {
          diagnostics.push({ code: "authoring.step", message: "step must be an object", scope: stepScope });
          return;
        }
        if (step.kind === "call") {
          if (typeof step.binding !== "string" || !isMemberName(step.binding)) {
            diagnostics.push({ code: "authoring.callBinding", message: "invalid call binding name", scope: stepScope });
          }
          if (typeof step.operationId !== "string" || !isOperationId(step.operationId)) {
            diagnostics.push({ code: "authoring.callOperation", message: "invalid call operation ID", scope: stepScope });
          }
          checkExpression(step.input, `${stepScope}.input`, diagnostics);
          return;
        }
        if (step.kind === "expectEqual") {
          checkExpression(step.actual, `${stepScope}.actual`, diagnostics);
          checkExpression(step.expected, `${stepScope}.expected`, diagnostics);
          return;
        }
        diagnostics.push({ code: "authoring.stepKind", message: "unknown step kind", scope: stepScope });
      });
    });
  }
  return diagnostics;
}
