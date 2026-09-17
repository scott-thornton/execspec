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
  isSemanticValue,
  INT64_MIN,
  INT64_MAX,
} from "../src/semantic-value.js";

test("primitive value factories", () => {
  assert.deepEqual(unitValue(), { kind: "unit" });
  assert.deepEqual(booleanValue(true), { kind: "boolean", value: true });
  assert.deepEqual(int64Value(42n), { kind: "int64", value: 42n });
  assert.deepEqual(stringValue("a"), { kind: "string", value: "a" });
});

test("int64 factory enforces full signed 64-bit range with bigint only", () => {
  assert.deepEqual(int64Value(INT64_MAX), { kind: "int64", value: 9223372036854775807n });
  assert.deepEqual(int64Value(INT64_MIN), { kind: "int64", value: -9223372036854775808n });
  assert.throws(() => int64Value(9223372036854775808n));
  assert.throws(() => int64Value(-9223372036854775809n));
  // @ts-expect-error number is never a legal int64 representation
  assert.throws(() => int64Value(42));
});

test("string factory rejects unpaired surrogates", () => {
  assert.equal(stringValue("é\n\t😀").value, "é\n\t😀");
  assert.throws(() => stringValue("\ud800"));
  assert.throws(() => stringValue("a\udfff"));
});

test("struct values carry nominal identity and ordered field maps", () => {
  const value = structValue("PutRequest", new Map([
    ["key", stringValue("a")],
    ["value", stringValue("one")],
  ]));
  assert.equal(value.kind, "struct");
  assert.equal(value.typeId, "PutRequest");
  assert.deepEqual(value.fields.get("key"), stringValue("a"));

  assert.throws(() => structValue("putRequest", new Map()));
  assert.throws(() => structValue("Put", new Map([["Key", stringValue("a")]])));
});

test("enum and union values", () => {
  assert.deepEqual(enumValue("SortOrder", "ascending"), {
    kind: "enum",
    typeId: "SortOrder",
    case: "ascending",
  });

  const found = unionValue("GetResult", "found", stringValue("one"));
  assert.equal(found.kind, "union");
  assert.equal(found.case, "found");
  assert.deepEqual(found.value, { kind: "string", value: "one" });

  const missing = unionValue("GetResult", "missing");
  assert.equal("value" in missing, false);

  assert.throws(() => enumValue("SortOrder", "Ascending"));
  assert.throws(() => unionValue("Get", "Ca$e"));
});

test("list values", () => {
  const value = listValue([stringValue("a"), stringValue("b")]);
  assert.deepEqual(value, {
    kind: "list",
    values: [{ kind: "string", value: "a" }, { kind: "string", value: "b" }],
  });
});

test("structural guard accepts valid values and rejects malformed ones", () => {
  assert.equal(isSemanticValue(unitValue()), true);
  assert.equal(isSemanticValue(structValue("A", new Map())), true);
  assert.equal(isSemanticValue({ kind: "float", value: 1 }), false);
  assert.equal(isSemanticValue({ kind: "int64", value: 42 }), false);
  assert.equal(isSemanticValue(null), false);
});
