/**
 * Scenario runner (plan Task 32). Fresh host per scenario; steps run in
 * authored order; outputs are validated in both directions of the wire.
 */

import {
  buildIRTypeEnvironment,
  compareByCodePoint,
  decodeSemanticValue,
  encodeSemanticValue,
  semanticDiff,
  specificationDigest,
  validateValue,
} from "@execspec/core";
import type {
  EqualityDifference,
  OperationId,
  ScenarioIR,
  ScenarioStepIR,
  SemanticIRDocument,
  SemanticValue,
  TypeEnvironment,
  ValidationIssue,
} from "@execspec/core";
import { spawnHost } from "./host-process.js";
import type { HostCommand, HostProcess } from "./host-process.js";
import { evaluateExpression } from "./evaluator.js";
import { ConformanceError, toConformanceFailure } from "./failures.js";
import type { ConformanceFailure } from "./failures.js";

export interface ScenarioResult {
  readonly scenarioId: ScenarioIR["id"];
  readonly status: "pass" | "fail";
  readonly failure?: ConformanceFailure;
}

export interface RunOptions {
  readonly hostCommand: HostCommand;
  readonly timeoutMs: number;
}

export async function runScenario(
  document: SemanticIRDocument,
  scenario: ScenarioIR,
  options: RunOptions,
): Promise<ScenarioResult> {
  let failure: ConformanceFailure | undefined;

  let host: HostProcess;
  try {
    host = await spawnHost(options.hostCommand);
  } catch (error) {
    return {
      scenarioId: scenario.id,
      status: "fail",
      failure: toConformanceFailure(error, scenario.id, null),
    };
  }

  const environment = buildIRTypeEnvironment(document.semantic);
  const typeEnvironment: TypeEnvironment = { declarations: environment.declarations };
  const digest = specificationDigest(document.semantic);

  try {
    try {
      await host.handshake(digest, options.timeoutMs);
    } catch (error) {
      failure = toConformanceFailure(error, scenario.id, null);
      return finish(host, scenario, failure);
    }

    const bindings = new Map<string, SemanticValue>();

    for (const [index, step] of scenario.steps.entries()) {
      const stepNumber = index + 1;
      if (step.kind === "call") {
        try {
          await runCallStep(step, document, typeEnvironment, bindings, host, options);
        } catch (error) {
          failure = toConformanceFailure(error, scenario.id, stepNumber);
          break;
        }
      } else {
        const differences = runExpectEqualStep(step, bindings);
        if (differences.length > 0) {
          failure = {
            kind: "ExpectationFailure",
            scenarioId: scenario.id,
            stepIndex: stepNumber,
            message: "expectEqual found differences",
            diffs: differences,
          };
          break;
        }
      }
    }
  } catch (error) {
    if (failure === undefined) {
      failure = toConformanceFailure(error, scenario.id, null);
    }
  }

  return finish(host, scenario, failure);
}

async function runCallStep(
  step: ScenarioStepIR & { readonly kind: "call" },
  document: SemanticIRDocument,
  typeEnvironment: TypeEnvironment,
  bindings: Map<string, SemanticValue>,
  host: HostProcess,
  options: RunOptions,
): Promise<void> {
  const operation = document.semantic.operations.find((entry) => entry.id === step.operationId);
  if (operation === undefined) {
    throw new ConformanceError(
      "ProtocolFailure",
      `unknown operation '${step.operationId}'`,
    );
  }
  const input = evaluateExpression(step.input, { values: bindings });
  const inputIssues = validateValue(input, operation.input, typeEnvironment);
  if (inputIssues.length > 0) {
    throw new ConformanceError(
      "ProtocolFailure",
      `internal: input failed validation: ${formatIssues(inputIssues)}`,
    );
  }
  const encodedInput = encodeSemanticValue(input, operation.input, typeEnvironment);
  const outputJson = await host.request(step.operationId as OperationId, encodedInput, options.timeoutMs);
  const decoded = decodeSemanticValue(outputJson, operation.output, typeEnvironment);
  if (!decoded.ok) {
    throw new ConformanceError(
      "InvalidOutputFailure",
      `host output rejected: ${formatIssues(decoded.issues)}`,
      host.stderrExcerpt(),
    );
  }
  const outputIssues = validateValue(decoded.value, operation.output, typeEnvironment);
  if (outputIssues.length > 0) {
    throw new ConformanceError(
      "InvalidOutputFailure",
      `host output failed validation: ${formatIssues(outputIssues)}`,
      host.stderrExcerpt(),
    );
  }
  bindings.set(step.binding, decoded.value);
}

function runExpectEqualStep(
  step: ScenarioStepIR & { readonly kind: "expectEqual" },
  bindings: ReadonlyMap<string, SemanticValue>,
): readonly EqualityDifference[] {
  const actual = evaluateExpression(step.actual, { values: bindings });
  const expected = evaluateExpression(step.expected, { values: bindings });
  return semanticDiff(expected, actual);
}

async function finish(
  host: HostProcess,
  scenario: ScenarioIR,
  failure: ConformanceFailure | undefined,
): Promise<ScenarioResult> {
  let closeFailure: ConformanceFailure | undefined;
  try {
    await host.close();
  } catch (error) {
    closeFailure = toConformanceFailure(error, scenario.id, failure?.stepIndex ?? null);
  }
  const effective = failure ?? closeFailure;
  if (effective === undefined) {
    return { scenarioId: scenario.id, status: "pass" as const };
  }
  return { scenarioId: scenario.id, status: "fail" as const, failure: effective };
}

function formatIssues(issues: readonly ValidationIssue[]): string {
  return issues.map((issue) => `${issue.path}: ${issue.code} (${issue.message})`).join("; ");
}

export async function runSpecification(
  document: SemanticIRDocument,
  options: RunOptions,
): Promise<readonly ScenarioResult[]> {
  const ordered = [...document.semantic.scenarios].sort((left, right) =>
    compareByCodePoint(left.id, right.id),
  );
  const results: ScenarioResult[] = [];
  for (const scenario of ordered) {
    results.push(await runScenario(document, scenario, options));
  }
  return results;
}
