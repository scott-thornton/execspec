# execspec

TypeScript authors a portable behavioral specification. The
specification compiles to a canonical, language-neutral semantic IR.
Swift is generated strictly as an implementation target. A TypeScript
harness verifies any implementation through a language-neutral process
protocol.

> Swift is an implementation target, not a specification language.

## What execspec is

A v0.1 vertical slice of an executable specification system:

- **Author** types, operations, and behavioral scenarios in TypeScript
  through a static DSL - no callbacks, no async test bodies; scenarios
  compile to data.
- **Compile** to canonical Semantic IR whose SHA-256 digest is the
  specification's identity. Declaration order is non-semantic; scenario
  step order is.
- **Generate** Swift types, an implementation protocol, wire codecs, and
  a dispatcher - all deterministic, all derived from IR only.
- **Implement** the generated protocol by hand; the harness spawns your
  host as a black box, one fresh process per scenario, and judges only
  portable observations over NDJSON on stdin/stdout.

## Architecture

```text
TypeScript DSL ──build──▶ AuthoringGraph
                              │ compile (validate, lower, normalize)
                              ▼
                        Semantic IR (canonical) ─── digest = SHA-256
                              │ generate swift          │ interpret
                              ▼                         ▼
                  generated Swift contract      scenario runner (harness)
                              ▼                         │ NDJSON protocol
                  handwritten Swift impl  ◀─────────────┘
```

Packages: `@execspec/core` (semantic model, IR, digest),
`@execspec/dsl` (authoring), `@execspec/compiler`,
`@execspec/swift-generator` (IR-only), `@execspec/harness`
(IR-only), `@execspec/cli`. Swift side: `targets/swift-runtime`
(protocol runtime) and `examples/kv-swift` (reference implementation).

## Requirements

- macOS with a Swift 6 toolchain (the runtime uses POSIX descriptors via
  `Darwin`; Linux is not yet a supported host platform)
- Node.js ≥ 24 and npm (workspaces)
- Bash for `scripts/acceptance.sh`

## Install

The packages are not yet published to npm - use it from a clone:

```bash
git clone <this-repository>
cd execspec
npm ci
npm run build
```

Every command below runs from the repository root.

## Define a specification

```ts
import {
  specification, struct, union, string, unit, int64, list, ref,
  operation, scenario, literal, binding,
  structValue, stringValue, unionValue, unitValue, listValue, int64Value,
} from "@execspec/dsl";

const spec = specification({ name: "kv", version: "0.1.0" });

spec.type(struct("PutRequest", { key: string(), value: string() }));
spec.type(union("GetResult", { found: string(), missing: unit() }));

spec.operation(operation("kv.put", { input: ref("PutRequest"), output: unit() }));
spec.operation(operation("kv.get", { input: ref("GetRequest"), output: ref("GetResult") }));

spec.scenario(
  scenario("kv.put.then-get", "a stored value can subsequently be read")
    .call("put", "kv.put", literal(structValue("PutRequest", new Map([
      ["key", stringValue("a")],
      ["value", stringValue("one")],
    ]))))
    .call("get", "kv.get", literal(structValue("GetRequest", new Map([
      ["key", stringValue("a")],
    ]))))
    .expectEqual(binding("get"), literal(unionValue("GetResult", "found", stringValue("one"))))
    .build(),
);

export default spec.build();
```

Two complete examples live in the repository:

- `examples/kv-spec` - the systems example: eleven scenarios including
  the full-width int64 wire proof and process isolation, implemented in
  both Swift (`examples/kv-swift`) and TypeScript (`examples/kv-ts`).
- `examples/orders-spec` - a realistic ordering domain: carts, exact
  integer money math, promo thresholds, currency rules, and checkout
  with decline paths. Fifteen scenarios pin the business rules; the
  same suite passes against the Swift (`examples/orders-swift`) and
  TypeScript (`examples/orders-ts`) implementations - identical money,
  identical behavior, two languages.

## Compile it

```bash
node packages/cli/dist/index.js compile \
  --module ./examples/kv-spec/dist/spec.js \
  --out ./build/kv.execspec.json
```

The command prints the specification digest and writes the canonical IR
document (one JSON line plus a trailing newline). Recompiling a
semantically identical specification always produces identical bytes.

## Generate Swift

```bash
node packages/cli/dist/index.js generate swift \
  --ir ./build/kv.execspec.json \
  --out ./examples/kv-swift/Sources/KVGenerated
```

This produces exactly four files - `ExecSpecTypes.swift`,
`ExecSpecImplementation.swift`, `ExecSpecCodecs.swift`,
`ExecSpecDispatcher.swift` - into the output directory atomically.

## Implement the generated Swift contract

