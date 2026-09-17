import { test } from "node:test";
import assert from "node:assert/strict";

import {
  structDeclaration,
  listType,
  mapType,
  refType,
  stringType,
  int64Type,
  float64Type,
  bytesType,
  unitType,
} from "../src/types.js";
import {
  float64Value,
  bytesValue,
  mapValue,
  stringValue,
  int64Value,
  listValue,
  structValue,
  unionValue,
} from "../src/semantic-value.js";
import type { SemanticValue, TypeDeclaration, ValueType } from "../src/index.js";
import type { TypeId } from "../src/ids.js";
import { validateValue } from "../src/validate-value.js";
import type { TypeEnvironment } from "../src/validate-value.js";
import { semanticDiff, semanticEqual } from "../src/equality.js";
import {
  encodeSemanticValue,
  decodeSemanticValue,
} from "../src/semantic-value-json.js";
import { validateSemanticIR, staticTypeOfValue } from "../src/validate-ir.js";
import { unionDeclaration } from "../src/types.js";
import type { SemanticIR } from "../src/ir.js";

function env(...declarations: TypeDeclaration[]): TypeEnvironment {
  return { declarations: new Map(declarations.map((d) => [d.id as TypeId, d])) };
}

const Envelope = structDeclaration("Envelope", [
  { name: "weight", type: float64Type(), optional: false },
  { name: "blob", type: bytesType(), optional: false },
  { name: "labels", type: mapType(stringType(), stringType()), optional: false },
  { name: "counts", type: mapType(int64Type(), int64Type()), optional: false },
  { name: "note", type: stringType(), optional: true },
]);
const environment = env(Envelope);

test("float64 wire form is canonical ECMAScript spelling", () => {
  const encode = (n: number) =>
    encodeSemanticValue(float64Value(n), float64Type(), environment);
  assert.deepEqual(encode(0.5), { $f64: "0.5" });
  assert.deepEqual(encode(1e21), { $f64: "1e+21" });
  assert.deepEqual(encode(1e-7), { $f64: "1e-7" });
  assert.deepEqual(encode(Number.MAX_SAFE_INTEGER), { $f64: "9007199254740991" });
  assert.deepEqual(encode(Number.NaN), { $f64: "NaN" });
  assert.deepEqual(encode(Number.POSITIVE_INFINITY), { $f64: "Infinity" });
  assert.deepEqual(encode(Number.NEGATIVE_INFINITY), { $f64: "-Infinity" });
  assert.deepEqual(encode(-0), { $f64: "0" });

  const decodeOk = (wire: unknown) =>
    decodeSemanticValue(wire as never, float64Type(), environment);
  assert.equal(decodeOk({ $f64: "0.5" }).ok, true);
  for (const bad of [{ $f64: ".5" }, { $f64: "1e5" }, { $f64: "01" }, { $f64: "+1" }, { $f64: "nan" }, { $f64: 0.5 }, { $f64: "-0.0" }]) {
    assert.equal(decodeOk(bad).ok, false, JSON.stringify(bad));
  }
});

test("float64 portable equality: -0 ≡ 0 and NaN ≡ NaN", () => {
  assert.equal(semanticEqual(float64Value(-0), float64Value(0)), true);
  assert.equal(semanticEqual(float64Value(Number.NaN), float64Value(Number.NaN)), true);
  assert.equal(semanticEqual(float64Value(0.1 + 0.2), float64Value(0.3)), false);
});

test("bytes wire form is canonical padded base64", () => {
  const value = bytesValue(new Uint8Array([1, 2, 3, 250]));
  const wire = encodeSemanticValue(value, bytesType(), environment);
  assert.deepEqual(wire, { $b64: "AQID+g==" });
  const decoded = decodeSemanticValue(wire as never, bytesType(), environment);
  if (!decoded.ok) {
    assert.fail("roundtrip failed");
  }
  assert.deepEqual(new Uint8Array((decoded.value as { value: Uint8Array }).value), new Uint8Array([1, 2, 3, 250]));

  for (const bad of ["AQID+g===", "  AQID+g==", "AQID+g", "AQID_g==", "AQID-g=="]) {
    assert.equal(
      decodeSemanticValue({ $b64: bad } as never, bytesType(), environment).ok,
      false,
      bad,
    );
  }
  assert.equal(semanticEqual(bytesValue(new Uint8Array([1])), bytesValue(new Uint8Array([2]))), false);
});

test("map values: string and int64 keys, wire objects, order-insensitive equality", () => {
  const labelsMapType = mapType(stringType(), stringType());
  const labels = mapValue(new Map([
    ["zeta", stringValue("last")],
    ["alpha", stringValue("first")],
  ]));
  const wire = encodeSemanticValue(labels, labelsMapType, environment);
  assert.deepEqual(wire, { alpha: "first", zeta: "last" });

  const countsType = mapType(int64Type(), int64Type());
  const counts = mapValue(new Map([
    [10n, int64Value(1n)],
    [9n, int64Value(2n)],
  ]));
  assert.deepEqual(
    encodeSemanticValue(counts, countsType, environment),
    { 9: { $i64: "2" }, 10: { $i64: "1" } },
  );

  // Equality ignores insertion order.
  assert.equal(
    semanticEqual(
      mapValue(new Map([["a", stringValue("x")], ["b", stringValue("y")]])),
      mapValue(new Map([["b", stringValue("y")], ["a", stringValue("x")]])),
    ),
    true,
  );
  assert.equal(
    semanticEqual(
      mapValue(new Map([["a", stringValue("x")]])),
      mapValue(new Map([["a", stringValue("y")]])),
    ),
    false,
  );

  // int64 keys must be canonical decimals on the wire.
  assert.equal(
    decodeSemanticValue({ "01": { $i64: "1" } } as never, countsType, environment).ok,
    false,
  );
  assert.equal(
    decodeSemanticValue({ 9: { $i64: "2" } } as never, countsType, environment).ok,
    true,
  );
});

