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
- Tasks 34-37: CLI complete (parser exit codes, compile, generate swift with atomic dir replacement, test). 10/10 cli tests green incl. spawned-binary smoke test.
- Tasks 38-41: KV example complete. 10/10 scenarios pass end-to-end against the Swift host; deliberately broken host fails kv.put.overwrite at $.value (expected "second", actual "first") and exits nonzero. Deviation recorded: Swift transport switched from NSFileHandle to POSIX read/write — Node 25 spawns children with socketpair stdio on which NSFileHandle stalls (evidence: lsof shows fd 0 as unix socket; host unresponsive only under Node driver; pipeline driver worked).
- Tasks 42-46: acceptance.sh green (byte-identical recompilation and regeneration, broken impl fails at exact path, stale spec fails digest handshake with zero dispatch, isolation scenarios pass). Protocol robustness fixtures cover id mismatch, invalid semantic output, version mismatch; 26/26 harness tests.
- Tasks 47-48: README (capabilities that actually work, complete KV flow, semantic guarantees, generated-code contract).
- Task 49: dependency audit — 0 third-party JavaScript runtime dependencies (workspace links only); 0 external Swift package dependencies.
- Task 50: determinism audit — 10× compile+generate: 1 unique IR hash, 1 unique generated-tree hash; declaration reorder → identical digest; valid step reorder (kv.put.overwrite put swap) → different digest.
- Task 51: path audit — no absolute paths in generated Swift, IR, or digest inputs.
- Task 52: clean-checkout acceptance — rm node_modules/dist/dist-test/build → npm ci → npm run check exits 0. Regeneration leaves committed generated sources byte-identical. Root typecheck builds first (workspace d.ts ordering), recorded as build-script fix.

Completion protocol: architecture audits pass (no Swift knowledge below the target layer; swift-generator and harness depend on @execspec/core only; no scenario identity in the protocol codec). Placeholder scan: only false positives ("TODOList" test string; SwiftPM .build artifacts, which are gitignored build products).
- Post-v0.1 extension 1: float64 (canonical ECMAScript spelling, NaN/Inf/-0 rules), bytes (canonical padded base64), map<string|int64, T> (encoded-key wire objects) across core/DSL/Swift runtime/generator. KV spec gains kv.echo-types + kv.types-wire-proof; 11/11 conformance green. DSL also gains plain-value literal sugar and scenario outlines.
- Post-v0.1 extension 2: runner practicality — `--scenario` substring filter and `--concurrency` parallel execution (process isolation makes parallelism safe; 11 scenarios run in ~0.1s wall at concurrency 4).
- Post-v0.1 extension 3: TypeScript implementation target. New @execspec/ts-generator (types/protocol/codecs/dispatcher emitters plus a strict-JSON NDJSON host runtime mirroring the Swift runtime, including the same float64 spelling via shared core helpers). `execspec generate typescript` command; examples/kv-ts implements the same KV contract; the SAME 11-scenario suite passes against both the Swift and TypeScript hosts. Harness now accepts target "swift" | "typescript". Acceptance covers both hosts and byte-identical regeneration for both targets. Versions bumped to 0.2.0.
- Post-v0.2 example: the ordering domain (examples/orders-spec) — a realistic cart/promo/checkout contract with exact minor-unit money math, 15 scenarios (incl. an outline-driven multi-currency totals pair and domain failures as union values). Implemented in BOTH targets; 15/15 on Swift and 15/15 on TypeScript from the one spec. Authoring note: the compiler's static literal validation caught three genuine spec-authoring mistakes (string-vs-enum, struct-vs-union wrappers, missing required field) before any target ran — the system working as designed on its own author.
