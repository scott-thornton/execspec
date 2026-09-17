import { test } from "node:test";
import assert from "node:assert/strict";

import {
  structDeclaration,
  unionDeclaration,
  enumDeclaration,
  listType,
  refType,
  stringType,
  int64Type,
  booleanType,
  unitType,
} from "../src/types.js";
import type { TypeDeclaration } from "../src/types.js";
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
import {
  encodeSemanticValue,
  decodeSemanticValue,
  semanticValueToJSON,
} from "../src/semantic-value-json.js";
import type { TypeEnvironment } from "../src/validate-value.js";
import type { JSONValue } from "../src/canonical-json.js";
import type { ValueType } from "../src/types.js";

const declarations: TypeDeclaration[] = [
  structDeclaration("PutRequest", [
    { name: "key", type: stringType(), optional: false },
    { name: "value", type: stringType(), optional: false },
    { name: "nickname", type: stringType(), optional: true },
  ]),
  unionDeclaration("GetResult", [
    { name: "found", payload: stringType() },
    { name: "missing", payload: unitType() },
  ]),
  enumDeclaration("SortOrder", ["ascending", "descending"]),
  structDeclaration("KeyList", [
    { name: "keys", type: listType(stringType()), optional: false },
    { name: "flags", type: listType(booleanType()), optional: false },
  ]),
  structDeclaration("Revision", [
    { name: "revision", type: int64Type(), optional: false },
  ]),
];

const environment: TypeEnvironment = {
  declarations: new Map(declarations.map((decl) => [decl.id as TypeId, decl])),
};

function decodeOk(json: JSONValue, type: ValueType = refType("PutRequest")): SemanticValue | undefined {
  const result = decodeSemanticValue(json, type, environment);
  return result.ok ? result.value : undefined;
}

function decodeIssueCodes(json: JSONValue, type: ValueType = refType("PutRequest")): string[] {
  const result = decodeSemanticValue(json, type, environment);
  return result.ok ? [] : result.issues.map((issue) => `${issue.path}: ${issue.code}`);
}

test("primitive encode", () => {
  assert.deepEqual(semanticValueToJSON(unitValue()), {});
  assert.deepEqual(semanticValueToJSON(booleanValue(true)), true);
  assert.deepEqual(semanticValueToJSON(int64Value(9223372036854775807n)), { $i64: "9223372036854775807" });
  assert.deepEqual(semanticValueToJSON(int64Value(-9223372036854775808n)), { $i64: "-9223372036854775808" });
  assert.deepEqual(semanticValueToJSON(stringValue("é")), "é");
});

test("composite encode", () => {
  assert.deepEqual(
    semanticValueToJSON(listValue([stringValue("a"), stringValue("b")])),
    ["a", "b"],
  );
  assert.deepEqual(
    semanticValueToJSON(enumValue("SortOrder", "ascending")),
    "ascending",
  );
  assert.deepEqual(
    semanticValueToJSON(unionValue("GetResult", "found", stringValue("one"))),
    { $case: "found", value: "one" },
  );
  assert.deepEqual(semanticValueToJSON(unionValue("GetResult", "missing")), { $case: "missing" });
});

test("encodeSemanticValue validates before encoding", () => {
  const good = structValue("PutRequest", new Map<string, SemanticValue>([
    ["key", stringValue("a")],
    ["value", stringValue("one")],
    ["nickname", stringValue("Ada")],
  ]));
  assert.deepEqual(encodeSemanticValue(good, refType("PutRequest"), environment), {
    key: "a",
    value: "one",
    nickname: "Ada",
  });

  const missingField = structValue("PutRequest", new Map<string, SemanticValue>([
    ["key", stringValue("a")],
  ]));
  assert.throws(() => encodeSemanticValue(missingField, refType("PutRequest"), environment));
});