test("composite validation covers the new kinds", () => {
  const good = structValue("Envelope", new Map<string, SemanticValue>([
    ["weight", float64Value(1.5)],
    ["blob", bytesValue(new Uint8Array([9]))],
    ["labels", mapValue(new Map([["k", stringValue("v")]]))],
    ["counts", mapValue(new Map([[1n, int64Value(1n)]]))],
  ]));
  assert.deepEqual(validateValue(good, refType("Envelope"), environment), []);

  const wrongLabels = structValue("Envelope", new Map<string, SemanticValue>([
    ["weight", float64Value(1.5)],
    ["blob", bytesValue(new Uint8Array())],
    ["labels", stringValue("not a map")],
    ["counts", mapValue(new Map())],
  ]));
  const issues = validateValue(wrongLabels, refType("Envelope"), environment);
  assert.ok(issues.some((issue) => issue.path === "$.labels" && issue.code === "typeMismatch"));
});

test("map keys are restricted to string and int64", () => {
  assert.throws(() => mapType(float64Type(), stringType()), /string or int64/);
  const badMapType = { kind: "map", key: float64Type(), value: stringType() } as unknown as ValueType;
  const ir: SemanticIR = {
    specificationName: "x",
    specificationVersion: "1.0.0",
    types: [
      structDeclaration("A", [{ name: "m", type: badMapType, optional: false }]),
    ],
    operations: [{ id: "x.a" as never, input: refType("A"), output: unitType() }],
    scenarios: [{
      id: "x.b" as never,
      description: "d",
      steps: [{ kind: "call", binding: "a", operationId: "x.a" as never, input: { kind: "literal", value: structValue("A", new Map()) } }],
    }],
  };
  assert.ok(validateSemanticIR(ir).some((d) => d.code === "types.mapKey"));
});

test("static types: uniform maps infer, heterogeneous and empty do not", () => {
  assert.deepEqual(
    staticTypeOfValue(mapValue(new Map([["a", stringValue("x")], ["b", stringValue("y")]]))),
    mapType(stringType(), stringType()),
  );
  assert.deepEqual(
    staticTypeOfValue(mapValue(new Map([[1n, int64Value(2n)]]))),
    mapType(int64Type(), int64Type()),
  );
  assert.throws(() => staticTypeOfValue(mapValue(new Map<string | bigint, SemanticValue>())), /empty map/);
  assert.throws(
    () => staticTypeOfValue(mapValue(new Map<string | bigint, SemanticValue>([["a", stringValue("x")], ["b", int64Value(1n)]]))),
    /heterogeneous/,
  );
});

test("float64 and bytes survive nested struct round-trips", () => {
  const type = refType("Envelope");
  const value = structValue("Envelope", new Map<string, SemanticValue>([
    ["weight", float64Value(Number.NaN)],
    ["blob", bytesValue(new Uint8Array([200, 0, 255]))],
    ["labels", mapValue(new Map([["é😀", stringValue("ok")]]))],
    ["counts", mapValue(new Map([[-9223372036854775808n, int64Value(9223372036854775807n)]]))],
    ["note", stringValue("present")],
  ]));
  const wire = encodeSemanticValue(value, type, environment);
  const back = decodeSemanticValue(wire, type, environment);
  if (!back.ok) {
    assert.fail(back.issues.map((i) => i.message).join("; "));
  }
  assert.ok(semanticEqual(value, back.value));
  assert.deepEqual(semanticDiff(value, back.value), []);
});

test("list and map nesting round-trips", () => {
  const type = listType(mapType(stringType(), bytesType()));
  const value = listValue([
    mapValue(new Map([["a", bytesValue(new Uint8Array([1]))]])),
    mapValue(new Map()),
  ]);
  const wire = encodeSemanticValue(value, type, environment);
  const back = decodeSemanticValue(wire, type, environment);
  if (!back.ok) {
    assert.fail(back.issues.map((i) => i.message).join("; "));
  }
  assert.equal(semanticEqual(value, back.value), true);
});

test("union payloads carry the new kinds", () => {
  const Payload = structDeclaration("Payload", [
    { name: "blob", type: bytesType(), optional: false },
  ]);
  const Ratio = structDeclaration("Ratio", [
    { name: "value", type: float64Type(), optional: false },
  ]);
  const Choice = {
    kind: "union",
    id: "Choice",
    cases: [
      { name: "blob", payload: refType("Payload") },
      { name: "ratio", payload: refType("Ratio") },
    ],
  } as const;
  const choiceEnv = env(Payload, Ratio, Choice as unknown as TypeDeclaration);
  const blob = unionValue("Choice", "blob", structValue("Payload", new Map<string, SemanticValue>([
    ["blob", bytesValue(new Uint8Array([7]))],
  ])));
  const wire = encodeSemanticValue(blob, refType("Choice"), choiceEnv);
  assert.deepEqual(wire, { $case: "blob", value: { blob: { $b64: "Bw==" } } });
  const back = decodeSemanticValue(wire, refType("Choice"), choiceEnv);
  if (!back.ok) {
    assert.fail(back.issues.map((i) => i.message).join("; "));
  }
  assert.equal(semanticEqual(blob, back.value), true);
});
