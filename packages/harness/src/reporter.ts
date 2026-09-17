/**
 * Human reporter (plan Task 33). Canonical scenario ID order, no ANSI
 * colors, structural diff paths in failure blocks.
 */

import type { EqualityDifference, ScenarioId, SemanticValue } from "@execspec/core";
import { compareByCodePoint } from "@execspec/core";
import type { ScenarioResult } from "./runner.js";

export function renderSemanticValue(value: SemanticValue): string {
  switch (value.kind) {
    case "unit":
      return "unit";
    case "boolean":
      return value.value ? "true" : "false";
    case "int64":
      return value.value.toString(10);
    case "string":
      return JSON.stringify(value.value);
    case "list":
      return `[${value.values.map(renderSemanticValue).join(", ")}]`;
    case "struct": {
      const fields = [...value.fields.keys()].sort(compareByCodePoint);
      const rendered = fields.map((name) => {
        const field = value.fields.get(name);
        return `${name}: ${field === undefined ? "?" : renderSemanticValue(field)}`;
      });
      return `{${rendered.join(", ")}}`;
    }
    case "enum":
      return value.case;
    case "union":
      return value.value === undefined
        ? `${value.case}`
        : `${value.case}(${renderSemanticValue(value.value)})`;
  }
}

function renderDifference(difference: EqualityDifference): string {
  return [
    difference.path,
    `  expected: ${renderSemanticValue(difference.expected)}`,
    `  actual:   ${renderSemanticValue(difference.actual)}`,
  ].join("\n");
}

export function renderReport(results: readonly ScenarioResult[]): string {
  const ordered = [...results].sort((left, right) =>
    compareByCodePoint(left.scenarioId as string, right.scenarioId as string),
  );
  const passed = ordered.filter((result) => result.status === "pass");
  const failed = ordered.filter((result) => result.status === "fail");
  const lines: string[] = [];

  for (const result of ordered) {
    if (result.status === "pass") {
      lines.push(`PASS ${result.scenarioId}`);
      continue;
    }
    lines.push(`FAIL ${result.scenarioId}`);
    lines.push("");
    const failure = result.failure;
    if (failure?.stepIndex !== null && failure?.stepIndex !== undefined) {
      lines.push(`step ${failure.stepIndex} ${stepKindOf(result)}`);
      lines.push("");
    }
    if (failure?.kind === "ExpectationFailure" && failure.diffs !== undefined) {
      lines.push(failure.diffs.map(renderDifference).join("\n\n"));
    } else if (failure !== undefined) {
      lines.push(failure.message);
      if (failure.stderrExcerpt !== undefined && failure.stderrExcerpt.length > 0) {
        lines.push("");
        lines.push("stderr:");
        lines.push(failure.stderrExcerpt);
      }
    }
  }

  if (lines.length > 0 && lines[lines.length - 1] !== "") {
    lines.push("");
  }
  lines.push(`${passed.length} passed, ${failed.length} failed`);
  return `${lines.join("\n")}\n`;
}

function stepKindOf(result: ScenarioResult): string {
  if (result.failure?.kind === "ExpectationFailure") {
    return "expectEqual";
  }
  return result.failure?.kind ?? "unknown";
}

export function summarize(results: readonly ScenarioResult[]): {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
} {
  const passed = results.filter((result) => result.status === "pass").length;
  return { total: results.length, passed, failed: results.length - passed };
}
