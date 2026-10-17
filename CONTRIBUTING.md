# Contributing

Start with `AGENTS.md` for the architecture map and the rules that must
not erode. The short version:

- `npm run check` is the gate. It must exit 0 from a clean `npm ci`
  before any change lands; CI runs exactly this.
- Generators consume IR only. `@execspec/swift-generator` and
  `@execspec/ts-generator` depend on `@execspec/core` and nothing else;
  `@execspec/harness` likewise. If a change tempts you to import the
  DSL or compiler from those packages, the design is being eroded.
- Generated sources under `examples/` are committed. After changing a
  generator, regenerate every target directory and require an empty
  `git diff`.
- Semantics changes (values, wire forms, IR shape, protocol, public
  APIs) need an ADR-style section in the relevant `docs/` file first.
  Determinism is a contract: identical IR must always produce identical
  bytes.
- One logical change per commit. Prefixes: `feat:`, `fix:`, `docs:`,
  `build:`, `test:`, optionally scoped like `feat(harness):`.
- `main` is PR-gated: required `check` CI plus linear history. Ship with
  `scripts/ship.sh` from a branch - it pushes, opens the PR, waits for
  green, rebase-merges, and cleans up (pass `--squash` for messy
  branches). The local gate (`npm run check`) before pushing is still
  the first line of defense; the required check is the second.

New type kinds, scenario step kinds, or targets are additive work -
prefer rejecting ambiguous input over coercing it, and prefer a smaller
semantic surface over a more flexible one.
