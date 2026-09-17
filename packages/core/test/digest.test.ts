import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";

import type { OperationIR, ScenarioIR, ScenarioIR as ScenarioType, SemanticIR } from "../src/ir.js";
import type { OperationId, ScenarioId } from "../src/ids.js";
import {
  structDeclaration,
  unionDeclaration,
  listType,
  refType,
  stringType,
  unitType,
} from "../src/types.js";
import {
  stringValue,
  structValue,
  unionValue,
  listValue,
  unitValue,
} from "../src/semantic-value.js";
import {
  semanticIRToJSON,
  serializeSemanticIR,
  specificationDigest,
  semanticIRDocumentToJSON,
  decodeSemanticIRDocument,
} from "../src/digest.js";

function buildIR(order: "forward" | "reverse"): SemanticIR {
  const types = [
    structDeclaration("PutRequest", [
      { name: "value", type: stringType(), optional: false },
      { name: "key", type: stringType(), optional: false },
    ]),
    structDeclaration("GetRequest", [{ name: "key", type: stringType(), optional: false }]),
    unionDeclaration("GetResult", [
      { name: "missing", payload: unitType() },
      { name: "found", payload: stringType() },
    ]),
    structDeclaration("KeyList", [
      { name: "keys", type: listType(stringType()), optional: false },
    ]),
  ];
  const operations: OperationIR[] = [
    { id: "kv.get" as OperationId, input: refType("GetRequest"), output: refType("GetResult") },
    { id: "kv.put" as OperationId, input: refType("PutRequest"), output: unitType() },
    { id: "kv.list" as OperationId, input: unitType(), output: refType("KeyList") },
  ];
  const scenarios: ScenarioType[] = [
    {
      id: "kv.put.then-get" as ScenarioId,
      description: "stored value can be read",
      steps: [
        {
          kind: "call" as const,
          binding: "put",
          operationId: "kv.put" as OperationId,
          input: {
            kind: "literal" as const,
            value: structValue("PutRequest", new Map([
              ["key", stringValue("a")],
              ["value", stringValue("one")],
            ])),
          },
        },
        {
          kind: "call" as const,
          binding: "get",
          operationId: "kv.get" as OperationId,
          input: {
            kind: "literal" as const,
            value: structValue("GetRequest", new Map([["key", stringValue("a")]])),
          },
        },
        {
          kind: "expectEqual" as const,
          actual: { kind: "binding" as const, binding: "get" },
          expected: {
            kind: "literal" as const,
            value: unionValue("GetResult", "found", stringValue("one")),
          },
        },
      ],
    },
    {
      id: "kv.list.empty" as ScenarioId,
      description: "empty store lists no keys",
      steps: [
        {
          kind: "call" as const,
          binding: "list",
          operationId: "kv.list" as OperationId,
          input: { kind: "literal" as const, value: unitValue() },
        },
        {
          kind: "expectEqual" as const,
          actual: { kind: "binding" as const, binding: "list" },
          expected: {
            kind: "literal" as const,
            value: structValue("KeyList", new Map([["keys", listValue([])]])),
          },
        },
      ],
    },
  ];
  const flip = <T>(items: readonly T[]): readonly T[] =>
    order === "forward" ? items : [...items].reverse();
  return {
    specificationName: "kv",
    specificationVersion: "0.1.0",
    types: flip(types),
    operations: flip(operations),
    scenarios: flip(scenarios),
  };
}

test("declaration insertion order does not affect canonical bytes or digest", () => {
  const forward = buildIR("forward");
  const reverse = buildIR("reverse");
  const forwardBytes = serializeSemanticIR(forward);
  const reverseBytes = serializeSemanticIR(reverse);
  assert.equal(forwardBytes, reverseBytes);
  assert.equal(specificationDigest(forward), specificationDigest(reverse));
  assert.equal(specificationDigest(forward).length, 64);
  assert.match(specificationDigest(forward), /^[0-9a-f]{64}$/);
});

test("digest equals sha256 of the canonical semantic bytes", () => {
  const ir = buildIR("forward");
  const expected = createHash("sha256")
    .update(Buffer.from(serializeSemanticIR(ir), "utf8"))
    .digest("hex");
  assert.equal(specificationDigest(ir), expected);
});

test("scenario step order is semantic and changes the digest", () => {
  const ir = buildIR("forward");
  const firstScenario = ir.scenarios[0];
  if (firstScenario === undefined) {
    throw new Error("fixture scenario missing");
  }
  const reordered: SemanticIR = {
    ...ir,
    scenarios: [
      { ...firstScenario, steps: [...firstScenario.steps].reverse() },
      ...ir.scenarios.slice(1),
    ],
  };
  assert.notEqual(specificationDigest(reordered), specificationDigest(ir));
});

test("canonical serialization shape", () => {
  const serialized = serializeSemanticIR(buildIR("forward"));
  assert.ok(serialized.startsWith('{"operations":'), "object keys are sorted");
  assert.ok(!serialized.includes("\n"), "no insignificant whitespace");
  assert.ok(
    serialized.includes('"fields":[{"name":"key","type":{"kind":"string"}}]'),
    "struct fields are sorted by name and optional is omitted when false",
  );
});

test("document JSON wraps the semantic subtree", () => {
  const ir = buildIR("forward");
  const documentText = JSON.stringify(
    semanticIRDocumentToJSON({
      format: "execspec",
      irVersion: 1,
      semantic: ir,
      metadata: { sourceLocations: {} },
    }),
  );
  assert.ok(documentText.startsWith('{"format":"execspec","irVersion":1,"semantic":'));
  assert.ok(documentText.endsWith(',"metadata":{"sourceLocations":{}}}'));
});

test("documents round-trip through decode", () => {
  const ir = buildIR("forward");
  const encoded = JSON.parse(serializeSemanticIR(ir));
  const result = decodeSemanticIRDocument({
    format: "execspec",
    irVersion: 1,
    semantic: encoded,
    metadata: { sourceLocations: {} },
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(specificationDigest(result.document.semantic), specificationDigest(ir));
    assert.deepEqual(
      [...result.document.semantic.types.map((entry) => entry.id)].sort(),
      [...ir.types.map((entry) => entry.id)].sort(),
    );
    assert.equal(result.document.semantic.scenarios.length, 2);
  }
});

test("decode rejects malformed documents", () => {
  assert.equal(decodeSemanticIRDocument(null).ok, false);
  assert.equal(decodeSemanticIRDocument({ format: "other", irVersion: 1 }).ok, false);
  assert.equal(decodeSemanticIRDocument({ format: "execspec", irVersion: 2 }).ok, false);
  assert.equal(
    decodeSemanticIRDocument({ format: "execspec", irVersion: 1, semantic: "nope" }).ok,
    false,
  );
  const badSteps = decodeSemanticIRDocument({
    format: "execspec",
    irVersion: 1,
    semantic: {
      specificationName: "kv",
      specificationVersion: "0.1.0",
      types: [],
      operations: [],
      scenarios: [],
    },
  });
  assert.equal(badSteps.ok, false);
});
