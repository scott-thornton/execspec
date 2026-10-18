# execspec

TypeScript authors a portable behavioral specification. The
specification compiles to a canonical, language-neutral semantic IR.
Swift, TypeScript, and Java targets are generated strictly from that IR.
A harness verifies any implementation as a black box over a
language-neutral process protocol.

> The specification owns the meaning. Implementation targets own
> nothing but code.

## What execspec is

An executable specification system with three capabilities no existing
tool combines:

- **Structural IDL** - types, operations, and their shapes (like
  Protobuf or OpenAPI).
- **Executable behavioral semantics** - declarative scenarios that pin
  exact expected outputs, plus differential probing that generates
  deterministic inputs and verifies all implementations agree (not
  just static annotations like Smithy traits).
- **Independent cross-language conformance** - black-box verification
  through a process protocol, one fresh host per scenario, with
  digest-matched identity preventing stale implementations from
  passing (Protobuf has conformance for serialization only; nobody
  has it for business logic).

## Architecture

```text
TypeScript DSL ──build──▶ AuthoringGraph
                              │ compile (validate, lower, normalize)
                              ▼
                        Semantic IR (canonical) ─── digest = SHA-256
                              │                          │
              ┌───────────────┼───────────────┐          │
              ▼               ▼               ▼          │
     generated Swift   generated Java   generated TS     │
     contract + impl   contract + impl  contract + impl  │
              │               │               │          │
     handwritten impl  handwritten impl  handwritten impl │
              │               │               │          │
              └───────┬───────┘───────┬───────┘          │
                      │   NDJSON protocol              │
                      ▼               ▼                  │
              scenario runner    differential probe      │
              (conformance)      (property-based)        │
                      │               │                  │
                      └───────┬───────┘                  │
                              ▼                          │
                    conformance evidence ◀───────────────┘
```

## Reference examples

Four domains, each implemented in multiple languages, all passing the
same scenarios:

| Example | Scenarios | Swift | TypeScript | Java |
|---------|-----------|-------|------------|------|
| KV store | 11 | 11/11 | 11/11 | 11/11 |
| Ordering | 15 | 15/15 | 15/15 | 15/15 |
| Menu pricing | 7 | 7/7 | 7/7 | 7/7 |
| Billing (proration) | 9 | 9/9 | 9/9 | 9/9 |

The billing example is the sharpest demonstration: integer proration
math (`credit = -(oldPrice * remaining / totalDays)` with floor
division on int64) must produce identical results in all three
languages, and the scenarios prove it does.

## Requirements

- macOS with a Swift 6 toolchain
- JDK 17+ (for the Java target)
- Node.js >= 24 and npm
- Bash for `scripts/acceptance.sh`

## Install

```bash
git clone https://github.com/scott-thornton/execspec.git
cd execspec
npm ci
npm run build
```

Or scaffold a new specification package:

```bash
node packages/cli/dist/index.js init --name my-contract --out ./my-contract
cd my-contract && npm install && npm test
```

## Quick start

### 1. Author a specification

```ts
import {
  specification, struct, union, string, unit, int64, ref,
  operation, scenario, literal, binding,
  structValue, stringValue, unionValue, unitValue, int64Value,
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

### 2. Compile to canonical IR

```bash
node packages/cli/dist/index.js compile \
  --module ./my-contract/dist/spec.js \
  --out ./build/contract.execspec.json
```

### 3. Generate implementation targets

```bash
# Swift
node packages/cli/dist/index.js generate swift \
  --ir ./build/contract.execspec.json --out ./swift-app/Sources/Generated

# TypeScript
node packages/cli/dist/index.js generate typescript \
  --ir ./build/contract.execspec.json --out ./server/src/Generated

# Java
node packages/cli/dist/index.js generate java \
  --ir ./build/contract.execspec.json --out ./java-app/src/com/execspec/generated
```

Each target gets four files: types, implementation protocol, wire
codecs, and a dispatcher - all deterministic, all derived from IR only.

### 4. Implement the generated contract

```swift
// Swift
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
}
```

```typescript
// TypeScript
export class KVStore implements KVSpecificationImplementation {
    private readonly values = new Map<string, string>();

