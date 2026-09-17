# CLI reference

Until the packages are published to npm, the CLI runs from a clone as
`node packages/cli/dist/index.js <command>` (after `npm run build`).
Below it is written as `execspec` for brevity.

Exit codes are shared by every command: `0` success, `1` validation or
conformance failure, `2` usage error (unknown command or bad flags).

## execspec compile

```bash
execspec compile --module <spec.js> --out <file.execspec.json>
```

| Flag | Required | Meaning |
| ---- | -------- | ------- |
| `--module` | yes | Path to a compiled ESM module whose default export is an `AuthoringGraph` built by `@execspec/dsl`. Raw `.ts` files are not loaded; build the spec module first. |
| `--out` | yes | Output path for the canonical IR document (one JSON line plus a trailing newline). Parent directories are created. |

On success the digest is printed to stdout. Recompiling a semantically
identical specification is byte-identical; declaration order never
changes the digest, scenario step order always does.

## execspec generate swift

```bash
execspec generate swift --ir <file.execspec.json> --out <directory>
```

## execspec generate typescript

```bash
execspec generate typescript --ir <file.execspec.json> --out <directory>
```

| Flag | Required | Meaning |
| ---- | -------- | ------- |
| `--ir` | yes | Path to a canonical IR document produced by `compile`. It is strictly parsed and validated before generation. |
| `--out` | yes | Target directory. It is replaced atomically: files are generated to a staging directory first, so a failed run never leaves a half-generated tree. |

Both commands emit exactly four files: `ExecSpecTypes`,
`ExecSpecImplementation`, `ExecSpecCodecs`, and `ExecSpecDispatcher` (in
the target's language). Every file carries a "do not edit" header. The
specification digest is recomputed from the IR and embedded in the
dispatcher as a constant. Generation is deterministic: identical IR
produces byte-identical output.

## execspec test

```bash
execspec test --ir <file.execspec.json> --host <executable> [options]
```

| Flag | Required | Meaning |
| ---- | -------- | ------- |
| `--ir` | yes | Path to the canonical IR document. |
| `--host` | yes | Executable path for the implementation host. It is spawned fresh for every scenario; stdout must be protocol-only. |
| `--timeout-ms` | no | Per-operation timeout in milliseconds (default 5000). The handshake read uses the same budget. |
| `--scenario` | no | Substring filter on scenario ids; only matching scenarios run. |
| `--concurrency` | no | Run scenarios in parallel with this many slots (default 1, sequential). Safe because every scenario gets its own host process. |

The command prints one `PASS`/`FAIL` line per scenario in canonical id
order (no colors), structural diff paths for expectation failures, and
a final `N passed, M failed` summary. Exit code is `0` only when every
selected scenario passes.
