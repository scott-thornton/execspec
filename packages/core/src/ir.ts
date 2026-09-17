/**
 * Semantic IR v1 (docs/ir-v1.md). Types only — construction happens in
 * the compiler; decoding/encoding live in canonical-json/digest modules.
 */

import type { OperationId, ScenarioId } from "./ids.js";
import type { TypeDeclaration, ValueType } from "./types.js";
import type { SemanticValue } from "./semantic-value.js";

export interface OperationIR {
  readonly id: OperationId;
  readonly input: ValueType;
  readonly output: ValueType;
}

export type LiteralExpressionIR = {
  readonly kind: "literal";
  readonly value: SemanticValue;
};

export type BindingExpressionIR = {
  readonly kind: "binding";
  readonly binding: string;
};

export type FieldExpressionIR = {
  readonly kind: "field";
  readonly base: ValueExpressionIR;
  readonly field: string;
};

export type ValueExpressionIR =
  | LiteralExpressionIR
  | BindingExpressionIR
  | FieldExpressionIR;

export interface CallStepIR {
  readonly kind: "call";
  readonly binding: string;
  readonly operationId: OperationId;
  readonly input: ValueExpressionIR;
}

export interface ExpectEqualStepIR {
  readonly kind: "expectEqual";
  readonly actual: ValueExpressionIR;
  readonly expected: ValueExpressionIR;
}

export type ScenarioStepIR = CallStepIR | ExpectEqualStepIR;

export interface ScenarioIR {
  readonly id: ScenarioId;
  readonly description: string;
  readonly steps: readonly ScenarioStepIR[];
}

export interface SemanticIR {
  readonly specificationName: string;
  readonly specificationVersion: string;
  readonly types: readonly TypeDeclaration[];
  readonly operations: readonly OperationIR[];
  readonly scenarios: readonly ScenarioIR[];
}

export interface SourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export interface IRMetadata {
  readonly sourceLocations: Readonly<Record<string, SourceLocation>>;
}

export interface SemanticIRDocument {
  readonly format: "execspec";
  readonly irVersion: 1;
  readonly semantic: SemanticIR;
  readonly metadata: IRMetadata;
}
