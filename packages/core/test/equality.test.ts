import { test } from "node:test";
import assert from "node:assert/strict";

import {
  unitValue,
  booleanValue,
  int64Value,
  stringValue,
  listValue,
  structValue,
  enumValue,
  unionValue,
} from "../src/semantic-value.js";
import { semanticEqual, semanticDiff } from "../src/equality.js";
import type { SemanticValue } from "../src/semantic-value.js";

function stringPayload(value: SemanticValue | undefined): unknown {
  return value !== undefined && value.kind === "string" ? value.value : undefined;
}

test("primitive equality rules", () => {
  assert.equal(semanticEqual(unitValue(), unitValue()), true);
  assert.equal(semanticEqual(unitValue(), booleanValue(true)), false);
  assert.equal(semanticEqual(booleanValue(true), booleanValue(true)), true);
  assert.equal(semanticEqual(booleanValue(true), booleanValue(false)), false);
  assert.equal(semanticEqual(int64Value(42n), int64Value(42n)), true);
  assert.equal(semanticEqual(int64Value(42n), int64Value(43n)), false);
  assert.equal(semanticEqual(stringValue("é"), stringValue("é")), true);
  assert.equal(semanticEqual(stringValue("é"), stringValue("e\u0301")), false);
});

test("nominal type identity matters", () => {
  const a = structValue("TypeA", new Map<string, SemanticValue>([["x", stringValue("1")]]));
  const b = structValue("TypeB", new Map<string, SemanticValue>([["x", stringValue("1")]]));
  assert.equal(semanticEqual(a, b), false);
});

test("struct field order does not matter; missing fields do", () => {
  const a = structValue("PutRequest", new Map<string, SemanticValue>([
    ["key", stringValue("a")],
    ["value", stringValue("one")],
  ]));
  const b = structValue("PutRequest", new Map<string, SemanticValue>([
    ["value", stringValue("one")],
    ["key", stringValue("a")],
  ]));
  assert.equal(semanticEqual(a, b), true);

  const c = structValue("PutRequest", new Map<string, SemanticValue>([["key", stringValue("a")]]));
  assert.equal(semanticEqual(a, c), false);
});

test("list order matters element-wise", () => {
  assert.equal(
    semanticEqual(listValue([stringValue("a"), stringValue("b")]), listValue([stringValue("a"), stringValue("b")])),
    true,
  );
  assert.equal(
    semanticEqual(listValue([stringValue("a"), stringValue("b")]), listValue([stringValue("b"), stringValue("a")])),
    false,
  );
  assert.equal(
    semanticEqual(listValue([stringValue("a")]), listValue([stringValue("a"), stringValue("b")])),
    false,
  );
});

test("union case and payload both matter", () => {
  const found = unionValue("GetResult", "found", stringValue("one"));
  assert.equal(semanticEqual(found, unionValue("GetResult", "found", stringValue("one"))), true);
  assert.equal(semanticEqual(found, unionValue("GetResult", "found", stringValue("two"))), false);
  assert.equal(semanticEqual(found, unionValue("GetResult", "missing")), false);
});

test("diffs report nested structural paths", () => {
  const expected = structValue("Profile", new Map<string, SemanticValue>([
    ["user", structValue("User", new Map<string, SemanticValue>([["name", stringValue("Ada")]]))],
    ["items", listValue([stringValue("a"), stringValue("b")])],
  ]));
  const actual = structValue("Profile", new Map<string, SemanticValue>([
    ["user", structValue("User", new Map<string, SemanticValue>([["name", stringValue("Bob")]]))],
    ["items", listValue([stringValue("a"), stringValue("c")])],
  ]));
  const diffs = semanticDiff(expected, actual);
  assert.deepEqual(
    diffs.map((difference) => difference.path),
    ["$.user.name", "$.items[1]"],
  );
  assert.equal(stringPayload(diffs[0]?.expected), "Ada");
  assert.equal(stringPayload(diffs[0]?.actual), "Bob");
});

test("union payload differences report the pseudo-field path", () => {
  const expected = unionValue("GetResult", "found", stringValue("one"));
  const actual = unionValue("GetResult", "found", stringValue("two"));
  const diffs = semanticDiff(expected, actual);
  assert.deepEqual(
    diffs.map((difference) => difference.path),
    ["$.value"],
  );
});

test("unit equals unit only", () => {
  assert.equal(semanticEqual(unitValue(), unitValue()), true);
  assert.equal(semanticEqual(unitValue(), stringValue("")), false);
  assert.equal(semanticEqual(enumValue("E", "a"), enumValue("E", "a")), true);
  assert.equal(semanticEqual(enumValue("E", "a"), enumValue("E", "b")), false);
});
