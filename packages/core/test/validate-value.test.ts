import { test } from "node:test";
import assert from "node:assert/strict";

import {
  structDeclaration,
  enumDeclaration,
  unionDeclaration,
  listType,
  refType,
  stringType,
  int64Type,
  booleanType,
  unitType,
} from "../src/types.js";
import type { TypeDeclaration, ValueType } from "../src/types.js";
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
import type { SemanticValue } from "../src/semantic-value.js";
import type { TypeId } from "../src/ids.js";
import { validateValue } from "../src/validate-value.js";
import type { TypeEnvironment } from "../src/validate-value.js";

function environment(...declarations: TypeDeclaration[]): TypeEnvironment {
  return {
    declarations: new Map(declarations.map((decl) => [decl.id as TypeId, decl])),
  };
}

const PutRequest = structDeclaration("PutRequest", [
  { name: "key", type: stringType(), optional: false },
  { name: "value", type: stringType(), optional: false },
  { name: "nickname", type: stringType(), optional: true },
]);

const GetResult = unionDeclaration("GetResult", [
  { name: "found", payload: stringType() },
  { name: "missing", payload: unitType() },
]);

const SortOrder = enumDeclaration("SortOrder", ["ascending", "descending"]);

const kv = environment(PutRequest, GetResult, SortOrder);

function issuesFor(value: SemanticValue, type: ValueType = refType("PutRequest")): string[] {
  return validateValue(value, type, kv).map((issue) => `${issue.path}: ${issue.code}`);
}

test("primitive mismatches are detected with codes", () => {
  assert.deepEqual(issuesFor(stringValue("a"), stringType()), []);
  assert.deepEqual(issuesFor(unitValue(), stringType()), ["$: typeMismatch"]);
  assert.deepEqual(issuesFor(booleanValue(true), stringType()), ["$: typeMismatch"]);
  assert.deepEqual(issuesFor(int64Value(1n), stringType()), ["$: typeMismatch"]);
  assert.deepEqual(issuesFor(stringValue("a"), unitType()), ["$: typeMismatch"]);
});

test("int64 range is enforced at the validation boundary", () => {
  assert.deepEqual(issuesFor(int64Value(9223372036854775807n), int64Type()), []);
  const outOfRange: SemanticValue = { kind: "int64", value: 9223372036854775808n };
  assert.deepEqual(issuesFor(outOfRange, int64Type()), ["$: int64OutOfRange"]);
});

test("struct validation: nominal identity, required, optional, unknown fields", () => {
  const good = structValue("PutRequest", new Map<string, SemanticValue>([
    ["key", stringValue("a")],
    ["value", stringValue("one")],
  ]));
  assert.deepEqual(issuesFor(good), []);

  const withOptional = structValue("PutRequest", new Map<string, SemanticValue>([
    ["key", stringValue("a")],
    ["value", stringValue("one")],
    ["nickname", stringValue("Ada")],
  ]));
  assert.deepEqual(issuesFor(withOptional), []);

  const missingRequired = structValue("PutRequest", new Map<string, SemanticValue>([
    ["key", stringValue("a")],
  ]));
  assert.deepEqual(issuesFor(missingRequired), ["$.value: missingRequiredField"]);

  const wrongNominal = structValue("GetRequest", new Map());
  assert.ok(issuesFor(wrongNominal).includes("$.typeId: nominalTypeMismatch"));

  const unknown = structValue("PutRequest", new Map<string, SemanticValue>([
    ["key", stringValue("a")],
    ["value", stringValue("one")],
    ["extra", stringValue("x")],
  ]));
  assert.deepEqual(issuesFor(unknown), ["$.extra: unknownStructField"]);

  const badField = structValue("PutRequest", new Map<string, SemanticValue>([
    ["key", int64Value(1n)],
    ["value", stringValue("one")],
  ]));
  assert.deepEqual(issuesFor(badField), ["$.key: typeMismatch"]);
});

test("enum validation", () => {
  assert.deepEqual(issuesFor(enumValue("SortOrder", "ascending"), refType("SortOrder")), []);
  assert.deepEqual(
    issuesFor(enumValue("SortOrder", "diagonal"), refType("SortOrder")),
    ["$.case: invalidEnumCase"],
  );
  const wrongNominal = enumValue("PutRequest", "ascending");
  assert.deepEqual(
    issuesFor(wrongNominal, refType("SortOrder")),
    ["$.typeId: nominalTypeMismatch"],
  );
  assert.deepEqual(
    issuesFor(stringValue("a"), refType("SortOrder")),
    ["$: typeMismatch"],
  );
});

test("union validation: case, payload presence, payload type", () => {
  assert.deepEqual(
    issuesFor(unionValue("GetResult", "found", stringValue("one")), refType("GetResult")),
    [],
  );
  assert.deepEqual(issuesFor(unionValue("GetResult", "missing"), refType("GetResult")), []);

  assert.deepEqual(
    issuesFor(unionValue("GetResult", "deleted"), refType("GetResult")),
    ["$.case: invalidUnionCase"],
  );
  assert.deepEqual(
    issuesFor(unionValue("GetResult", "found"), refType("GetResult")),
    ["$.value: missingUnionPayload"],
  );
  assert.deepEqual(
    issuesFor(unionValue("GetResult", "missing", unitValue()), refType("GetResult")),
    ["$.value: unexpectedUnionPayload"],
  );
  assert.deepEqual(
    issuesFor(unionValue("GetResult", "found", int64Value(1n)), refType("GetResult")),
    ["$.value: typeMismatch"],
  );
});

test("list validation is element-wise with indexed paths", () => {
  const type = listType(refType("GetResult"));
  assert.deepEqual(
    issuesFor(listValue([
      unionValue("GetResult", "found", stringValue("a")),
      unionValue("GetResult", "missing"),
    ]), type),
    [],
  );
  assert.deepEqual(
    issuesFor(listValue([
      unionValue("GetResult", "missing"),
      stringValue("bad"),
    ]), type),
    ["$[1]: typeMismatch"],
  );
});

test("unknown type references are reported", () => {
  assert.deepEqual(
    issuesFor(structValue("Nowhere", new Map()), refType("Nowhere")),
    ["$.typeId: unknownTypeReference"],
  );
});

test("union nominal identity matters", () => {
  const OtherUnion = unionDeclaration("OtherUnion", [
    { name: "found", payload: stringType() },
  ]);
  const env = environment(GetResult, OtherUnion);
  const result = validateValue(
    unionValue("OtherUnion", "found", stringValue("x")),
    refType("GetResult"),
    env,
  );
  assert.deepEqual(result.map((issue) => issue.code), ["nominalTypeMismatch"]);
});
