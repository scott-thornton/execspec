import { test } from "node:test";
import assert from "node:assert/strict";

import graph from "../src/spec.js";
import { compileSpecification } from "@execspec/compiler";

test("the KV specification compiles cleanly with all eleven scenarios", () => {
  const result = compileSpecification(graph);
  if (!result.ok) {
    assert.fail(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }
  assert.match(result.digest, /^[0-9a-f]{64}$/);
  assert.equal(result.document.semantic.operations.length, 6);
  assert.equal(result.document.semantic.scenarios.length, 11);
  assert.deepEqual(
    result.document.semantic.scenarios.map((scenario) => scenario.id),
    [
      "kv.delete.existing",
      "kv.delete.missing",
      "kv.get.missing",
      "kv.int64-wire-proof",
      "kv.isolation-seed",
      "kv.list.empty",
      "kv.list.sorted",
      "kv.put.overwrite",
      "kv.put.then-get",
      "kv.scenario-isolation",
      "kv.types-wire-proof",
    ],
  );
});
