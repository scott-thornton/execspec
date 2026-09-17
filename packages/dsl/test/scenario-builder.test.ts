import { test } from "node:test";
import assert from "node:assert/strict";

import { scenario } from "../src/scenario-builder.js";
import { literal, binding, field } from "../src/expressions.js";
import { unitValue, stringValue } from "@execspec/core";

test("scenario builder emits static steps in order", () => {
  const built = scenario("kv.put.then-get", "a stored value can be read")
    .call("put", "kv.put", literal(unitValue()))
    .expectEqual(binding("put"), literal(unitValue()))
    .build();

  assert.equal(built.id, "kv.put.then-get");
  assert.equal(built.description, "a stored value can be read");
  assert.equal(built.steps.length, 2);
  assert.deepEqual(built.steps[0], {
    kind: "call",
    binding: "put",
    operationId: "kv.put",
    input: { kind: "literal", value: { kind: "unit" } },
  });
  assert.deepEqual(built.steps[1]?.kind, "expectEqual");
});

test("scenario builder validates ids, bindings, and expressions", () => {
  assert.throws(() => scenario("kv", "d"));
  assert.throws(() => scenario("kv.put", ""));
  assert.throws(() => scenario("kv.a", "d").call("Put", "kv.put", literal(unitValue())));
  assert.throws(() => scenario("kv.a", "d").call("put", "kvput", literal(unitValue())));
  assert.throws(() => binding("$bad"));
  assert.throws(() => binding("Bad"));
  assert.throws(() => field(binding("x"), "$case"));
});

test("field expressions reject literal bases", () => {
  assert.throws(() => field(literal(stringValue("a")), "length"));
  const chained = field(field(binding("get"), "value"), "length");
  assert.deepEqual(chained, {
    kind: "field",
    field: "length",
    base: { kind: "field", field: "value", base: { kind: "binding", binding: "get" } },
  });
});
