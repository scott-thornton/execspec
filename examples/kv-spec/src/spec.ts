/**
 * The KV reference specification (plan Tasks 38–39).
 *
 * A stateful key/value store with a diagnostic int64 echo operation that
 * proves full-width signed integers survive the whole pipeline.
 */

import {
  specification,
  struct,
  union,
  string,
  int64,
  unit,
  list,
  ref,
  operation,
  scenario,
  literal,
  binding,
  structValue,
  stringValue,
  unionValue,
  unitValue,
  listValue,
  int64Value,
} from "@execspec/dsl";

const spec = specification({ name: "kv", version: "0.1.0" });

// --- Types ---------------------------------------------------------------

spec.type(struct("PutRequest", { key: string(), value: string() }));
spec.type(struct("GetRequest", { key: string() }));
spec.type(struct("DeleteRequest", { key: string() }));
spec.type(union("GetResult", { found: string(), missing: unit() }));
spec.type(struct("KeyList", { keys: list(string()) }));
spec.type(struct("RevisionRequest", { revision: int64() }));
spec.type(struct("RevisionResult", { revision: int64() }));

// --- Operations ------------------------------------------------------------

spec.operation(operation("kv.put", { input: ref("PutRequest"), output: unit() }));
spec.operation(operation("kv.get", { input: ref("GetRequest"), output: ref("GetResult") }));
spec.operation(operation("kv.delete", { input: ref("DeleteRequest"), output: unit() }));
spec.operation(operation("kv.list", { input: unit(), output: ref("KeyList") }));
spec.operation(operation("kv.echo-revision", {
  input: ref("RevisionRequest"),
  output: ref("RevisionResult"),
}));

// --- Scenarios ---------------------------------------------------------------

const putRequest = (key: string, value: string) =>
  literal(structValue("PutRequest", new Map([
    ["key", stringValue(key)],
    ["value", stringValue(value)],
  ])));

const getRequest = (key: string) =>
  literal(structValue("GetRequest", new Map([["key", stringValue(key)]])));

const deleteRequest = (key: string) =>
  literal(structValue("DeleteRequest", new Map([["key", stringValue(key)]])));

const found = (value: string) =>
  literal(unionValue("GetResult", "found", stringValue(value)));

const missing = () => literal(unionValue("GetResult", "missing"));

// Reads of absent keys report missing, never throw.
spec.scenario(
  scenario("kv.get.missing", "reading a key that was never stored reports missing")
    .call("get", "kv.get", getRequest("a"))
    .expectEqual(binding("get"), missing())
    .build(),
);

// Stored values can subsequently be read.
spec.scenario(
  scenario("kv.put.then-get", "a stored value can subsequently be read")
    .call("put", "kv.put", putRequest("a", "one"))
    .call("get", "kv.get", getRequest("a"))
    .expectEqual(binding("get"), found("one"))
    .build(),
);

// Puts replace existing values.
spec.scenario(
  scenario("kv.put.overwrite", "putting an existing key replaces its value")
    .call("first", "kv.put", putRequest("a", "first"))
    .call("second", "kv.put", putRequest("a", "second"))
    .call("get", "kv.get", getRequest("a"))
    .expectEqual(binding("get"), found("second"))
    .build(),
);

// Deletion makes existing keys missing again.
spec.scenario(
  scenario("kv.delete.existing", "deleting an existing key makes it missing")
    .call("put", "kv.put", putRequest("a", "one"))
    .call("delete", "kv.delete", deleteRequest("a"))
    .call("get", "kv.get", getRequest("a"))
    .expectEqual(binding("get"), missing())
    .build(),
);

// Deleting a missing key is a successful no-op.
spec.scenario(
  scenario("kv.delete.missing", "deleting a missing key is a successful no-op")
    .call("delete", "kv.delete", deleteRequest("b"))
    .expectEqual(binding("delete"), literal(unitValue()))
    .build(),
);

// An empty store lists no keys.
spec.scenario(
  scenario("kv.list.empty", "an empty store lists no keys")
    .call("list", "kv.list", literal(unitValue()))
    .expectEqual(
      binding("list"),
      literal(structValue("KeyList", new Map([["keys", listValue([])]]))),
    )
    .build(),
);

// Keys come back in ascending Unicode scalar lexical order.
spec.scenario(
  scenario("kv.list.sorted", "keys are listed in ascending scalar order")
    .call("putM", "kv.put", putRequest("m", "1"))
    .call("putA", "kv.put", putRequest("a", "2"))
    .call("putZ", "kv.put", putRequest("z", "3"))
    .call("putAccent", "kv.put", putRequest("é", "4"))
    .call("list", "kv.list", literal(unitValue()))
    .expectEqual(
      binding("list"),
      literal(structValue("KeyList", new Map([
        ["keys", listValue([stringValue("a"), stringValue("m"), stringValue("z"), stringValue("é")])],
      ]))),
    )
    .build(),
);

// Scenario A of the isolation proof: this scenario stores the key; the
// next scenario must not see it because hosts never share state.
spec.scenario(
  scenario("kv.isolation-seed", "seeds a key that no later scenario may observe")
    .call("put", "kv.put", putRequest("persistent-test-key", "seed-value"))
    .expectEqual(binding("put"), literal(unitValue()))
    .build(),
);

// Scenario B of the isolation proof: fresh host, key is missing.
spec.scenario(
  scenario("kv.scenario-isolation", "state does not leak between scenarios")
    .call("get", "kv.get", getRequest("persistent-test-key"))
    .expectEqual(binding("get"), missing())
    .build(),
);

// The int64 wire proof: both extremes survive Swift and back.
spec.scenario(
  scenario("kv.int64-wire-proof", "full-width int64 values survive the pipeline")
    .call("max", "kv.echo-revision", literal(structValue("RevisionRequest", new Map([
      ["revision", int64Value(9223372036854775807n)],
    ]))))
    .expectEqual(
      binding("max"),
      literal(structValue("RevisionResult", new Map([
        ["revision", int64Value(9223372036854775807n)],
      ]))),
    )
    .call("min", "kv.echo-revision", literal(structValue("RevisionRequest", new Map([
      ["revision", int64Value(-9223372036854775808n)],
    ]))))
    .expectEqual(
      binding("min"),
      literal(structValue("RevisionResult", new Map([
        ["revision", int64Value(-9223372036854775808n)],
      ]))),
    )
    .build(),
);

export default spec.build();
