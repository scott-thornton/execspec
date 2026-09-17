import { test } from "node:test";
import assert from "node:assert/strict";

import { operation } from "../src/operation-builder.js";
import { unit, string, optional } from "../src/type-builders.js";

test("operation builder validates ids and shapes", () => {
  const op = operation("kv.put", { input: string(), output: unit() });
  assert.equal(op.id, "kv.put");
  assert.deepEqual(op.input, { kind: "string" });
  assert.deepEqual(op.output, { kind: "unit" });
  assert.throws(() => operation("kvput", { input: unit(), output: unit() }));
});

test("operations declare no throws and no asynchrony", () => {
  const op = operation("kv.echo-revision", { input: unit(), output: unit() });
  assert.deepEqual(Object.keys(op).sort(), ["id", "input", "output"]);
});

test("optional markers are rejected in operation positions", () => {
  const marker = optional(string()) as unknown as Parameters<typeof operation>[1]["input"];
  assert.throws(() => operation("kv.put", { input: marker, output: unit() }), /optional/);
  assert.throws(() => operation("kv.put", { input: unit(), output: marker }), /optional/);
});
