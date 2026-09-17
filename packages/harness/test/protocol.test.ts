import { test } from "node:test";
import assert from "node:assert/strict";

import {
  encodeHello,
  encodeRequest,
  decodeHostMessage,
  PROTOCOL_VERSION,
} from "../src/protocol.js";

test("encodeHello produces canonical deterministic JSON", () => {
  assert.equal(
    encodeHello("ab".repeat(32)),
    '{"kind":"hello","protocolVersion":1,"specificationDigest":"' + "ab".repeat(32) + '"}',
  );
  assert.equal(PROTOCOL_VERSION, 1);
});

test("encodeRequest embeds the semantic input", () => {
  assert.equal(
    encodeRequest("1", "kv.get", { key: "a" }),
    '{"id":"1","input":{"key":"a"},"kind":"request","operation":"kv.get"}',
  );
});

test("decodeHostMessage accepts well-formed messages", () => {
  const ack = decodeHostMessage({
    kind: "helloAck",
    protocolVersion: 1,
    specificationDigest: "d",
    target: "swift",
  });
  assert.equal(ack.ok, true);

  const response = decodeHostMessage({ kind: "response", id: "1", output: {} });
  assert.equal(response.ok, true);

  const failure = decodeHostMessage({ kind: "failure", id: "1", category: "implementationException", message: "boom" });
  assert.equal(failure.ok, true);
});

test("decodeHostMessage rejects malformed messages", () => {
  assert.equal(decodeHostMessage(null).ok, false);
  assert.equal(decodeHostMessage("helloAck").ok, false);
  assert.equal(decodeHostMessage({ kind: "hello" }).ok, false);
  assert.equal(decodeHostMessage({ kind: "greeting" }).ok, false);
  assert.equal(
    decodeHostMessage({
      kind: "helloAck",
      protocolVersion: 1,
      specificationDigest: "d",
      target: "swift",
      extra: 1,
    }).ok,
    false,
  );
  assert.equal(
    decodeHostMessage({ kind: "helloAck", protocolVersion: "1", specificationDigest: "d", target: "swift" }).ok,
    false,
  );
  assert.equal(decodeHostMessage({ kind: "response", id: 1, output: {} }).ok, false);
  assert.equal(
    decodeHostMessage({ kind: "failure", id: "1", category: "implementationException", message: 5 }).ok,
    false,
  );
});