    public kvPut(input: PutRequest): ExecSpecUnit {
        this.values.set(input.key, input.value);
        return undefined;
    }

    public kvGet(input: GetRequest): LookupResult {
        const value = this.values.get(input.key);
        return value === undefined ? { kind: "missing" } : { kind: "found", value };
    }
}
```

### 5. Run conformance

```bash
# Against any implementation
node packages/cli/dist/index.js test \
  --ir ./build/contract.execspec.json \
  --host ./swift-app/.build/debug/Host \
  --timeout-ms 5000
```

Every scenario runs in a fresh host process. Exit 0 only when all pass.

### 6. Check compatibility between versions

```bash
node packages/cli/dist/index.js compatible \
  --old ./build/v1.execspec.json \
  --new ./build/v2.execspec.json
```

### 7. Probe for divergence between implementations

```bash
node packages/cli/dist/index.js probe \
  --ir ./build/contract.execspec.json \
  --host ./swift-host \
  --host ./ts-host \
  --host ./java-host \
  --iterations 50
```

Generates deterministic inputs seeded by `(digest, operation,
iteration)`. Every implementation receives identical inputs without
coordination. Any disagreement is reported with the exact input that
exposed the divergence.

## What every verdict means

Every tool states exactly what it establishes and what it does not.
See `docs/verdicts.md` for the full normative definitions. The short
version:

- **PASS** - for these exact steps, the implementation produced
  semantically equal outputs. Not a proof of general correctness.
- **compatible: yes** - no breaking structural changes found. Not a
  proof of behavioral equivalence.
- **0 disagreements** - for the tested inputs, all implementations
  agreed. Not a proof of general agreement.
- **N failed** - N probes could not complete. Inability to verify is
  not evidence of agreement.

## Semantic guarantees

- int64 is full-range signed 64-bit end to end (wire form
  `{"$i64":"9223372036854775807"}`); JavaScript `number` is never used.
- float64 uses canonical ECMAScript shortest-round-trip spelling;
  `-0` equals `0`; NaN equals NaN.
- Strings compare by exact Unicode scalar sequence; no normalization.
- Structs/unions are nominal; struct field order is non-semantic; list
  order is semantic.
- Optional struct fields distinguish absent from rejected explicit
  `null`.
- Unknown fields, unknown cases, and malformed unions are rejected on
  the wire by every target.
- The digest covers the semantic IR only, domain-separated by
  semantic-model lineage; declaration order never changes it, scenario
  step order always does.
- Handshake checks protocol version and digest: a stale host fails
  before any operation is dispatched.
- Implementations cannot see scenario identity; only operation ID and
  input cross the process boundary.

## Generated-code contract

- Generated files are disposable build products; never edit them.
- Your implementation depends only on the generated public protocol
  and types.
- Regeneration is deterministic and idempotent: `git diff` after
  regeneration must be empty.
- A digest mismatch at handshake means stale generated code or a
  stale host build.

## Current limitations

Type system: `unit`, `boolean`, `int64`, `float64`, `string`, `bytes`,
optional struct fields, `list`, `map<string|int64, T>`, named structs,
enums, and tagged unions. No timestamps, sets, tuples, or recursive
types. Scenarios support `call` and `expectEqual` steps with
literal/binding/field expressions plus table-driven outlines.
Three implementation targets (Swift, TypeScript, Java). Sequential
requests per host. No callbacks, streaming, or reset.

## Documentation

- `docs/getting-started.md` - full walkthrough
- `docs/cli-reference.md` - every command, flag, and exit code
- `docs/verdicts.md` - what every verdict establishes and does not
- `docs/compatibility.md` - version-change policy and digest lineage
- `docs/semantic-model.md` - the normative value and equality rules
- `docs/ir-v1.md` - canonical IR specification
- `docs/protocol-v1.md` - process protocol specification
- `CONTRIBUTING.md` and `AGENTS.md` - how to change this repository
- `ROADMAP.md` - where this is going and where it deliberately is not

## Repository development commands

```bash
npm ci                 # install
npm run typecheck      # TypeScript across all workspaces
npm test               # Node test suites across all workspaces
npm run test:swift     # Swift test suites
npm run acceptance     # full pipeline: compile, generate, build, conformance
npm run check          # everything above
```

## License

MIT
