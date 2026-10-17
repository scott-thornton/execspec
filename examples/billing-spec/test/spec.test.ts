import { test } from "node:test";
import assert from "node:assert/strict";
import graph from "../src/spec.js";
import { compileSpecification } from "@execspec/compiler";

test("the billing specification compiles cleanly", () => {
  const result = compileSpecification(graph);
  if (!result.ok) {
    assert.fail(result.diagnostics.map((d) => d.message).join("\n"));
  }
  assert.equal(result.document.semantic.operations.length, 4);
  assert.equal(result.document.semantic.scenarios.length, 9);
});
