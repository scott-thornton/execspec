import { test } from "node:test";
import assert from "node:assert/strict";

import {
  structValue,
  stringValue,
  unionValue,
  unitValue,
  int64Value,
  listValue,
} from "@execspec/core";
import { evaluateExpression } from "../src/evaluator.js";

test("literals and bindings evaluate to their values", () => {
  assert.deepEqual(evaluateExpression({ kind: "literal", value: unitValue() }, { values: new Map() }), unitValue());
  const bound = int64Value(42n);
  assert.deepEqual(
    evaluateExpression({ kind: "binding", binding: "x" }, { values: new Map([["x", bound]]) }),
    bound,
  );
  assert.throws(() => evaluateExpression({ kind: "binding", binding: "nope" }, { values: new Map() }), /unknown binding/);
});

test("field traversal covers struct fields and union payloads", () => {
  const struct = structValue("PutRequest", new Map([
    ["key", stringValue("a")],
    ["value", stringValue("one")],
  ]));
  assert.deepEqual(
    evaluateExpression(
      { kind: "field", base: { kind: "literal", value: struct }, field: "key" },
      { values: new Map() },
    ),
    stringValue("a"),
  );

  const found = unionValue("GetResult", "found", stringValue("one"));
  assert.deepEqual(
    evaluateExpression(
      { kind: "field", base: { kind: "literal", value: found }, field: "value" },
      { values: new Map() },
    ),
    stringValue("one"),
  );

  const missing = unionValue("GetResult", "missing");
  assert.throws(() =>
    evaluateExpression(
      { kind: "field", base: { kind: "literal", value: missing }, field: "value" },
      { values: new Map() },
    ),
  );

  assert.throws(() =>
    evaluateExpression(
      { kind: "field", base: { kind: "literal", value: struct }, field: "nope" },
      { values: new Map() },
    ),
  );

  assert.throws(() =>
    evaluateExpression(
      { kind: "field", base: { kind: "literal", value: stringValue("s") }, field: "length" },
      { values: new Map() },
    ),
  );
});

test("chained field traversal and list values work", () => {
  const nested = structValue("Outer", new Map([
    ["inner", structValue("Inner", new Map([["items", listValue([stringValue("a")])]]))],
  ]));
  assert.deepEqual(
    evaluateExpression(
      {
        kind: "field",
        base: { kind: "field", base: { kind: "literal", value: nested }, field: "inner" },
        field: "items",
      },
      { values: new Map() },
    ),
    listValue([stringValue("a")]),
  );
});