```swift
import ExecSpecRuntime
import KVGenerated

public actor KVStore: KVSpecificationImplementation {
    private var values: [String: String] = [:]

    public func kvPut(_ input: PutRequest) async throws -> ExecSpecUnit {
        values[input.key] = input.value
        return ExecSpecUnit()
    }

    public func kvGet(_ input: GetRequest) async throws -> GetResult {
        guard let value = values[input.key] else { return .missing }
        return .found(value)
    }

    public func kvDelete(_ input: DeleteRequest) async throws -> ExecSpecUnit {
        values.removeValue(forKey: input.key)
        return ExecSpecUnit()
    }

    public func kvList(_ input: ExecSpecUnit) async throws -> KeyList {
        KeyList(keys: values.keys.sorted { $0.utf8.lexicographicallyPrecedes($1.utf8) })
    }

    public func kvEchoRevision(_ input: RevisionRequest) async throws -> RevisionResult {
        RevisionResult(revision: input.revision)
    }
}
```

The host executable is three lines (`examples/kv-swift/Sources/KVHost`):
create the store, wrap it in the generated dispatcher, call
`runExecSpecHost`. Swift `throws` signals implementation exceptions
only; domain failures (like `GetResult.missing`) are output values.

```bash
swift build --package-path examples/kv-swift
```

## Generate TypeScript (the second implementation target)

```bash
node packages/cli/dist/index.js generate typescript \
  --ir ./build/kv.execspec.json \
  --out ./examples/kv-ts/src/KVGenerated
```

The same IR generates a TypeScript contract (`examples/kv-ts`): a
handwritten `KVStore` implements it, and the **same conformance suite**
verifies it - one specification, two languages, identical verdicts.

```bash
node packages/cli/dist/index.js test --ir ./build/kv.execspec.json --host ./examples/kv-ts/host.mjs
```

## Run conformance tests

```bash
node packages/cli/dist/index.js test \
  --ir ./build/kv.execspec.json \
  --host ./examples/kv-swift/.build/debug/KVHost \
  --timeout-ms 5000
```

Every scenario runs in a fresh host process; the exit code is zero only
when all scenarios pass.

## Semantic guarantees

- int64 is full-range signed 64-bit end to end (wire form
  `{"$i64":"9223372036854775807"}`); JavaScript `number` is never used.
- Strings compare by exact Unicode scalar sequence; no normalization.
- Structs/unions are nominal; struct field order is non-semantic; list
  order is semantic.
- Optional struct fields distinguish absent from rejected explicit
  `null`.
- Unknown fields, unknown cases, and malformed unions are rejected on
  the wire by both sides.
- The digest covers the semantic IR only; declaration order never
  changes it, scenario step order always does.
- Handshake checks protocol version and digest: a stale host fails
  before any operation is dispatched.
- Implementations cannot see scenario identity; only operation ID and
  input cross the process boundary.

## Generated-code contract

- Generated files are disposable build products; never edit them (every
  file says `// Generated by execspec. DO NOT EDIT.`).
- Your implementation depends only on the generated public protocol and
  types; nothing else.
- Regeneration is deterministic and idempotent: this repository commits
  the generated Swift sources, so `git diff` after regeneration must be
  empty.
- A digest mismatch at handshake means stale generated code or a stale
  host build - regenerate and rebuild.
- Target-native Swift tests remain appropriate for Swift-specific
  concerns (actor behavior, codec edges); conformance is what the
  harness proves.

## Current v0.1 limitations

Type system: `unit`, `boolean`, `int64`, `float64`, `string`, `bytes`,
optional struct fields, `list`, `map<string|int64, T>`, named structs,
enums, and tagged unions; no timestamps, sets, tuples, or recursive
types. Scenarios support only `call` and `expectEqual` steps with
literal/binding/field expressions (plus table-driven outlines at
authoring time). Two implementation targets (Swift, TypeScript);
sequential requests per host; no callbacks/streaming/reset; no
property-based testing. The CLI loads compiled ESM modules, not raw
`.ts` files. Parallel scenario execution is available via
`--concurrency`, and `--scenario` filters by id substring.

## Documentation

- `docs/getting-started.md` - the full walkthrough: author, compile,
  generate both targets, implement, run conformance, troubleshoot.
- `docs/cli-reference.md` - every command, flag, and exit code.
- `docs/specification.md`, `docs/semantic-model.md`, `docs/ir-v1.md`,
  `docs/protocol-v1.md` - the normative documents.
- `CONTRIBUTING.md` and `AGENTS.md` - how to change this repository
  (and the rules that must not erode).

## Repository development commands

```bash
npm ci                 # install
npm run typecheck      # TypeScript across all workspaces
npm test               # Node test suites across all workspaces
npm run test:swift     # Swift runtime + KV implementation tests
npm run acceptance     # full pipeline: compile → generate → build → conformance
npm run check          # typecheck + test + test:swift + acceptance
```
