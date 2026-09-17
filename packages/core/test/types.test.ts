import { test } from "node:test";
import assert from "node:assert/strict";

import {
  unitType,
  booleanType,
  int64Type,
  stringType,
  listType,
  refType,
  structDeclaration,
  enumDeclaration,
  unionDeclaration,
  isValueType,
  isTypeDeclaration,
} from "../src/types.js";

test("primitive type factories produce canonical shapes", () => {
  assert.deepEqual(unitType(), { kind: "unit" });
  assert.deepEqual(booleanType(), { kind: "boolean" });
  assert.deepEqual(int64Type(), { kind: "int64" });
  assert.deepEqual(stringType(), { kind: "string" });
});

test("composite type factories produce canonical shapes", () => {
  assert.deepEqual(refType("PutRequest"), { kind: "ref", typeId: "PutRequest" });
  assert.deepEqual(listType(stringType()), {
    kind: "list",
    element: { kind: "string" },
  });
});

test("declaration factories validate names and reject duplicates", () => {
  assert.deepEqual(
    structDeclaration("PutRequest", [
      { name: "key", type: stringType(), optional: false },
      { name: "value", type: stringType(), optional: false },
    ]),
    {
      kind: "struct",
      id: "PutRequest",
      fields: [
        { name: "key", type: { kind: "string" }, optional: false },
        { name: "value", type: { kind: "string" }, optional: false },
      ],
    },
  );

  assert.deepEqual(enumDeclaration("SortOrder", ["ascending", "descending"]), {
    kind: "enum",
    id: "SortOrder",
    cases: ["ascending", "descending"],
  });

  assert.deepEqual(
    unionDeclaration("GetResult", [
      { name: "found", payload: stringType() },
      { name: "missing", payload: unitType() },
    ]),
    {
      kind: "union",
      id: "GetResult",
      cases: [
        { name: "found", payload: { kind: "string" } },
        { name: "missing", payload: { kind: "unit" } },
      ],
    },
  );

  assert.throws(() => structDeclaration("putRequest", []));
  assert.throws(() => structDeclaration("Put", [{ name: "Key", type: stringType(), optional: false }]));
  assert.throws(() =>
    structDeclaration("Put", [
      { name: "key", type: stringType(), optional: false },
      { name: "key", type: stringType(), optional: false },
    ]),
  );
  assert.throws(() => enumDeclaration("Sort", ["ascending", "ascending"]));
  assert.throws(() => unionDeclaration("Get", [{ name: "found", payload: stringType() }, { name: "found", payload: unitType() }]));
  assert.throws(() => unionDeclaration("Get", [{ name: "Ca$e", payload: stringType() }]));
});

test("structural guards accept valid and reject invalid values", () => {
  assert.equal(isValueType({ kind: "unit" }), true);
  assert.equal(isValueType({ kind: "ref", typeId: "A" }), true);
  assert.equal(isValueType({ kind: "list", element: { kind: "string" } }), true);
  assert.equal(isValueType({ kind: "float" }), false);
  assert.equal(isValueType({ kind: "ref", typeId: "put" }), false);
  assert.equal(isValueType({ kind: "list", element: { kind: "nope" } }), false);
  assert.equal(isValueType(null), false);
  assert.equal(isValueType("string"), false);

  assert.equal(isTypeDeclaration(enumDeclaration("SortOrder", ["a"])), true);
  assert.equal(isTypeDeclaration({ kind: "struct", id: "bad", fields: [] }), false);
  assert.equal(isTypeDeclaration({ kind: "triangle" }), false);
});
