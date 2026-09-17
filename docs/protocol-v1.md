# Process Protocol — Protocol Version: 1

This document is normative for execspec v0.1. `protocolVersion` is the
integer `1`.

## 1. Transport

- NDJSON over the child process's stdin/stdout: exactly one UTF-8 JSON
  message per line, terminated by `\n` (`\r\n` tolerated on read).
- Maximum line length is 16 MiB. Longer lines are protocol failures.
- stdout is protocol-only. Diagnostics are plain text on stderr and never
  interleave with protocol output.
- Invalid UTF-8 and malformed JSON are protocol failures.
- No sockets, HTTP, FFI, or multiplexing in v1.

ADR (v0.1, Swift runtime): the plan suggested Foundation's JSON
facilities for parsing, but `JSONSerialization` cannot preserve exact
numeric spellings or reject duplicate object keys — both required by
this protocol. The Swift runtime therefore ships a strict hand-written
JSON parser/serializer with those guarantees; Foundation remains in use
for process I/O. Observable wire behavior is unchanged (and stricter).

## 2. Process lifecycle

A scenario gets its own host process:

```text
spawn → handshake → execute scenario steps → close stdin → clean exit
```

If the host remains alive more than 1 second after stdin is closed, the
harness terminates it and reports a host shutdown failure. A host exits
zero on clean EOF. There is no reset operation in v1.

## 3. Handshake

Harness → host (first line the host reads):

```json
{ "kind": "hello", "protocolVersion": 1, "specificationDigest": "<64 hex>" }
```

Host → harness (first line the host writes):

```json
{ "kind": "helloAck", "protocolVersion": 1,
  "specificationDigest": "<64 hex>", "target": "swift" }
```

Rules:

- The host MUST reject any non-`hello` first message.
- Protocol version mismatch: the host exits nonzero without dispatching.
- Specification digest mismatch: the host exits nonzero without
  dispatching any operation. This is the staleness barrier.
- The harness verifies `protocolVersion`, `specificationDigest`, and
  `target` (`"swift"` is the only v1 target) in `helloAck`.

## 4. Requests and responses

Harness → host:

```json
{ "kind": "request", "id": "1", "operation": "kv.get", "input": { "key": "a" } }
```

Host → harness (success):

```json
{ "kind": "response", "id": "1", "output": { "$case": "missing" } }
```

Host → harness (failure):

```json
{ "kind": "failure", "id": "1", "category": "implementationException",
  "message": "..." }
```

Rules:

- Request IDs are decimal strings generated monotonically per scenario,
  starting at `"1"`. Every response/failure echoes the request ID exactly.
  A mismatched ID is a protocol failure.
- `input`/`output` are wire-encoded semantic values
  (`docs/semantic-model.md` §3).
- Requests are processed sequentially in v1.
- Messages carry exactly the keys shown; unknown `kind` values, missing
  fields, wrong field types, and additional fields are rejected by both
  sides.

### Failure categories

```text
implementationException   the implementation threw
invalidRequest            unknown operation or undecodable input
protocolViolation         malformed protocol input
```

Harness-side process crashes, timeouts, digest mismatches, and invalid
outputs are harness failure classes; they are never host `failure`
messages and never domain values.

## 5. Host failure mapping

- Unknown operation → `failure` `invalidRequest`.
- Input decode failure → `failure` `invalidRequest` (codec failures are
  request failures, never domain outputs).
- Implementation `throws` → `failure` `implementationException`.
- Malformed request line → `failure` `protocolViolation` with empty `id`,
  then continue reading.

## 6. Timeouts

The harness enforces a per-operation timeout (default 5000 ms,
CLI-configurable). On timeout the host is killed and the scenario fails
with an operation timeout failure. The handshake read uses the same
timeout budget.
