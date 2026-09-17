import { test } from "node:test";
import assert from "node:assert/strict";

import {
  parseTypeId,
  parseOperationId,
  parseScenarioId,
  parseMemberName,
} from "../src/ids.js";

test("parseTypeId accepts PascalCase identifiers", () => {
  assert.equal(parseTypeId("PutRequest"), "PutRequest");
  assert.equal(parseTypeId("A"), "A");
  assert.equal(parseTypeId("GetResult2"), "GetResult2");
  assert.equal(parseTypeId("HTTPServer"), "HTTPServer");
});

test("parseTypeId rejects invalid identifiers with value and grammar", () => {
  for (const bad of ["", "putRequest", "Put_Request", "Put-Request", "1Put", "_Put", "put", "Put$", "Паскаль", "Put Request"]) {
    assert.throws(
      () => parseTypeId(bad),
      (error: Error) => {
        assert.ok(error.message.includes(JSON.stringify(bad)), `message names offending value: ${error.message}`);
        assert.ok(error.message.includes("^[A-Z][A-Za-z0-9]*$"), `message names grammar: ${error.message}`);
        return true;
      },
      `expected ${JSON.stringify(bad)} to be rejected`,
    );
  }
});

test("operation and scenario ids accept lowercase dot-separated kebab segments", () => {
  assert.equal(parseOperationId("kv.put"), "kv.put");
  assert.equal(parseOperationId("kv.get-by-id.revision2"), "kv.get-by-id.revision2");
  assert.equal(parseScenarioId("kv.get.missing"), "kv.get.missing");
  assert.equal(parseScenarioId("kv.echo-revision.extreme2"), "kv.echo-revision.extreme2");
});

test("operation and scenario ids reject invalid identifiers", () => {
  const bad = ["", "kv", "kv.", ".kv", "kv..put", "Kv.put", "kv.Put", "kv.put_", "kv.p$t", "kv.-put", "kv .put", "kv.put a"];
  for (const value of bad) {
    assert.throws(
      () => parseOperationId(value),
      (error: Error) => {
        assert.ok(error.message.includes(JSON.stringify(value)));
        assert.ok(error.message.includes("^[a-z][a-z0-9]*(\\.[a-z][a-z0-9-]*)+$"));
        return true;
      },
      `expected ${JSON.stringify(value)} to be rejected`,
    );
    assert.throws(() => parseScenarioId(value));
  }
});

test("member names accept lower camel case", () => {
  assert.equal(parseMemberName("key"), "key");
  assert.equal(parseMemberName("nickname"), "nickname");
  assert.equal(parseMemberName("revision2"), "revision2");
  assert.equal(parseMemberName("caseName"), "caseName");
});

test("member names reject invalid identifiers", () => {
  const bad = ["", "Key", "_key", "1key", "key-name", "key.name", "key$", "$case", "ключ"];
  for (const value of bad) {
    assert.throws(
      () => parseMemberName(value),
      (error: Error) => {
        assert.ok(error.message.includes(JSON.stringify(value)));
        assert.ok(error.message.includes("^[a-z][A-Za-z0-9]*$"));
        return true;
      },
      `expected ${JSON.stringify(value)} to be rejected`,
    );
  }
});

test("all parsers reject $-prefixed names", () => {
  assert.throws(() => parseTypeId("$Reserved"));
  assert.throws(() => parseOperationId("$kv.put"));
  assert.throws(() => parseScenarioId("$kv.put"));
  assert.throws(() => parseMemberName("$case"));
});
