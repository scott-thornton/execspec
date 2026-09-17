/**
 * AuthoringGraph: what the DSL constructs and the compiler consumes.
 * Authoring shape only - no target-language knowledge.
 */

import type { OperationId, ScenarioId } from "@execspec/core";
import type { TypeDeclaration, ValueType } from "@execspec/core";
import type { ScenarioStepIR } from "@execspec/core";

export interface AuthoringOperation {
  readonly id: OperationId;
  readonly input: ValueType;
  readonly output: ValueType;
}

export interface AuthoringScenario {
  readonly id: ScenarioId;
  readonly description: string;
  readonly steps: readonly ScenarioStepIR[];
}

export interface AuthoringGraph {
  readonly specificationName: string;
  readonly specificationVersion: string;
  readonly types: readonly TypeDeclaration[];
  readonly operations: readonly AuthoringOperation[];
  readonly scenarios: readonly AuthoringScenario[];
}

/** Marks an AuthoringGraph-shaped value coming from an untrusted module
 *  boundary (the CLI dynamically imports spec modules). */
export function isAuthoringGraph(value: unknown): value is AuthoringGraph {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const candidate = value as Partial<AuthoringGraph>;
  return (
    typeof candidate.specificationName === "string" &&
    typeof candidate.specificationVersion === "string" &&
    Array.isArray(candidate.types) &&
    Array.isArray(candidate.operations) &&
    Array.isArray(candidate.scenarios)
  );
}
