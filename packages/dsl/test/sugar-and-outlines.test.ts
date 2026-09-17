import { test } from "node:test";
import assert from "node:assert/strict";

import {
  specification,
  struct,
  union,
  string,
  int64,
  float64,
  bytes,
  list,
  map,
  ref,
  unit,
  operation,
  scenario,
  outline,
  literal,
  binding,
  structValue,
  unionValue,
  float64Value,
  bytesValue,
  mapValue,
  stringValue,
  int64Value,
} from "../src/index.js";
import { compileSpecification } from "@execspec/compiler";

test("new type builders construct float64, bytes, and map types", () => {
  assert.deepEqual(float64(), { kind: "float64" });
  assert.deepEqual(bytes(), { kind: "bytes" });
  assert.deepEqual(map(string(), int64()), {
    kind: "map",
    key: { kind: "string" },
    value: { kind: "int64" },
  });
  assert.throws(() => map(float64(), string()), /string or int64/);
});

test("plain values flow through struct and union literals", () => {
  const envelope = structValue("Envelope", {
    weight: 0.5,                     // number → float64
    count: 3n,                       // bigint → int64
    label: "ada",                    // string
    enabled: true,                   // boolean
    blob: new Uint8Array([1, 2]),    // bytes
    tags: ["x", "y"],                // list<string> via plain array
    nickname: undefined,             // absent optional
    nested: structValue("Inner", { a: 1n }),
  });
  assert.equal(envelope.kind, "struct");
  assert.equal(envelope.fields.get("weight")?.kind, "float64");
  assert.equal(envelope.fields.get("count")?.kind, "int64");
  assert.equal(envelope.fields.get("tags")?.kind, "list");
  assert.equal(envelope.fields.has("nickname"), false);

  const found = unionValue("GetResult", "found", "one");
  assert.deepEqual(found.value, { kind: "string", value: "one" });

  assert.throws(() => structValue("Bad", { x: {} } as never), /explicitly/);
});

test("outlines expand a table into compiled scenarios", () => {
  const spec = specification({ name: "kv", version: "0.1.0" });
  spec.type(struct("PutRequest", { key: string(), value: string() }));
  spec.operation(operation("kv.put", { input: ref("PutRequest"), output: unit() }));

  const rows: readonly { id: string; data: { key: string; value: string } }[] = [
    { id: "alpha", data: { key: "a", value: "one" } },
    { id: "beta", data: { key: "b", value: "two" } },
  ];

  for (const built of outline("kv.put.table", "table-driven puts", rows, (row, _index, builder) =>
    builder
      .call("put", "kv.put", literal(structValue("PutRequest", row.data)))
      .expectEqual(binding("put"), literal({ kind: "unit" } as const)),
  )) {
    spec.scenario(built);
  }

  const result = compileSpecification(spec.build());
  if (!result.ok) {
    assert.fail(result.diagnostics.map((d) => d.message).join("\n"));
  }
  assert.deepEqual(
    result.document.semantic.scenarios.map((s) => s.id),
    ["kv.put.table.alpha", "kv.put.table.beta"],
  );
});

test("a spec exercising every new kind compiles and validates", () => {
  const spec = specification({ name: "types", version: "0.1.0" });
  spec.type(struct("TypesRequest", {
    ratio: float64(),
    blob: bytes(),
    counts: map(string(), int64()),
    labels: map(int64(), string()),
    nested: list(map(string(), string())),
  }));
  spec.type(struct("TypesResult", {
    ratio: float64(),
    blob: bytes(),
    counts: map(string(), int64()),
    labels: map(int64(), string()),
    nested: list(map(string(), string())),
  }));
  spec.operation(operation("types.echo", {
    input: ref("TypesRequest"),
    output: ref("TypesResult"),
  }));
  spec.scenario(
    scenario("types.echo.roundtrip", "every extended kind survives")
      .call("echo", "types.echo", literal(structValue("TypesRequest", {
        ratio: float64Value(Number.NaN),
        blob: bytesValue(new Uint8Array([1, 250])),
        counts: mapValue(new Map([["a", int64Value(-9223372036854775808n)]])),
        labels: mapValue(new Map([[9223372036854775807n, stringValue("é")]])),
        nested: [mapValue(new Map([["plain", stringValue("map")]]))],
      })))
      .expectEqual(
        binding("echo"),
        literal(structValue("TypesResult", {
          ratio: float64Value(Number.NaN),
          blob: bytesValue(new Uint8Array([1, 250])),
          counts: mapValue(new Map([["a", int64Value(-9223372036854775808n)]])),
          labels: mapValue(new Map([[9223372036854775807n, stringValue("é")]])),
          nested: [mapValue(new Map([["plain", stringValue("map")]]))],
        })),
      )
      .build(),
  );
  const result = compileSpecification(spec.build());
  if (!result.ok) {
    assert.fail(result.diagnostics.map((d) => d.message).join("\n"));
  }
  assert.match(result.digest, /^[0-9a-f]{64}$/);
});
