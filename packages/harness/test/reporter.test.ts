import { test } from "node:test";
import assert from "node:assert/strict";

import {
  stringValue,
  unionValue,
  structValue,
  listValue,
} from "@execspec/core";
import type { ScenarioId } from "@execspec/core";
import { renderReport, renderSemanticValue } from "../src/reporter.js";
import type { ScenarioResult } from "../src/runner.js";

test("value rendering is compact and deterministic", () => {
  assert.equal(renderSemanticValue(stringValue("one")), '"one"');
  assert.equal(renderSemanticValue(unionValue("GetResult", "found", stringValue("one"))), 'found("one")');
  assert.equal(renderSemanticValue(unionValue("GetResult", "missing")), "missing");
  assert.equal(
    renderSemanticValue(structValue("KeyList", new Map([["keys", listValue([stringValue("a"), stringValue("b")])]]))),
    '{keys: ["a", "b"]}',
  );
});

test("successful output follows the canonical format", () => {
  const results: ScenarioResult[] = [
    { scenarioId: "kv.put.then-get" as ScenarioId, status: "pass" },
    { scenarioId: "kv.get.missing" as ScenarioId, status: "pass" },
    { scenarioId: "kv.list" as ScenarioId, status: "pass" },
  ];
  assert.equal(
    renderReport(results),
    [
      "PASS kv.get.missing",
      "PASS kv.list",
      "PASS kv.put.then-get",
      "",
      "3 passed, 0 failed",
      "",
    ].join("\n"),
  );
});

test("failure output includes step number and structural diff paths", () => {
  const results: ScenarioResult[] = [
    { scenarioId: "kv.get.missing" as ScenarioId, status: "pass" },
    {
      scenarioId: "kv.put.then-get" as ScenarioId,
      status: "fail",
      failure: {
        kind: "ExpectationFailure",
        scenarioId: "kv.put.then-get" as ScenarioId,
        stepIndex: 3,
        message: "expectEqual found differences",
        diffs: [
          {
            path: "$.value",
            expected: stringValue("one"),
            actual: stringValue("two"),
          },
        ],
      },
    },
  ];
  assert.equal(
    renderReport(results),
    [
      "PASS kv.get.missing",
      "FAIL kv.put.then-get",
      "",
      "step 3 expectEqual",
      "",
      "$.value",
      '  expected: "one"',
      '  actual:   "two"',
      "",
      "1 passed, 1 failed",
      "",
    ].join("\n"),
  );
});

test("non-expectation failures print the message and stderr excerpt", () => {
  const results: ScenarioResult[] = [
    {
      scenarioId: "kv.crash" as ScenarioId,
      status: "fail",
      failure: {
        kind: "HostCrashFailure",
        scenarioId: "kv.crash" as ScenarioId,
        stepIndex: 1,
        message: "host exited with code 1 before responding",
        stderrExcerpt: "simulated crash",
      },
    },
  ];
  const rendered = renderReport(results);
  assert.ok(rendered.includes("FAIL kv.crash"));
  assert.ok(rendered.includes("host exited with code 1 before responding"));
  assert.ok(rendered.includes("stderr:"));
  assert.ok(rendered.includes("simulated crash"));
  assert.ok(rendered.endsWith("0 passed, 1 failed\n"));
});
