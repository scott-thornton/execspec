# Implementation status

This file records the execution log of the v0.1 implementation plan.
One entry per plan task, appended after the task's gate passes.

## Environment observations (2026-09-17)

- Node.js v25.3.0 installed (plan baseline: Node 24 LTS). v25 is a
  superset of the 24 line for every API used; recorded as an
  environment deviation, not a plan change.
- Swift 6.2.3 installed (plan baseline: Swift 6.4, released 2026-09-15).
  Swift 6.2.3 fully supports the Swift 6 language mode required by the
  plan. Recorded as an environment deviation, not a plan change.
- TypeScript 7.0.2 available on the npm registry (`dist-tags.latest`).
- Initial full test suite run: repository is empty; no test suite
  exists yet. This bootstrap entry is the recorded initial state.

## Task log
- Task 1: bootstrap complete. Gate `npm ci && npm run typecheck && npm test` exits 0 (1 test). Deviation: `node --test <dir>` is rejected by Node 25; test scripts use the explicit glob `dist-test/test/*.test.js` instead. Toolchain deltas recorded above.
- Task 2: normative docs created (specification, semantic-model, ir-v1, protocol-v1, autonomous-loop) + docs existence/header test in cli. Green.
- Task 3: identifier validation (ids.ts) with grammar tests. Green (8 tests).
- Task 4: semantic type AST (types.ts) with factories and structural guards. Green (12 tests).
- Task 5: canonical semantic value model (semantic-value.ts): discriminated values, int64 bigint range, surrogate-free strings, nominal structs/unions. Green.
- Task 6: value validation against semantic types (validate-value.ts): typed paths, nominal identity, optional/unknown fields, union payload rules, int64 range. Green.
(amend: final green 27/27)
- Task 7: portable semantic equality (equality.ts): diff paths, nominal identity, order rules. Green (35 tests).
- Task 8: Semantic IR v1 types (ir.ts) per docs/ir-v1.md. Green (38 tests).
- Task 9: IR validation + static expression typing (validate-ir.ts): duplicates, unknown refs, cycles, optional-unit, zero-op/zero-scenario/zero-step, forward/duplicate bindings, field traversal, literal deep validation, expectEqual type checks. Green (52 tests).
- Task 10: canonical JSON (canonical-json.ts): code-point key sorting, stable arrays, standard escaping, safe-integer numbers only. Green (59 tests).
- Task 11: semantic-value JSON codec (semantic-value-json.ts): type-directed decode with issue paths, validated encode, full-width int64 wire, null/unknown-field/union-shape rejections. Green.
- Task 12: deterministic IR serialization + SHA-256 digest + strict document decoder (digest.ts). ADR added to docs/ir-v1.md: literals require static type contexts (no both-literal expectEqual, no literal field bases) so wire-form literal decoding is total. Green (75 tests).
- Tasks 13-17: DSL (specification/type/operation/scenario builders, expressions) + compiler (validate-authoring, normalize, compileSpecification) complete. dsl 13 tests, compiler 7 tests green.
- Tasks 18-21: Swift runtime complete (JSONValue + strict parser ADR, NDJSON with 16MiB LineAssembler, protocol messages, host loop). swift test: 26/26 green. Deviation recorded: hand-written JSON parser replaces Foundation JSONSerialization (exact numeric spellings + duplicate-key rejection are protocol requirements Foundation cannot meet).
- Tasks 22-27: Swift generator complete (identifiers + keyword escaping, types, implementation protocol, codecs with structural helpers, dispatcher, generateSwift API). 12/12 tests green; generation deterministic and order-insensitive.
- Tasks 28-33: harness complete (protocol codec, 16MiB line reader, host process with bounded stderr + timeouts + crash typing, evaluator, runner with fresh host per scenario, no-color reporter). 25/25 tests green including crash/timeout/garbage/stale-digest/stderr/shutdown fixtures.
