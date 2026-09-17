# execspec - agent guidance

Executable specification system: a TypeScript DSL authors types,
operations, and scenarios; compilation produces canonical Semantic IR
(SHA-256 digest); Swift and TypeScript targets are generated from the IR
only; a harness verifies any implementation as a black box over NDJSON.
The normative documents live in `docs/` - start with
`docs/specification.md`. Decisions affecting semantics, IR, protocol, or
public APIs require an ADR-style section in the relevant doc before
implementation.

## The gate

`npm run check` must exit 0 from a clean `npm ci`. It runs typecheck,
every Node test suite, every Swift test suite, and the full acceptance
pipeline (`scripts/acceptance.sh`). CI (`.github/workflows/ci.yml`)
runs exactly this on a macOS runner.

## Rules that must not erode

- Generators consume IR only: `@execspec/swift-generator` and
  `@execspec/ts-generator` depend on `@execspec/core` and nothing else -
  never on the DSL or compiler.
- The harness (`@execspec/harness`) depends on `@execspec/core` only and
  executes Scenario IR, never authoring code.
- Generated sources under `examples/*/` are committed. After any
  generator change, regenerate every target directory and require an
  empty `git diff` - byte-identical regeneration is a contract.
- Domain failures are union values in operation outputs; exceptions are
  for genuine defects.
- Determinism is a contract: identical IR always produces identical
  bytes (canonical IR JSON, digests, generated sources).

## Map

`packages/core` semantic model + IR + digest · `packages/dsl` authoring ·
`packages/compiler` validation and normalization · `packages/swift-generator`
and `packages/ts-generator` targets · `packages/harness` conformance
runner · `packages/cli` commands · `targets/swift-runtime` the process
protocol runtime · `examples/kv-*` and `examples/orders-*` dual-language
reference pairs (same spec, Swift and TypeScript implementations, same
verdicts).
