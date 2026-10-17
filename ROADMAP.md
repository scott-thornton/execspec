# Roadmap

Principles that outrank any item below: keep the semantic surface
small, grow only additively, freeze digest lineage 1, every generated
byte deterministic, ADR before any semantics change, local gate then
`scripts/ship.sh`.

## v0.4 - adoption and hardening

The tool works; now it needs users and armor.

- **npm publication.** Publish `@execspec/*` packages so consumers run
  `npm install @execspec/cli` instead of cloning. Requires an npm
  scope/org decision, `files` and `publishConfig` per package, release
  provenance.
- **`execspec init`.** Scaffold a new specification package in one
  command: spec module, tsconfig, scripts, host stubs. Bootstrapping a
  contract should cost minutes, not a fork.
- **Fuzz every decoder.** Corpus-driven mutation harnesses on both
  targets: malformed input must always produce a coded failure, never a
  crash. The corpus grows alongside.
- **Differential wire testing.** The same bytes through the Swift and
  TypeScript codecs must yield identical accept/reject decisions and
  identical canonical output. Turns the two targets into each other's
  oracle.
- **Release automation.** GitHub Releases generated from tags, so
  `v0.x.0` always has notes.

## v0.5 - measured expressiveness

The one expansion the semantic model can absorb without host-language
leakage.

- **Declarative property scenarios.** `generate int64(min, max)`,
  `forall` over bindings, invariant expressions - all compiled to IR,
  never callbacks. Multiplies what conformance means while staying
  language-neutral.
- **Richer failure diagnostics.** Operation replay context and tighter
  diff presentation.

## v0.6 - ecosystem proof

The core claim - one spec, any language - meets a third ecosystem.

- **Third implementation target.** Candidates: Kotlin, Rust, Go.
  Decision by ADR before any code: it must expose assumptions Swift and
  TypeScript happen to share.
- **Linux host support.** Abstract the Swift runtime's POSIX I/O layer
  (Darwin vs Glibc) so hosts run beyond macOS; CI gains a Linux leg.
- **An independent canonicalizer.** A second implementation of
  canonical serialization, verified against the digest vectors -
  removing the last single-writer trust in the digest.

## Standing rules

Digest lineage 1 is frozen; `vectors/conformance.json` is append-only;
the compatibility policy (`docs/compatibility.md`) governs every bump;
`npm run check` gates everything; main is PR-gated.

## Explicitly not planned

Timestamps, durations, decimals, recursive types, sets, tuples,
refinements, streaming, callbacks, concurrency semantics, virtual
clocks, additional transports, IDE integration, watch mode. None of
these are missing work; each is a standing refusal until a real
contract demands it and an ADR is written.
