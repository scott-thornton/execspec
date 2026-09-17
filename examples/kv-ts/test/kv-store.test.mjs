import { test } from "node:test";
import assert from "node:assert/strict";
import { KVStore } from "../dist/KVStore.js";

test("the TS implementation satisfies the generated contract semantics", () => {
  const store = new KVStore();
  store.kvPut({ key: "a", value: "one" });
  assert.deepEqual(store.kvGet({ key: "a" }), { kind: "found", value: "one" });
  store.kvPut({ key: "a", value: "second" });
  assert.deepEqual(store.kvGet({ key: "a" }), { kind: "found", value: "second" });
  store.kvDelete({ key: "a" });
  assert.deepEqual(store.kvGet({ key: "a" }), { kind: "missing" });

  for (const key of ["m", "a", "z", "é", "A"]) {
    store.kvPut({ key, value: "v" });
  }
  assert.deepEqual(store.kvList(undefined), { keys: ["A", "a", "m", "z", "é"] });

  assert.deepEqual(store.kvEchoRevision({ revision: -9223372036854775808n }), { revision: -9223372036854775808n });
  assert.deepEqual(
    store.kvEchoTypes({ weight: Number.NaN, blob: new Uint8Array([1]), counts: new Map([["a", 1n]]), labels: new Map() }),
    { weight: Number.NaN, blob: new Uint8Array([1]), counts: new Map([["a", 1n]]), labels: new Map() },
  );
});
