/**
 * Scenario expression evaluator (plan Task 31). Field traversal is
 * struct fields and the union payload pseudo-field only — no map-style
 * indexing.
 */

import type { SemanticValue, ValueExpressionIR } from "@execspec/core";

export interface ScenarioBindings {
  readonly values: ReadonlyMap<string, SemanticValue>;
}

export function evaluateExpression(
  expression: ValueExpressionIR,
  bindings: ScenarioBindings,
): SemanticValue {
  switch (expression.kind) {
    case "literal":
      return expression.value;
    case "binding": {
      const value = bindings.values.get(expression.binding);
      if (value === undefined) {
        throw new Error(`unknown binding '${expression.binding}'`);
      }
      return value;
    }
    case "field": {
      const base = evaluateExpression(expression.base, bindings);
      if (base.kind === "struct") {
        const field = base.fields.get(expression.field);
        if (field === undefined) {
          throw new Error(`struct '${base.typeId}' has no field '${expression.field}'`);
        }
        return field;
      }
      if (base.kind === "union") {
        if (expression.field !== "value") {
          throw new Error(`union '${base.typeId}' only supports the pseudo-field 'value'`);
        }
        if (base.value === undefined) {
          throw new Error(
            `union '${base.typeId}' case '${base.case}' carries no payload; 'value' is unavailable`,
          );
        }
        return base.value;
      }
      throw new Error(`cannot traverse field '${expression.field}' of a ${base.kind} value`);
    }
  }
}
