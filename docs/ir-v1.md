# Semantic IR — IR Version: 1

This document is normative for execspec v0.1. It defines the exact
TypeScript interfaces, the JSON encoding, canonical serialization, and the
specification digest. `irVersion` is the integer `1`.

## 1. Interfaces

```ts
export interface OperationIR {
  readonly id: OperationId;
  readonly input: ValueType;
  readonly output: ValueType;
}

export type LiteralExpressionIR = {
  readonly kind: "literal";
  readonly value: SemanticValue;
};

export type BindingExpressionIR = {
  readonly kind: "binding";
  readonly binding: string;
};

export type FieldExpressionIR = {
  readonly kind: "field";
  readonly base: ValueExpressionIR;
  readonly field: string;
};

export type ValueExpressionIR =
  | LiteralExpressionIR
  | BindingExpressionIR
  | FieldExpressionIR;

export interface CallStepIR {
  readonly kind: "call";
  readonly binding: string;
  readonly operationId: OperationId;
  readonly input: ValueExpressionIR;
}

export interface ExpectEqualStepIR {
  readonly kind: "expectEqual";
  readonly actual: ValueExpressionIR;
  readonly expected: ValueExpressionIR;
}

export type ScenarioStepIR = CallStepIR | ExpectEqualStepIR;

export interface ScenarioIR {
  readonly id: ScenarioId;
  readonly description: string;
  readonly steps: readonly ScenarioStepIR[];
}

export interface SemanticIR {
  readonly specificationName: string;
  readonly specificationVersion: string;
  readonly types: readonly TypeDeclaration[];
  readonly operations: readonly OperationIR[];
  readonly scenarios: readonly ScenarioIR[];
}

export interface SourceLocation {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

export interface IRMetadata {
  readonly sourceLocations: Readonly<Record<string, SourceLocation>>;
}

export interface SemanticIRDocument {
  readonly format: "execspec";
  readonly irVersion: 1;
  readonly semantic: SemanticIR;
  readonly metadata: IRMetadata;
}
```

No additional fields in v1. In v0.1 the TypeScript DSL produces no source
locations, so `sourceLocations` is the empty record; source locations, if
ever populated, are repository-relative POSIX-style paths and never
contribute to the digest.

Binding names inside a scenario match the member-name grammar and are
unique within the scenario. A binding expression may only refer to a
binding created by an earlier `call` step.

## 2. JSON encoding

### 2.1 Value types

```json
{ "kind": "unit" }
{ "kind": "boolean" }
{ "kind": "int64" }
{ "kind": "string" }
{ "kind": "ref", "typeId": "PutRequest" }
{ "kind": "list", "element": { "kind": "string" } }
```

### 2.2 Type declarations

```json
{
  "kind": "struct",
  "id": "PutRequest",
  "fields": [
    { "name": "key", "type": { "kind": "string" } },
    { "name": "value", "type": { "kind": "string" }, "optional": true }
  ]
}
{ "kind": "enum", "id": "SortOrder", "cases": ["ascending", "descending"] }
{
  "kind": "union",
  "id": "GetResult",
  "cases": [
    { "name": "found", "payload": { "kind": "string" } },
    { "name": "missing", "payload": { "kind": "unit" } }
  ]
}
```

`"optional": true` is present only on optional fields; it is omitted
otherwise.

### 2.3 Semantic values (in literal expressions)

Exactly the wire representation of `docs/semantic-model.md`:

```json
{}
true
{ "$i64": "42" }
"abc"
[1, 2]                       (elements encoded recursively)
{ "key": "a", "value": "one" }
"missing"                    (enum)
{ "$case": "found", "value": "one" }
```

### 2.4 Steps

```json
{ "kind": "call", "binding": "put", "operationId": "kv.put",
  "input": { "kind": "literal", "value": { "key": "a" } } }
{ "kind": "expectEqual",
  "actual": { "kind": "binding", "binding": "get" },
  "expected": { "kind": "literal", "value": { "$case": "found", "value": "one" } } }
{ "kind": "field", "base": { "kind": "binding", "binding": "get" }, "field": "value" }
```

## 3. Canonical serialization

Canonical IR JSON:

1. UTF-8, no BOM, no insignificant whitespace.
2. Object keys sorted lexicographically by Unicode code point (recursive,
   explicit key sorting — never object insertion order).
3. Arrays remain in semantic canonical order.
4. Declaration arrays are sorted: types by `id`, operations by `id`,
   scenarios by `id`.
5. Within declarations: struct fields sort by field name, enum cases sort
   lexicographically, union cases sort by case name.
6. Scenario steps preserve declared execution order (step order is
   semantic).
7. JSON strings use standard JSON escaping (short escapes for `"` `\` and
   the C0 controls `\b \f \n \r \t`, `\u00XX` otherwise; non-ASCII
   characters are emitted raw, never escaped).
8. Canonical bytes end with no trailing newline. Written `.json` files
   append exactly one trailing LF. The digest is computed over the
   non-newline canonical bytes.

## 4. Specification digest

The digest is lowercase hex SHA-256 over the canonical serialization of
the `semantic` subtree only:

```text
digest = sha256_hex( canonical_bytes( semanticIRToJSON(ir.semantic) ) )
```

`format`, `irVersion`, and `metadata` never contribute. Consequently,
semantically equivalent specifications that differ only in declaration
insertion order produce identical digests, while any change to scenario
step order changes the digest.

## 5. Static expression typing

The compiler statically infers the type of every value expression:

- `literal` — the nominal/primitive type carried by the value.
- `binding` — the output type of the bound call.
- `field` — on a struct base, the field's declared type; on a union base,
  the reserved pseudo-field `value` is legal only when every non-unit
  payload case of the union shares one identical payload type (the common
  type is the inferred type); mixed payload types are rejected as
  ambiguous.

`call` input expressions must be type-compatible with the operation input
(literal inputs are validated value-wise against the input type).
`expectEqual` sides must be type-compatible. Incompatible specifications
fail to compile before any target code is generated.

### ADR: literal type contexts (v0.1)

Literal values serialize to IR JSON in wire form, which is only decodable
with a known expected type (a bare `{}` is unit-or-empty-struct; a bare
string is string-or-enum). To keep IR decoding total and deterministic,
v0.1 requires every literal to have a static type context:

1. An `expectEqual` step must not have literal expressions on **both**
   sides (a constant-versus-constant expectation is vacuous anyway). The
   literal side is decoded against the inferred type of the other side.
2. The base of a `field` expression must be a `binding` or `field`
   expression, never a literal.

Both restrictions are enforced by IR validation and by the compiler.
