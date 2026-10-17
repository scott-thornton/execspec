# Getting started

This guide walks through the full execspec loop: author a specification
in TypeScript, compile it to canonical IR, generate the Swift and
TypeScript targets, implement the generated contract, and verify your
implementations with the conformance runner.

Everything below runs from a clone of this repository. The example
specifications live under `examples/`; the commands print paths relative
to the repository root.

## 1. Author a specification

Scaffold a fresh specification package with one command (once the
packages are installed or linked):

```bash
npx execspec init --name acme-contract --out ./acme-contract
cd acme-contract && npm install && npm test
```

Or write the module by hand. A specification is a TypeScript module
that exports an authoring graph.
Types, operations, and scenarios are all static data - no callbacks, no
async test bodies.

```ts
import {
  specification, struct, union, enumeration,
  string, int64, float64, bytes, unit, list, map, optional, ref,
  operation, scenario, literal, binding,
  structValue, unionValue, enumValue, unitValue,
} from "@execspec/dsl";

const spec = specification({ name: "inventory", version: "0.1.0" });

spec.type(struct("Item", {
  sku: string(),
  unitPriceMinor: int64(),
  quantity: int64(),
}));
spec.type(union("LookupResult", { found: ref("Item"), missing: unit() }));

spec.operation(operation("inventory.upsert", {
  input: ref("Item"),
  output: unit(),
}));
spec.operation(operation("inventory.lookup", {
  input: string(),
  output: ref("LookupResult"),
}));

spec.scenario(
  scenario("inventory.upsert.then-lookup", "an upserted item can be found")
    .call("upsert", "inventory.upsert", literal(structValue("Item", {
      sku: "widget",
      unitPriceMinor: 325n,
      quantity: 2n,
    })))
    .call("lookup", "inventory.lookup", literal("widget"))
    .expectEqual(
      binding("lookup"),
      literal(unionValue("LookupResult", "found", structValue("Item", {
        sku: "widget",
        unitPriceMinor: 325n,
        quantity: 2n,
      }))),
    )
    .build(),
);

export default spec.build();
```

Things worth knowing while authoring:

- Plain JavaScript values convert unambiguously inside struct literals:
  `string` becomes a string, `bigint` becomes int64, `number` becomes
  float64, `boolean` becomes boolean, `Uint8Array` becomes bytes, arrays
  become lists, and `undefined` omits an optional field. Nominal
  structs, unions, enums, and maps always use their explicit
  constructors.
- Domain failures are values in operation outputs (union cases such as
  `missing` above). Implementation exceptions are for genuine defects
  and fail conformance as crashes.
- `outline(...)` expands a table of rows into scenarios at authoring
  time; see `examples/orders-spec/src/spec.ts` for a worked example.
- Compilation validates scenarios statically. A literal whose shape
  does not match the declared type fails at compile time with a path
  and a code, before any target code runs.
- Deterministic rules (id formats, ordering, money conventions) should
  be pinned by scenarios exactly like the examples do.

Build the spec module and compile it:

```bash
npm run build -w @execspec/example-inventory-spec   # or tsc for your module
node packages/cli/dist/index.js compile \
  --module ./path/to/dist/spec.js \
  --out ./build/inventory.execspec.json
```

The command prints the specification digest - the SHA-256 identity of
the canonical IR. Recompiling a semantically identical specification
always produces identical bytes and the same digest.

## 2. Generate the targets

```bash
node packages/cli/dist/index.js generate swift \
  --ir ./build/inventory.execspec.json \
  --out ./my-app/Sources/InventoryGenerated

node packages/cli/dist/index.js generate typescript \
  --ir ./build/inventory.execspec.json \
  --out ./my-server/src/InventoryGenerated
```

Each target directory contains four source files (types, implementation
protocol, wire codecs, dispatcher), each headed with a do-not-edit
marker. The generated sources are deterministic: committing them and
regenerating must produce an empty `git diff`.

If you use coding agents in the consuming repository, add one short
note to your own root `AGENTS.md` (or equivalent) naming the generated
directories and the three commands above. Guidance belongs at your
repo root, written once; the generator deliberately does not spray
instruction files into your tree.

## 3. Implement the generated contract

On the Swift side, conform to the generated protocol. Business logic
lives here and only here:

```swift
public actor InventoryStore: InventorySpecificationImplementation {
    private var items: [String: Item] = [:]

    public func inventoryUpsert(_ input: Item) async throws -> ExecSpecUnit {
        items[input.sku] = input
        return ExecSpecUnit()
    }

    public func inventoryLookup(_ input: String) async throws -> LookupResult {
        guard let item = items[input] else { return .missing }
        return .found(item)
    }
}
```

Note: generated Swift memberwise initializers take arguments in
canonical (alphabetical) field order.

On the TypeScript side, implement the generated interface; return
values or promises, throw only for genuine defects:

```ts
export class InventoryStore implements InventorySpecificationImplementation {
  private readonly items = new Map<string, Item>();

  public inventoryUpsert(input: Item): ExecSpecUnit {
    this.items.set(input.sku, input);
    return undefined;
  }

  public inventoryLookup(input: string): LookupResult {
    const item = this.items.get(input);
    return item === undefined ? { kind: "missing" } : { kind: "found", value: item };
  }
}
```

Each side needs a three-line host executable that wires the store into
the generated dispatcher and calls `runExecSpecHost`. See
`examples/kv-swift/Sources/KVHost/main.swift` and
`examples/kv-ts/src/host.ts` for the exact shape, then build the Swift
package (`swift build --package-path ...`) or compile the TS module.

## 4. Run conformance

```bash
# Swift implementation
node packages/cli/dist/index.js test \
  --ir ./build/inventory.execspec.json \
  --host ./my-app/.build/debug/InventoryHost

# TypeScript implementation: the same suite, the same verdicts
node packages/cli/dist/index.js test \
  --ir ./build/inventory.execspec.json \
  --host ./my-server/host.mjs
```

Every scenario runs in a fresh host process. The exit code is zero only
when all scenarios pass. Useful flags:

- `--scenario <substring>` runs only matching scenario ids.
- `--concurrency <n>` runs scenarios in parallel (safe: each scenario is
  its own process).
- `--timeout-ms <n>` adjusts the per-operation timeout (default 5000).

Failure output names the scenario, the failing step, and a structural
diff path:

```text
FAIL order.checkout.confirmed

step 5 expectEqual

$.value.paid.minorUnits
  expected: 4000
  actual:   5000
```

## 5. Troubleshooting

| Symptom | Meaning |
| ------- | ------- |
| Handshake failure: "digest mismatch" | The host was built from a different spec version. Regenerate the target and rebuild. |
| Handshake failure: "protocol version mismatch" | The host runtime is from an incompatible execspec version. |
| `HostCrashFailure` | The implementation exited or crashed mid-scenario; check the stderr excerpt in the report. |
| `OperationTimeoutFailure` | The host did not answer within the timeout; raise `--timeout-ms` or fix the hang. |
| `InvalidOutputFailure` | The host returned a value that does not decode against the declared output type (unknown field, bad int64 spelling, wrong union shape). |
| Swift: "argument must precede argument" | Generated inits use alphabetical field order; reorder the call. |

## Where to go next

- `examples/orders-spec` - a realistic domain (carts, money, promos,
  checkout) with fifteen scenarios and two implementations.
- `docs/semantic-model.md` - the wire and equality rules.
- `docs/protocol-v1.md` - the process protocol the hosts speak.
- `docs/cli-reference.md` - every command and flag.
