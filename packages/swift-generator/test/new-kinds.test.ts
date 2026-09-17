import { test } from "node:test";
import assert from "node:assert/strict";

import {
  structDeclaration,
  float64Type,
  bytesType,
  mapType,
  stringType,
  int64Type,
  listType,
  refType,
  unitType,
  structValue,
  float64Value,
  bytesValue,
  mapValue,
  stringValue,
  int64Value,
  listValue,
} from "@execspec/core";
import type { OperationId, SemanticIR, SemanticIRDocument } from "@execspec/core";
import { generateSwift } from "../src/emit.js";

function document(): SemanticIRDocument {
  const semantic: SemanticIR = {
    specificationName: "types",
    specificationVersion: "0.1.0",
    types: [
      structDeclaration("Envelope", [
        { name: "ratio", type: float64Type(), optional: false },
        { name: "blob", type: bytesType(), optional: false },
        { name: "counts", type: mapType(stringType(), int64Type()), optional: false },
        { name: "labels", type: mapType(int64Type(), stringType()), optional: false },
        { name: "matrix", type: listType(mapType(stringType(), bytesType())), optional: false },
      ]),
    ],
    operations: [
      { id: "types.echo" as OperationId, input: refType("Envelope"), output: refType("Envelope") },
      { id: "types.stats" as OperationId, input: unitType(), output: mapType(stringType(), float64Type()) },
    ],
    scenarios: [
      {
        id: "types.echo.roundtrip" as never,
        description: "round trip",
        steps: [
          {
            kind: "call",
            binding: "echo",
            operationId: "types.echo" as OperationId,
            input: {
              kind: "literal",
              value: structValue("Envelope", new Map<string, import("@execspec/core").SemanticValue>([
                ["ratio", float64Value(Number.NaN)],
                ["blob", bytesValue(new Uint8Array([1]))],
                ["counts", mapValue(new Map<string | bigint, import("@execspec/core").SemanticValue>([["a", int64Value(1n)]]))],
                ["labels", mapValue(new Map<string | bigint, import("@execspec/core").SemanticValue>([[1n, stringValue("a")]]))],
                ["matrix", listValue([mapValue(new Map<string | bigint, import("@execspec/core").SemanticValue>([["k", bytesValue(new Uint8Array([2]))]]))])],
              ])),
            },
          },
        ],
      },
    ],
  };
  return { format: "execspec", irVersion: 1, semantic, metadata: { sourceLocations: {} } };
}

test("new kinds map to Swift types with conditional Foundation import", () => {
  const files = generateSwift(document(), "d".repeat(64));
  const types = files[0];
  if (types === undefined) {
    throw new Error("missing types");
  }
  assert.ok(types.contents.includes("import Foundation"));
  assert.ok(types.contents.includes("public let ratio: Double"));
  assert.ok(types.contents.includes("public let blob: Data"));
  assert.ok(types.contents.includes("public let counts: [String: Int64]"));
  assert.ok(types.contents.includes("public let labels: [Int64: String]"));
  assert.ok(types.contents.includes("public let matrix: [[String: Data]]"));
});

test("new kinds emit canonical codecs", () => {
  const files = generateSwift(document(), "d".repeat(64));
  const codecs = files[2];
  if (codecs === undefined) {
    throw new Error("missing codecs");
  }
  assert.ok(codecs.contents.includes("func decodeValue_float64(_ value: JSONValue) throws -> Double"));
  assert.ok(codecs.contents.includes('ExecSpecFloat64.spelling(parsed) == spelling'));
  assert.ok(codecs.contents.includes("func decodeValue_bytes(_ value: JSONValue) throws -> Data"));
  assert.ok(codecs.contents.includes("func decodeValue_map_of_string_to_int64(_ value: JSONValue) throws -> [String: Int64]"));
  assert.ok(codecs.contents.includes("func decodeValue_map_of_int64_to_string(_ value: JSONValue) throws -> [Int64: String]"));
  assert.ok(codecs.contents.includes("func decodeValue_map_of_string_to_float64(_ value: JSONValue) throws -> [String: Double]"));
  assert.ok(codecs.contents.includes("func decodeValue_list_of_map_of_string_to_bytes(_ value: JSONValue) throws -> [[String: Data]]"));
  assert.ok(codecs.contents.includes("ExecSpecWire.isCanonicalInt64Spelling(entry.key)"));
});

test("generation stays deterministic with the new kinds", () => {
  const first = generateSwift(document(), "d".repeat(64));
  const second = generateSwift(document(), "d".repeat(64));
  assert.deepEqual(first, second);
});
