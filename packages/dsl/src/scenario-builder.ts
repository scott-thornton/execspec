/**
 * Scenario DSL (plan §2.6–2.8, Task 16). Scenarios are declarative
 * programs compiled to static Scenario IR; the builder never executes
 * operations and exposes no promises.
 */

import { parseMemberName, parseOperationId, parseScenarioId } from "@execspec/core";
import type { ScenarioId, ScenarioStepIR, ValueExpressionIR } from "@execspec/core";
import type { AuthoringScenario } from "@execspec/compiler";

export interface ScenarioBuilder {
  call(binding: string, operationId: string, input: ValueExpressionIR): ScenarioBuilder;
  expectEqual(actual: ValueExpressionIR, expected: ValueExpressionIR): ScenarioBuilder;
  build(): AuthoringScenario;
}

export function scenario(id: string, description: string): ScenarioBuilder {
  const scenarioId: ScenarioId = parseScenarioId(id);
  if (typeof description !== "string" || description.length === 0) {
    throw new Error(`scenario '${id}' requires a non-empty description`);
  }

  const steps: ScenarioStepIR[] = [];

  return {
    call(bindingName: string, operationId: string, input: ValueExpressionIR): ScenarioBuilder {
      parseMemberName(bindingName);
      parseOperationId(operationId);
      steps.push({ kind: "call", binding: bindingName, operationId: parseOperationId(operationId), input });
      return this;
    },
    expectEqual(actual: ValueExpressionIR, expected: ValueExpressionIR): ScenarioBuilder {
      steps.push({ kind: "expectEqual", actual, expected });
      return this;
    },
    build(): AuthoringScenario {
      return { id: scenarioId, description, steps: [...steps] };
    },
  };
}
