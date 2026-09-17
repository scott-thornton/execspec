# Autonomous execution loop

This document defines how an executing agent implements the execspec v0.1
plan. It is normative for agent behavior, not for the product.

## 1. Per-task loop

```text
read task → inspect existing interfaces → write/modify test first →
run focused test → confirm expected failure → write minimum implementation →
run focused test → run package test suite → run repository gate →
review diff → update docs/implementation-status.md → commit → next task
```

Never implement production code before observing the intended failing
test, except for pure documentation/bootstrap tasks with no executable
behavior.

## 2. Failure loop

1. Preserve the failure output.
2. Form exactly one explicit hypothesis.
3. Test it with the smallest diagnostic command.
4. Fix only the identified cause.
5. Re-run the failing focused test, then the package gate.

After three failed hypotheses on the same defect, switch to systematic
debugging. Never shotgun-edit multiple unrelated areas.

## 3. Decision hierarchy for unforeseen details

1. Preserve the defined semantic behavior.
2. Preserve target-language independence.
3. Preserve deterministic output.
4. Prefer rejecting ambiguous input to coercing it.
5. Prefer a smaller semantic surface.
6. Prefer explicit generated code to runtime reflection.
7. Prefer standard-library implementation to adding a dependency.
8. Prefer compile-time validation to runtime failure.
9. Prefer process isolation to lifecycle complexity.
10. Prefer a local implementation detail to a new public abstraction.

Decisions affecting observable semantics, IR shape, protocol shape, or a
public API require an ADR-style section in the relevant normative doc
**before** implementation.

## 4. Commit policy

One task = one commit. Prefixes: `build:`, `feat(core):`, `feat(dsl):`,
`feat(compiler):`, `feat(swift):`, `feat(harness):`, `feat(cli):`,
`test:`, `docs:`. No WIP commits.

## 5. Completion protocol

When all tasks appear complete: run `npm run check`; clean-rebuild
(`git clean -fdX`, `npm ci`, `npm run check`); regenerate and require
`git diff --exit-code`; run the architecture audits (generator depends on
core only; harness depends on core only; no Swift knowledge above the
target layer; no scenario identity crosses the process boundary); audit
plan coverage; audit for placeholder markers; audit `git status` and log;
then produce the final report (architecture, test counts, acceptance
result, layout, deferred scope, deviations with evidence).
