import { test } from "node:test";
import assert from "node:assert/strict";

import { specification } from "../src/specification.js";
import { struct, string, union, unit } from "../src/type-builders.js";
import { operation } from "../src/operation-builder.js";
import { scenario } from "../src/scenario-builder.js";
import { literal, binding } from "../src/expressions.js";
import {
  structValue,
  stringValue,
  unionValue,
  unitValue,
} from "@execspec/core";

test("specification builder accumulates and builds an authoring graph", () => {
  const spec = specification({ name: "kv", version: "0.1.0" });
  spec.type(struct("PutRequest", { key: string(), value: string() }));
  spec.type(union("GetResult", { found: string(), missing: unit() }));
  spec.operation(operation("kv.put", { input: { kind: "ref", typeId: "PutRequest" }, output: unit() }));
  spec.operation(operation("kv.get", { input: { kind: "ref", typeId: "GetRequest" }, output: { kind: "ref", typeId: "GetResult" } }));
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

  const graph = spec.build();
  assert.equal(graph.specificationName, "kv");
  assert.equal(graph.specificationVersion, "0.1.0");
  assert.equal(graph.types.length, 2);
  assert.equal(graph.operations.length, 2);
  assert.equal(graph.scenarios.length, 1);
  assert.equal(graph.operations[0]?.id, "kv.put");
});

test("duplicate registration fails immediately with descriptive errors", () => {
  const spec = specification({ name: "kv", version: "0.1.0" });
  spec.type(struct("PutRequest", { key: string() }));
  assert.throws(() => spec.type(struct("PutRequest", { key: string() })), /duplicate type/i);

  spec.operation(operation("kv.put", { input: unit(), output: unit() }));
  assert.throws(() => spec.operation(operation("kv.put", { input: unit(), output: unit() })), /duplicate operation/i);

  const built = scenario("kv.a", "d")
    .call("put", "kv.put", literal(unitValue()))
    .build();
  spec.scenario(built);
  assert.throws(() => spec.scenario(built), /duplicate scenario/i);
});

test("builders become immutable after build()", () => {
  const spec = specification({ name: "kv", version: "0.1.0" });
  spec.type(struct("PutRequest", { key: string() }));
  spec.operation(operation("kv.put", { input: { kind: "ref", typeId: "PutRequest" }, output: unit() }));
  spec.scenario(
    scenario("kv.a", "d").call("put", "kv.put", literal(unitValue())).build(),
  );
  const first = spec.build();
  assert.throws(() => spec.build(), /immutable/i);
  assert.throws(() => spec.type(struct("Other", { key: string() })), /immutable/i);
  assert.throws(() => spec.operation(operation("kv.x.y", { input: unit(), output: unit() })), /immutable/i);
  assert.throws(
    () => spec.scenario(scenario("kv.b", "d").call("put", "kv.put", literal(unitValue())).build()),
    /immutable/i,
  );
  assert.equal(first.types.length, 1);
});
