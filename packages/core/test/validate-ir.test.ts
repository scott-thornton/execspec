import { test } from "node:test";
import assert from "node:assert/strict";

import type { SemanticIR } from "../src/ir.js";
import {
  structDeclaration,
  unionDeclaration,
  enumDeclaration,
  listType,
  refType,
  stringType,
  int64Type,
  unitType,
} from "../src/types.js";
import {
  stringValue,
  int64Value,
  unitValue,
  structValue,
  unionValue,
  listValue,
} from "../src/semantic-value.js";
import { validateSemanticIR, inferExpressionType, typeEquals, staticTypeOfValue } from "../src/validate-ir.js";
import type { IRTypeEnvironment } from "../src/validate-ir.js";
import type { OperationId, ScenarioId, TypeId } from "../src/ids.js";

const types = [
  structDeclaration("PutRequest", [
    { name: "key", type: stringType(), optional: false },
    { name: "value", type: stringType(), optional: false },
  ]),
  structDeclaration("GetRequest", [{ name: "key", type: stringType(), optional: false }]),
  unionDeclaration("GetResult", [
    { name: "found", payload: stringType() },
    { name: "missing", payload: unitType() },
  ]),
  structDeclaration("KeyList", [
    { name: "keys", type: listType(stringType()), optional: false },
  ]),
];

