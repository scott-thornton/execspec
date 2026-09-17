import { test } from "node:test";
import assert from "node:assert/strict";

import { canonicalJSONStringify } from "../src/canonical-json.js";
import type { JSONValue } from "../src/canonical-json.js";

test("keys are sorted recursively with no whitespace", () => {
  const value: JSONValue = { b: 1, a: { z: true, c: [1, 2] } };
  assert.equal(canonicalJSONStringify(value), '{"a":{"c":[1,2],"z":true},"b":1}');
});

test("arrays are stable and not reordered", () => {
  assert.equal(canonicalJSONStringify([3, 1, 2]), "[3,1,2]");
  assert.equal(canonicalJSONStringify([{ b: 1, a: 2 }, { a: 1, b: 2 }]), '[{"a":2,"b":1},{"a":1,"b":2}]');
});

test("identical output for differently inserted maps of the same data", () => {
  const first: JSONValue = { z: "last", a: "first", m: { y: 1, b: 2 } };
  const second: JSONValue = { m: { b: 2, y: 1 }, a: "first", z: "last" };
  assert.equal(canonicalJSONStringify(first), canonicalJSONStringify(second));
});

test("scalars and escaping", () => {
  assert.equal(canonicalJSONStringify(null), "null");
  assert.equal(canonicalJSONStringify(true), "true");
  assert.equal(canonicalJSONStringify(false), "false");
  assert.equal(canonicalJSONStringify(42), "42");
  assert.equal(canonicalJSONStringify(-7), "-7");
  assert.equal(canonicalJSONStringify("plain"), '"plain"');
  assert.equal(
    canonicalJSONStringify('quote " backslash \\ newline \n tab \t u{0001} \u0001'),
    '"quote \\" backslash \\\\ newline \\n tab \\t u{0001} \\u0001"',
  );
});

test("unicode is preserved raw, not escaped", () => {
  assert.equal(canonicalJSONStringify("é 😀"), '"é 😀"');
});

test("key sorting is by unicode code point, not utf-16 units", () => {
  // U+FF5A (z fullwidth, BMP) sorts before U+10000 (emoji, supplementary)
  // by code point but after by naive UTF-16 unit comparison in some orders.
  const value: JSONValue = { "\u{10000}": 1, "\uff5a": 2 };
  assert.equal(canonicalJSONStringify(value), '{"\uff5a":2,"\u{10000}":1}');
});

test("numbers must be safe integers", () => {
  assert.throws(() => canonicalJSONStringify(1.5));
  assert.throws(() => canonicalJSONStringify(Number.MAX_SAFE_INTEGER + 1));
  assert.throws(() => canonicalJSONStringify(NaN));
  assert.equal(canonicalJSONStringify(0), "0");
});
