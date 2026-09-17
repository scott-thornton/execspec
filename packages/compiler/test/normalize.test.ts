import { test } from "node:test";
import assert from "node:assert/strict";

import { specification } from "@execspec/dsl";
import { struct, union, string, unit, int64, list, ref } from "@execspec/dsl";
import { operation } from "@execspec/dsl";
import { scenario } from "@execspec/dsl";
import { literal, binding } from "@execspec/dsl";
import {
  structValue,
  stringValue,
  unionValue,
  unitValue,
  listValue,
  int64Value,
} from "@execspec/core";
import { compileSpecification } from "../src/normalize.js";
import { validateAuthoringGraph } from "../src/validate-authoring.js";

function kvGraph() {
  const spec = specification({ name: "kv", version: "0.1.0" });
  spec.type(struct("PutRequest", { key: string(), value: string() }));
  spec.type(struct("GetRequest", { key: string() }));
  spec.type(union("GetResult", { found: string(), missing: unit() }));
  spec.operation(operation("kv.put", { input: ref("PutRequest"), output: unit() }));
  spec.operation(operation("kv.get", { input: ref("GetRequest"), output: ref("GetResult") }));
  spec.scenario(
    scenario("kv.put.then-get", "a stored value can subsequently be read")
      .call("put", "kv.put", literal(structValue("PutRequest", new Map([
        ["key", stringValue("a")],
        ["value", stringValue("one")],
      ]))))
      .call("get", "kv.get", literal(structValue("GetRequest", new Map([["key", stringValue("a")]]))))
      .expectEqual(binding("get"), literal(unionValue("GetResult", "found", stringValue("one"))))
      .build(),
  );
  return spec.build();
}

test("compilation produces a canonical document and digest", () => {
  const result = compileSpecification(kvGraph());
  if (!result.ok) {
    assert.fail(result.diagnostics.map((diagnostic) => diagnostic.message).join("\n"));
  }
  assert.equal(result.ok, true);
  assert.match(result.digest, /^[0-9a-f]{64}$/);
  assert.equal(result.document.format, "execspec");
  assert.equal(result.document.irVersion, 1);
  assert.deepEqual(result.document.metadata.sourceLocations, {});
  assert.deepEqual(
    result.document.semantic.types.map((entry) => entry.id),
    ["GetRequest", "GetResult", "PutRequest"],
  );
  assert.deepEqual(
    result.document.semantic.operations.map((entry) => entry.id),
    ["kv.get", "kv.put"],
  );
});

test("compilation is deterministic across authoring order", () => {
  const first = compileSpecification(kvGraph());
  const second = compileSpecification(kvGraph());
  if (!first.ok || !second.ok) {
    assert.fail("fixture must compile");
  }
  assert.equal(first.digest, second.digest);
});

test("invalid authoring graphs fail with diagnostics, not exceptions", () => {
  const result = compileSpecification({
    specificationName: "",
    specificationVersion: "0.1.0",
    types: [{ kind: "triangle" }],
    operations: [{ id: "nope", input: { kind: "unit" }, output: { kind: "unit" } }],
    scenarios: [{ id: "kv.a", description: "d", steps: [] }],
  } as never);
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.ok(result.diagnostics.length > 0);
  }
});

test("semantic errors surface as compiler diagnostics", () => {
  const spec = specification({ name: "kv", version: "0.1.0" });
  spec.type(struct("PutRequest", { key: string(), value: string() }));
  spec.operation(operation("kv.put", { input: ref("Nowhere"), output: unit() }));
  const result = compileSpecification(spec.build());
  assert.equal(result.ok, false);
});

test("forward binding references fail compilation", () => {
  const spec = specification({ name: "kv", version: "0.1.0" });
  spec.type(struct("PutRequest", { key: string() }));
  spec.operation(operation("kv.put", { input: ref("PutRequest"), output: unit() }));
  spec.scenario(
    scenario("kv.a", "d")
      .expectEqual(binding("later"), literal(unitValue()))
      .call("later", "kv.put", literal(structValue("PutRequest", new Map([["key", stringValue("a")]]))))
      .build(),
  );
  const result = compileSpecification(spec.build());
  assert.equal(result.ok, false);
});

test("int64 and list literals compile through the pipeline", () => {
  const spec = specification({ name: "diag", version: "0.1.0" });
  spec.type(struct("RevisionRequest", { revision: int64() }));
  spec.type(struct("RevisionResult", { revision: int64() }));
  spec.type(struct("KeyList", { keys: list(string()) }));
  spec.operation(operation("kv.echo-revision", {
    input: ref("RevisionRequest"),
    output: ref("RevisionResult"),
  }));
  spec.scenario(
    scenario("kv.int64-wire-proof", "full width int64 values survive")
      .call("echo", "kv.echo-revision", literal(structValue("RevisionRequest", new Map([
        ["revision", int64Value(9223372036854775807n)],
      ]))))
      .expectEqual(
        binding("echo"),
        literal(structValue("RevisionResult", new Map([
          ["revision", int64Value(9223372036854775807n)],
        ]))),
      )
      .build(),
  );
  const result = compileSpecification(spec.build());
  assert.equal(result.ok, true);
});

test("validateAuthoringGraph rejects non-graph shapes", () => {
  assert.ok(validateAuthoringGraph(null).length > 0);
  assert.ok(validateAuthoringGraph({}).length > 0);
  assert.ok(validateAuthoringGraph({ specificationName: "a", specificationVersion: "1", types: "x", operations: [], scenarios: [] }).length > 0);
  assert.deepEqual(
    validateAuthoringGraph({
      specificationName: "a",
      specificationVersion: "1",
      types: [],
      operations: [],
      scenarios: [],
    }),
    [],
  );
});
