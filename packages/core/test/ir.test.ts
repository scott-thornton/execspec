import { test } from "node:test";
import assert from "node:assert/strict";

import type {
  SemanticIR,
  SemanticIRDocument,
  ScenarioIR,
  OperationIR,
} from "../src/ir.js";
import {
  structDeclaration,
  unionDeclaration,
  stringType,
  unitType,
  refType,
} from "../src/types.js";
import { stringValue, unionValue, unitValue, structValue } from "../src/semantic-value.js";
import type { OperationId, ScenarioId, TypeId } from "../src/ids.js";

const kvOperation: OperationIR = {
  id: "kv.get" as OperationId,
  input: refType("GetRequest"),
  output: refType("GetResult"),
};

const kvScenario: ScenarioIR = {
  id: "kv.get.missing" as ScenarioId,
  description: "a missing key reads as missing",
  steps: [
    {
      kind: "call",
      binding: "get",
      operationId: "kv.get" as OperationId,
      input: {
        kind: "literal",
        value: structValue("GetRequest", new Map([["key", stringValue("a")]])),
      },
    },
    {
      kind: "expectEqual",
      actual: { kind: "binding", binding: "get" },
      expected: { kind: "literal", value: unionValue("GetResult", "missing") },
    },
  ],
};

const ir: SemanticIR = {
  specificationName: "kv",
  specificationVersion: "0.1.0",
  types: [
    structDeclaration("GetRequest", [{ name: "key", type: stringType(), optional: false }]),
    unionDeclaration("GetResult", [
      { name: "found", payload: stringType() },
      { name: "missing", payload: unitType() },
    ]),
  ],
  operations: [kvOperation],
  scenarios: [kvScenario],
};

test("SemanticIRDocument shape", () => {
  const document: SemanticIRDocument = {
    format: "execspec",
    irVersion: 1,
    semantic: ir,
    metadata: { sourceLocations: {} },
  };
  assert.equal(document.format, "execspec");
  assert.equal(document.irVersion, 1);
  assert.deepEqual(document.metadata.sourceLocations, {});
  assert.equal(document.semantic.scenarios.length, 1);
  assert.equal(document.semantic.types.length, 2);
});

test("steps preserve declared order and kinds", () => {
  const steps = ir.scenarios[0]?.steps ?? [];
  assert.equal(steps.length, 2);
  const call = steps[0];
  if (call?.kind !== "call") {
    assert.fail("first step must be a call");
  }
  assert.equal(call.binding, "get");
  const expect = steps[1];
  if (expect?.kind !== "expectEqual") {
    assert.fail("second step must be expectEqual");
  }
  assert.equal(expect.actual.kind, "binding");
});

test("type declarations are nominal and referenced by id", () => {
  const ids = ir.types.map((declaration) => declaration.id as TypeId);
  assert.deepEqual([...ids].sort(), ["GetRequest", "GetResult"]);
});
