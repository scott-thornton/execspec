/**
 * Scenario value expressions (plan §2.8). Static data only — no
 * callbacks, no promises, no arbitrary computation.
 */

import { parseMemberName } from "@execspec/core";
import type {
  BindingExpressionIR,
  FieldExpressionIR,
  LiteralExpressionIR,
  SemanticValue,
  ValueExpressionIR,
} from "@execspec/core";

export function literal(value: SemanticValue): LiteralExpressionIR {
  return { kind: "literal", value };
}

export function binding(name: string): BindingExpressionIR {
  parseMemberName(name);
  return { kind: "binding", binding: name };
}

export function field(base: ValueExpressionIR, fieldName: string): FieldExpressionIR {
  if (base.kind === "literal") {
    throw new Error(
      "field() base must not be a literal: literals carry no static type context in v0.1",
    );
  }
  parseMemberName(fieldName);
  return { kind: "field", base, field: fieldName };
}
