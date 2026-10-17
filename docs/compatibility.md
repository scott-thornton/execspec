# Compatibility policy - Version: Compatibility Policy 1

What may change, and what must be bumped, when execspec changes. The
guiding rule: **a digest, an IR document, or a protocol transcript that
was valid yesterday must mean the same thing tomorrow, or carry a new
version.**

## The three version axes

| Axis | Carried by | Governs |
| ---- | ---------- | ------- |
| Semantic-model lineage | digest domain prefix (`execspec-semantic-1`) | the meaning of canonical semantic bytes: equality, optionality, canonical spellings, encodings |
| IR version | `irVersion` in every `.execspec.json` | the structure of the IR document that readers parse |
| Protocol version | `protocolVersion` in every message | the transport grammar and lifecycle between harness and hosts |

Package semver follows: while packages are `0.x`, any change requiring a
lineage or version bump also bumps the package minor version.

## When each axis must change

**Semantic-model lineage must bump** (for example to
`execspec-semantic-2`, which changes every digest) when any existing
canonical bytes or their meaning would change: an equality rule for an
existing kind, a canonical spelling rule, a wire encoding, a
normalization rule, or the digest algorithm itself. Once external users
persist digests, a lineage bump is a hard migration - so semantic rules
are frozen within a lineage.

**IR version must bump** when the document structure changes
incompatibly for readers: renaming or removing fields, or changing what
an existing field means. Purely additive vocabulary (new type kinds or
step kinds) does not bump the IR version, because readers fail closed:
unknown kinds are rejected with a diagnostic, never silently
reinterpreted. Precedent: v0.2 added `float64`, `bytes`, and `map`
kinds under `irVersion: 1`.

**Protocol version must bump** when the message grammar or lifecycle
changes incompatibly. Additive field values may land without a bump,
with the same fail-closed expectation. Known wrinkle, recorded here:
v0.2 widened the `helloAck` target set from `swift` to
`swift | typescript` under `protocolVersion: 1`; a v0.1 harness rejects
the new value at handshake (loudly, before any operation). Future
target additions follow the same pattern.

## Digest domain separation

```text
digest = sha256_hex( "execspec-semantic-1" + 0x00 + canonicalSemanticBytes )
```

The prefix guarantees a digest can never alias meaning across model
lineages: identical bytes under different semantics produce different
digests. Handshakes need no separate model-version field because the
digest carries lineage identity.

## Conformance vectors

`vectors/conformance.json` is the language-neutral normative corpus:
canonical and non-canonical spellings, wire forms, parser inputs, and
digest vectors. Consumers must read the raw file - not share an
implementation - so targets verify against data, not against each
other's code. The corpus only grows; entries are never edited or
removed (corrections append superseding entries).

## Adding anything: the bar

Every new type kind or step kind costs DSL, compiler, IR, validation,
equality, canonical serialization, wire codec, every generator, every
runtime, harness, diagnostics, vectors, and docs. Prefer rejecting
ambiguous input to coercing it; prefer a smaller semantic surface; and
never leak the wire model into a target's public API beyond what
observable semantics require.