test("decode round-trips every kind", () => {
  const putType = refType("PutRequest");
  assert.deepEqual(
    decodeOk({ key: "a", value: "one" }, putType),
    structValue("PutRequest", new Map<string, SemanticValue>([
      ["key", stringValue("a")],
      ["value", stringValue("one")],
    ])),
  );
  assert.deepEqual(decodeOk({ $case: "missing" }, refType("GetResult")), unionValue("GetResult", "missing"));
  assert.deepEqual(
    decodeOk({ $case: "found", value: "one" }, refType("GetResult")),
    unionValue("GetResult", "found", stringValue("one")),
  );
  assert.deepEqual(decodeOk("descending", refType("SortOrder")), enumValue("SortOrder", "descending"));
  assert.deepEqual(
    decodeOk({ keys: ["a", "z", "é"], flags: [true, false] }, refType("KeyList")),
    structValue("KeyList", new Map<string, SemanticValue>([
      ["keys", listValue([stringValue("a"), stringValue("z"), stringValue("é")])],
      ["flags", listValue([booleanValue(true), booleanValue(false)])],
    ])),
  );
});

test("full-width int64 round-trips through the wire", () => {
  const type = refType("Revision");
  for (const literal of ["9223372036854775807", "-9223372036854775808", "0", "-1"]) {
    const decoded = decodeOk({ revision: { $i64: literal } }, type);
    const encoded = decoded === undefined ? undefined : encodeSemanticValue(decoded, type, environment);
    assert.deepEqual(encoded, { revision: { $i64: literal } });
  }
  assert.deepEqual(decodeIssueCodes({ revision: { $i64: "9223372036854775808" } }, type), ["$.revision: int64OutOfRange"]);
  assert.deepEqual(decodeIssueCodes({ revision: { $i64: "+42" } }, type), ["$.revision: invalidInt64Spelling"]);
  assert.deepEqual(decodeIssueCodes({ revision: { $i64: "-0" } }, type), ["$.revision: invalidInt64Spelling"]);
  assert.deepEqual(decodeIssueCodes({ revision: { $i64: "01" } }, type), ["$.revision: invalidInt64Spelling"]);
  assert.deepEqual(decodeIssueCodes({ revision: 42 }, type), ["$.revision: invalidInt64Wire"]);
});

test("struct decode rejections", () => {
  assert.deepEqual(decodeIssueCodes({ key: "a" }), ["$.value: missingRequiredField"]);
  assert.deepEqual(decodeIssueCodes({ key: "a", value: "one", extra: 1 }), ["$.extra: unknownStructField"]);
  assert.deepEqual(decodeIssueCodes({ key: "a", value: null }), ["$.value: invalidNull"]);
  assert.deepEqual(decodeIssueCodes({ key: "a", value: "one", nickname: null }), ["$.nickname: invalidNull"]);
  assert.deepEqual(decodeIssueCodes(["a"]), ["$: expectedObject"]);
  assert.deepEqual(decodeIssueCodes({ key: 1, value: "one" }), ["$.key: expectedString"]);
});

test("union decode rejections", () => {
  const type = refType("GetResult");
  assert.deepEqual(decodeIssueCodes({ $case: "nope" }, type), ["$.case: invalidUnionCase"]);
  assert.deepEqual(decodeIssueCodes({ $case: "found" }, type), ["$.value: missingUnionPayload"]);
  assert.deepEqual(decodeIssueCodes({ $case: "missing", value: {} }, type), ["$: unexpectedUnionPayloadKey"]);
  assert.deepEqual(decodeIssueCodes({ $case: "found", value: "one", extra: 1 }, type), ["$: unexpectedUnionPayloadKey"]);
  assert.deepEqual(decodeIssueCodes("found", type), ["$: expectedObject"]);
});

test("enum and list decode rejections", () => {
  assert.deepEqual(decodeIssueCodes("diagonal", refType("SortOrder")), ["$: invalidEnumCase"]);
  assert.deepEqual(decodeIssueCodes(7, refType("SortOrder")), ["$: expectedString"]);
  assert.deepEqual(
    decodeIssueCodes({ keys: ["a", 3], flags: [] }, refType("KeyList")),
    ["$.keys[1]: expectedString"],
  );
  assert.deepEqual(decodeIssueCodes({ keys: null, flags: [] }, refType("KeyList")), ["$.keys: invalidNull"]);
  assert.deepEqual(decodeIssueCodes({ keys: 5, flags: [] }, refType("KeyList")), ["$.keys: expectedArray"]);
});

test("unit decode requires the empty object", () => {
  assert.deepEqual(decodeOk({}, unitType()), unitValue());
  assert.deepEqual(decodeIssueCodes(null, unitType()), ["$: expectedObject"]);
  assert.deepEqual(decodeIssueCodes({ extra: 1 }, unitType()), ["$: unexpectedUnitKey"]);
});