function irWith(overrides: Partial<SemanticIR> = {}): SemanticIR {
  return {
    specificationName: "kv",
    specificationVersion: "0.1.0",
    types,
    operations: [
      {
        id: "kv.put" as OperationId,
        input: refType("PutRequest"),
        output: unitType(),
      },
      {
        id: "kv.get" as OperationId,
        input: refType("GetRequest"),
        output: refType("GetResult"),
      },
    ],
    scenarios: [
      {
        id: "kv.put.then-get" as ScenarioId,
        description: "stored value can be read",
        steps: [
          {
            kind: "call",
            binding: "put",
            operationId: "kv.put" as OperationId,
            input: {
              kind: "literal",
              value: structValue("PutRequest", new Map([
                ["key", stringValue("a")],
                ["value", stringValue("one")],
              ])),
            },
          },
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
            expected: {
              kind: "literal",
              value: unionValue("GetResult", "found", stringValue("one")),
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function codes(ir: SemanticIR): string[] {
  return validateSemanticIR(ir).map((diagnostic) => diagnostic.code);
}

test("a valid IR produces no diagnostics", () => {
  assert.deepEqual(validateSemanticIR(irWith()), []);
});

test("duplicate type, operation, and scenario ids are rejected", () => {
  const firstType = types[0];
  if (firstType === undefined) {
    throw new Error("fixture type missing");
  }
  assert.ok(codes(irWith({ types: [...types, firstType] })).includes("types.duplicate"));

  const base = irWith();
  const firstOperation = base.operations[0];
  const firstScenario = base.scenarios[0];
  if (firstOperation === undefined || firstScenario === undefined) {
    throw new Error("fixture missing");
  }
  assert.ok(
    codes(irWith({ operations: [...base.operations, firstOperation] })).includes("operations.duplicate"),
  );
  assert.ok(
    codes(irWith({ scenarios: [...base.scenarios, firstScenario] })).includes("scenarios.duplicate"),
  );
});

test("unknown type references are rejected", () => {
  const bad = irWith({
    operations: [
      { id: "kv.put" as OperationId, input: refType("Nowhere"), output: unitType() },
    ],
  });
  assert.ok(codes(bad).includes("types.unknownReference"));
});

test("recursive types are rejected", () => {
  const recursive = [
    structDeclaration("Node", [{ name: "next", type: refType("Node"), optional: true }]),
    ...types,
  ];
  assert.ok(codes(irWith({ types: recursive })).includes("types.recursive"));
});

test("optional unit struct fields are rejected", () => {
  const withOptionalUnit = [
    structDeclaration("Bad", [{ name: "nothing", type: unitType(), optional: true }]),
    ...types,
  ];
  assert.ok(codes(irWith({ types: withOptionalUnit })).includes("struct.optionalUnit"));
});

test("empty specifications are rejected", () => {
  assert.ok(codes(irWith({ operations: [] })).includes("specification.noOperations"));
  assert.ok(codes(irWith({ scenarios: [] })).includes("specification.noScenarios"));
});

test("scenarios with zero steps are rejected", () => {
  const scenario = irWith().scenarios[0];
  if (scenario === undefined) {
    assert.fail("fixture scenario missing");
  }
  assert.ok(
    codes(irWith({ scenarios: [{ ...scenario, steps: [] }] })).includes("scenario.noSteps"),
  );
});

test("unknown operations and forward binding references are rejected", () => {
  const scenario = irWith().scenarios[0];
  if (scenario === undefined) {
    assert.fail("fixture scenario missing");
  }
  const call = scenario.steps[0];
  if (call?.kind !== "call") {
    assert.fail("fixture step missing");
  }
  const badOperation = irWith({
    scenarios: [{
      ...scenario,
      steps: [{ ...call, operationId: "kv.nope" as OperationId }],
    }],
  });
  assert.ok(codes(badOperation).includes("call.unknownOperation"));

  const forwardReference = irWith({
    scenarios: [{
      ...scenario,
      steps: [
        {
          kind: "expectEqual",
          actual: { kind: "binding", binding: "get" },
          expected: { kind: "literal", value: unitValue() },
        },
        ...scenario.steps,
      ],
    }],
  });
  const forwardCodes = codes(forwardReference);
  assert.ok(forwardCodes.includes("expression.typeError"));

  const duplicateBinding = irWith({
    scenarios: [{
      ...scenario,
      steps: [
        call,
        {
          kind: "call",
          binding: "put",
          operationId: "kv.get" as OperationId,
          input: { kind: "literal", value: structValue("GetRequest", new Map([["key", stringValue("a")]])) },
        },
      ],
    }],
  });
  assert.ok(codes(duplicateBinding).includes("call.duplicateBinding"));
});

test("literal incompatible with operation input is rejected", () => {
  const scenario = irWith().scenarios[0];
  if (scenario === undefined) {
    assert.fail("fixture scenario missing");
  }
  const wrongLiteral = irWith({
    scenarios: [{
      ...scenario,
      steps: [
        {
          kind: "call",
          binding: "put",
          operationId: "kv.put" as OperationId,
          input: {
            kind: "literal",
            value: structValue("PutRequest", new Map([["key", stringValue("a")]])),
          },
        },
      ],
    }],
  });
  const wrongCodes = codes(wrongLiteral);
  assert.ok(wrongCodes.some((code) => code.startsWith("literal.")));

  const wrongNominal = irWith({
    scenarios: [{
      ...scenario,
      steps: [
        {
          kind: "call",
          binding: "put",
          operationId: "kv.put" as OperationId,
          input: {
            kind: "literal",
            value: structValue("GetRequest", new Map([["key", stringValue("a")]])),
          },
        },
      ],
    }],
  });
  assert.ok(codes(wrongNominal).includes("call.inputTypeMismatch"));
});

test("expectEqual static type mismatches are rejected", () => {
  const scenario = irWith().scenarios[0];
  if (scenario === undefined) {
    assert.fail("fixture scenario missing");
  }
  const mismatch = irWith({
    scenarios: [{
      ...scenario,
      steps: [
        {
          kind: "call",
          binding: "put",
          operationId: "kv.put" as OperationId,
          input: {
            kind: "literal",
            value: structValue("PutRequest", new Map([
              ["key", stringValue("a")],
              ["value", stringValue("one")],
            ])),
          },
        },
        {
          kind: "expectEqual",
          actual: { kind: "binding", binding: "put" },
          expected: { kind: "literal", value: stringValue("not a unit") },
        },
      ],
    }],
  });
  assert.ok(codes(mismatch).includes("expectEqual.typeMismatch"));
});

test("field traversal validation", () => {
  const env: IRTypeEnvironment = {
    declarations: new Map(types.map((decl) => [decl.id as TypeId, decl])),
    operations: new Map(),
  };
  const bindings = new Map([["getResult", refType("GetResult")]]);

  // 'value' on GetResult (single non-unit payload case) infers to string.
  assert.deepEqual(
    inferExpressionType(
      { kind: "field", base: { kind: "binding", binding: "getResult" }, field: "value" },
      bindings,
      env,
    ),
    stringType(),
  );

  // 'value' on a genuinely mixed-payload union is ambiguous.
  const mixedEnv: IRTypeEnvironment = {
    declarations: new Map(
      [
        unionDeclaration("Mixed", [
          { name: "text", payload: stringType() },
          { name: "count", payload: int64Type() },
          { name: "empty", payload: unitType() },
        ]),
        ...types,
      ].map((decl) => [decl.id as TypeId, decl]),
    ),
    operations: new Map(),
  };
  assert.throws(() =>
    inferExpressionType(
      { kind: "field", base: { kind: "binding", binding: "mixed" }, field: "value" },
      new Map([["mixed", refType("Mixed")]]),
      mixedEnv,
    ),
    /ambiguous/,
  );

  // Unknown struct field.
  assert.throws(() =>
    inferExpressionType(
      { kind: "field", base: { kind: "literal", value: structValue("GetRequest", new Map([["key", stringValue("a")]])) }, field: "nope" },
      new Map(),
      env,
    ),
    /no field/,
  );

  // Field on a primitive.
  assert.throws(() =>
    inferExpressionType(
      { kind: "field", base: { kind: "literal", value: stringValue("a") }, field: "value" },
      new Map(),
      env,
    ),
    /non-nominal/,
  );

  // A homogeneous-payload union traverses to the shared payload type.
  const homogenousTypes = [
    unionDeclaration("Tree", [
      { name: "leaf", payload: int64Type() },
      { name: "empty", payload: unitType() },
    ]),
  ];
  const homogenousEnv: IRTypeEnvironment = {
    declarations: new Map(homogenousTypes.map((decl) => [decl.id as TypeId, decl])),
    operations: new Map(),
  };
  assert.deepEqual(
    inferExpressionType(
      { kind: "field", base: { kind: "binding", binding: "tree" }, field: "value" },
      new Map([["tree", refType("Tree")]]),
      homogenousEnv,
    ),
    int64Type(),
  );
});

test("typeEquals is structural for value types", () => {
  assert.equal(typeEquals(stringType(), stringType()), true);
  assert.equal(typeEquals(listType(stringType()), listType(stringType())), true);
  assert.equal(typeEquals(listType(stringType()), listType(int64Type())), false);
  assert.equal(typeEquals(refType("A"), refType("B")), false);
  assert.equal(typeEquals(unitType(), stringType()), false);
});

test("heterogeneous and empty list literals have no static type", () => {
  assert.throws(() => staticTypeOfValue(listValue([])), /empty/);
  assert.throws(
    () => staticTypeOfValue(listValue([stringValue("a"), int64Value(1n)])),
    /heterogeneous/,
  );
  assert.deepEqual(
    staticTypeOfValue(listValue([stringValue("a"), stringValue("b")])),
    listType(stringType()),
  );
});

test("well-formed list literals infer element types", () => {
  const ir = irWith();
  const scenario = ir.scenarios[0];
  if (scenario === undefined) {
    assert.fail("fixture scenario missing");
  }
  const listScenario = irWith({
    scenarios: [{
      ...scenario,
      steps: [
        {
          kind: "expectEqual",
          actual: {
            kind: "literal",
            value: listValue([stringValue("a"), stringValue("b")]),
          },
          expected: {
            kind: "literal",
            value: listValue([stringValue("a")]),
          },
        },
      ],
    }],
  });
  // Both sides are list<string> literals of different lengths: statically
  // type-compatible, so no diagnostics.
  assert.deepEqual(codes(listScenario), []);
});
