import { test } from "node:test";
import assert from "node:assert/strict";

import {
  unit,
  boolean,
  int64,
  string,
  list,
  ref,
  optional,
  struct,
  enumeration,
  union,
} from "../src/type-builders.js";

test("primitive and composite builders", () => {
  assert.deepEqual(unit(), { kind: "unit" });
  assert.deepEqual(boolean(), { kind: "boolean" });
  assert.deepEqual(int64(), { kind: "int64" });
  assert.deepEqual(string(), { kind: "string" });
  assert.deepEqual(list(string()), { kind: "list", element: { kind: "string" } });
  assert.deepEqual(ref("PutRequest"), { kind: "ref", typeId: "PutRequest" });
  assert.throws(() => ref("putRequest"));
});

test("struct builds required and optional fields", () => {
  const declaration = struct("Profile", {
    name: string(),
    nickname: optional(string()),
  });
  assert.deepEqual(declaration, {
    kind: "struct",
    id: "Profile",
    fields: [
      { name: "name", type: { kind: "string" }, optional: false },
      { name: "nickname", type: { kind: "string" }, optional: true },
    ],
  });
});

test("optional markers are field-only objects", () => {
  // Simulate an untyped JS caller nesting optionals; TS blocks this at
  // compile time, the builder blocks it at runtime.
  const nested = optional(string()) as unknown as Parameters<typeof optional>[0];
  assert.throws(() => optional(nested), /cannot wrap/);
  const marked = optional(string());
  assert.deepEqual(marked.__execspecOptionalField, { kind: "string" });
});

test("enumeration and union builders", () => {
  assert.deepEqual(enumeration("SortOrder", ["ascending", "descending"]), {
    kind: "enum",
    id: "SortOrder",
    cases: ["ascending", "descending"],
  });

  const result = union("GetResult", { found: string(), missing: unit() });
  assert.deepEqual(result, {
    kind: "union",
    id: "GetResult",
    cases: [
      { name: "found", payload: { kind: "string" } },
      { name: "missing", payload: { kind: "unit" } },
    ],
  });

  assert.throws(() => struct("bad", { key: string() }));
  assert.throws(() => enumeration("bad", ["a", "a"]));
  assert.throws(() => union("Bad", { "Bad Case": string() }));
});
