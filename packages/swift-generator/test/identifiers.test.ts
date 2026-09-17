import { test } from "node:test";
import assert from "node:assert/strict";

import {
  swiftTypeName,
  swiftPropertyName,
  swiftEnumCaseName,
  swiftMethodName,
  swiftSpecificationPrefix,
  assertNoEscapedCollisions,
} from "../src/identifiers.js";

test("member names keep lower camel case except keywords", () => {
  assert.equal(swiftPropertyName("description"), "description");
  assert.equal(swiftPropertyName("class"), "class_");
  assert.equal(swiftPropertyName("defaultValue"), "defaultValue");
  assert.equal(swiftPropertyName("self"), "self_");
  assert.equal(swiftPropertyName("for"), "for_");
  assert.equal(swiftPropertyName("value"), "value");
});

test("the full Swift 6 keyword list is escaped", () => {
  const keywords = [
    "associatedtype", "class", "deinit", "enum", "extension", "fileprivate",
    "func", "import", "init", "inout", "internal", "let", "open", "operator",
    "private", "protocol", "public", "rethrows", "static", "struct",
    "subscript", "typealias", "var", "break", "case", "catch", "continue",
    "default", "defer", "do", "else", "fallthrough", "for", "guard", "if",
    "in", "repeat", "return", "throw", "switch", "where", "while", "as",
    "any", "false", "is", "nil", "self", "super", "throws", "true", "try",
    "await", "async", "actor", "some", "get", "set", "willSet", "didSet",
    "weak", "unowned", "none", "left", "right",
  ];
  for (const keyword of keywords) {
    assert.equal(swiftPropertyName(keyword), `${keyword}_`, keyword);
    assert.equal(swiftEnumCaseName(keyword), `${keyword}_`, keyword);
  }
  assert.equal(swiftTypeName("Self"), "Self_");
  assert.equal(swiftTypeName("PutRequest"), "PutRequest");
});

test("operation ids map to lower camel case method names", () => {
  assert.equal(swiftMethodName("kv.put"), "kvPut");
  assert.equal(swiftMethodName("user.get-by-id"), "userGetById");
  assert.equal(swiftMethodName("kv.echo-revision"), "kvEchoRevision");
  assert.equal(swiftMethodName("a.b.c-d"), "aBCD");
});

test("specification names map to protocol prefixes", () => {
  assert.equal(swiftSpecificationPrefix("kv"), "KV");
  assert.equal(swiftSpecificationPrefix("userManagement"), "UserManagement");
  assert.equal(swiftSpecificationPrefix("todo-list"), "TODOList");
});

test("escaped collisions are generator errors", () => {
  assert.throws(
    () => assertNoEscapedCollisions(["class", "class_"], "struct X", swiftPropertyName),
    /collision/i,
  );
  assert.doesNotThrow(() => assertNoEscapedCollisions(["class", "case"], "struct X", swiftPropertyName));
});
