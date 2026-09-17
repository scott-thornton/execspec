/**
 * Conformance failure classification (plan Task 32). Protocol, process,
 * decoding, crash, and timeout failures are implementation/harness
 * failures — never domain values.
 */

import type { ScenarioId } from "@execspec/core";
import type { EqualityDifference } from "@execspec/core";

export type FailureKind =
  | "HandshakeFailure"
  | "HostCrashFailure"
  | "OperationTimeoutFailure"
  | "ProtocolFailure"
  | "InvalidOutputFailure"
  | "ExpectationFailure"
  | "HostShutdownFailure"
  | "ImplementationExceptionFailure";

export interface ConformanceFailure {
  readonly kind: FailureKind;
  readonly scenarioId: ScenarioId;
  readonly stepIndex: number | null;
  readonly message: string;
  readonly stderrExcerpt?: string | undefined;
  readonly diffs?: readonly EqualityDifference[] | undefined;
}

/** Error thrown by harness internals; the runner converts it into a
 *  ConformanceFailure with scenario and step context. */
export class ConformanceError extends Error {
  public readonly kind: FailureKind;
  public readonly stderrExcerpt?: string | undefined;

  public constructor(kind: FailureKind, message: string, stderrExcerpt?: string | undefined) {
    super(message);
    this.name = "ConformanceError";
    this.kind = kind;
    this.stderrExcerpt = stderrExcerpt;
  }
}

export function toConformanceFailure(
  error: unknown,
  scenarioId: ScenarioId,
  stepIndex: number | null,
): ConformanceFailure {
  if (error instanceof ConformanceError) {
    const base = {
      kind: error.kind,
      scenarioId,
      stepIndex,
      message: error.message,
    };
    return error.stderrExcerpt === undefined
      ? base
      : { ...base, stderrExcerpt: error.stderrExcerpt };
  }
  return {
    kind: "ProtocolFailure",
    scenarioId,
    stepIndex,
    message: error instanceof Error ? error.message : String(error),
  };
}
