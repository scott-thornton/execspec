/**
 * Operation DSL (plan Task 15). One semantic input, one semantic output;
 * no throws, no sync/async - execution asynchrony is target-level.
 */

import { parseOperationId } from "@execspec/core";
import type { OperationId, ValueType } from "@execspec/core";
import type { AuthoringOperation } from "@execspec/compiler";
import { isOptionalFieldMarker } from "./type-builders.js";

export interface OperationSpec {
  readonly input: ValueType;
  readonly output: ValueType;
}

function assertNoOptionalMarkers(type: ValueType, where: string): void {
  if (isOptionalFieldMarker(type)) {
    throw new Error(`optional() is only permitted on struct fields, not ${where}`);
  }
  if (type.kind === "list") {
    assertNoOptionalMarkers(type.element, `${where} list elements`);
  }
}

export function operation(id: string, spec: OperationSpec): AuthoringOperation {
  const operationId: OperationId = parseOperationId(id);
  assertNoOptionalMarkers(spec.input, `operation '${id}' input`);
  assertNoOptionalMarkers(spec.output, `operation '${id}' output`);
  return { id: operationId, input: spec.input, output: spec.output };
}
