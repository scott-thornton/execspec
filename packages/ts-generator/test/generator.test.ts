import { test } from "node:test";
import assert from "node:assert/strict";

import { strictParseJSON, StrictJSONError } from "../src/runtime/strict-json.js";
import { generateTypeScript } from "../src/emit.js";
import {
  structDeclaration,
  unionDeclaration,
  stringType,
  int64Type,
  float64Type,
  bytesType,
  mapType,
  listType,
  refType,
  unitType,
  structValue,
  unionValue,
  float64Value,
  bytesValue,
  mapValue,
  stringValue,
  int64Value,
} from "@execspec/core";
import type { OperationId, SemanticIR, SemanticIRDocument } from "@execspec/core";

test("strict JSON parser rejects duplicates, bad escapes, trailing junk", () => {
  assert.deepEqual(strictParseJSON('{"a": [1, true, null], "b": "x"}'), { a: [1, true, null], b: "x" });
  assert.deepEqual(strictParseJSON('"é 😀"'), "é 😀");
  for (const bad of ['{"a":1,"a":2}', "[1,]", "01", '"\\ud800"', '{"a"1}', "1 2", ""]) {
    assert.throws(() => strictParseJSON(bad), StrictJSONError, bad);
  }
});

function document(): SemanticIRDocument {
  const semantic: SemanticIR = {
    specificationName: "kv",
    specificationVersion: "0.1.0",
    types: [
      structDeclaration("PutRequest", [
        { name: "key", type: stringType(), optional: false },
        { name: "value", type: stringType(), optional: false },
        { name: "nickname", type: stringType(), optional: true },
      ]),
      structDeclaration("GetRequest", [{ name: "key", type: stringType(), optional: false }]),
      unionDeclaration("GetResult", [
        { name: "found", payload: stringType() },
        { name: "missing", payload: unitType() },
      ]),
      structDeclaration("TypesEnvelope", [
        { name: "weight", type: float64Type(), optional: false },
        { name: "blob", type: bytesType(), optional: false },
        { name: "counts", type: mapType(stringType(), int64Type()), optional: false },
      ]),
    ],
    operations: [
      { id: "kv.put" as OperationId, input: refType("PutRequest"), output: unitType() },
      { id: "kv.get" as OperationId, input: refType("GetRequest"), output: refType("GetResult") },
      { id: "kv.echo-types" as OperationId, input: refType("TypesEnvelope"), output: refType("TypesEnvelope") },
      { id: "kv.stats" as OperationId, input: unitType(), output: listType(mapType(stringType(), float64Type())) },
    ],
    scenarios: [
      {
        id: "kv.put.then-get" as never,
        description: "d",
        steps: [
          { kind: "call", binding: "put", operationId: "kv.put" as OperationId, input: { kind: "literal", value: structValue("PutRequest", new Map([["key", stringValue("a")], ["value", stringValue("one")]])) } },
          { kind: "call", binding: "get", operationId: "kv.get" as OperationId, input: { kind: "literal", value: structValue("GetRequest", new Map([["key", stringValue("a")]])) } },
          { kind: "expectEqual", actual: { kind: "binding", binding: "get" }, expected: { kind: "literal", value: unionValue("GetResult", "found", stringValue("one")) } },
        ],
      },
      {
        id: "kv.echo-types.roundtrip" as never,
        description: "d",
        steps: [
          { kind: "call", binding: "echo", operationId: "kv.echo-types" as OperationId, input: { kind: "literal", value: structValue("TypesEnvelope", new Map<string, import("@execspec/core").SemanticValue>([
            ["weight", float64Value(Number.NaN)],
            ["blob", bytesValue(new Uint8Array([3]))],
            ["counts", mapValue(new Map<string | bigint, import("@execspec/core").SemanticValue>([["a", int64Value(1n)]]))],
          ])) } },
        ],
      },
    ],
  };
  return { format: "execspec", irVersion: 1, semantic, metadata: { sourceLocations: {} } };
}

test("generated TS types match the target mapping", () => {
  const files = generateTypeScript(document(), "d".repeat(64));
  const types = files[0];
  if (types === undefined) {
    throw new Error("missing types");
  }
  assert.ok(types.contents.includes("export interface PutRequest {"));
  assert.ok(types.contents.includes("readonly nickname?: string;"));
  assert.ok(types.contents.includes("export type GetResult ="));
  assert.ok(types.contents.includes('| { readonly kind: "found"; readonly value: string }'));
  assert.ok(types.contents.includes("| { readonly kind: \"missing\" }"));
  assert.ok(types.contents.includes("readonly counts: Map<string, bigint>;"));
  assert.ok(types.contents.includes("readonly weight: number;"));
  assert.ok(types.contents.includes("readonly blob: Uint8Array;"));
});

test("generated protocol and dispatcher are complete and deterministic", () => {
  const first = generateTypeScript(document(), "d".repeat(64));
  const second = generateTypeScript(document(), "d".repeat(64));
  assert.deepEqual(first, second);
  const protocol = first[1];
  const dispatcher = first[3];
  if (protocol === undefined || dispatcher === undefined) {
    throw new Error("missing files");
  }
  assert.ok(protocol.contents.includes("export interface KVSpecificationImplementation {"));
  assert.ok(protocol.contents.includes("kvPut(input: PutRequest): ExecSpecUnit | Promise<ExecSpecUnit>;"));
  assert.ok(dispatcher.contents.includes('this.specificationDigest = "' + "d".repeat(64) + '"'));
  assert.ok(dispatcher.contents.includes('case "kv.echo-types": {'));
  assert.ok(dispatcher.contents.includes("decodeTypesEnvelope(input)"));
});
