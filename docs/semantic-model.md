# Semantic Model - Version 1

This document is normative for execspec v0.1. It defines the type system,
the value model, portable equality, and the wire (JSON) representation of
semantic values.

## 1. Type system

### 1.1 Value types

```text
ValueType      := Primitive | TypeRef | ListType | MapType
Primitive      := unit | boolean | int64 | float64 | string | bytes
TypeRef        := ref(TypeId)
ListType       := list(ValueType)
MapType        := map(KeyType, ValueType)
KeyType        := string | int64        (v0.2 restriction)
```

### 1.2 Named declarations

- **Struct**: ordered set of fields `{ name, type: ValueType, optional: boolean }`.
  Field names are unique within the struct. `optional` marks field
  presence semantics (§3.3). An optional field whose type is `unit` is
  invalid (redundant and ambiguous).
- **Enum**: a set of case names (lower camel case), unique within the enum.
- **Union**: a set of cases `{ name, payload: ValueType }`, unique within
  the union. A case with payload `unit` is a *unit-payload case*.

Declarations are **nominal**: two structs with identical fields but
different type IDs are different types.

### 1.3 Restrictions (v0.1)

- `optional` appears only on struct fields - never at top level, in lists,
  as a union payload, or nested beneath another optional.
- Anonymous composite declarations are prohibited.
- No recursive types (the type graph must be acyclic; a declaration may
  only reference declarations, and self/mutual reference is rejected by
  cycle detection over declaration references).
- Operations refer only to named types or `unit`-kind value types
  (primitives, lists of value types, and type refs are legal operation
  input/output types).

## 2. Value model

A semantic value is one of:

| Kind      | Payload                                        |
| --------- | ---------------------------------------------- |
| `unit`    | -                                             |
| `boolean` | `true` / `false`                               |
| `int64`   | signed two's-complement integer, −2^63 .. 2^63−1 |
| `string`  | exact sequence of Unicode scalar values        |
| `list`    | ordered sequence of semantic values            |
| `float64` | IEEE 754 double (see §3.1 ADR)                 |
| `bytes`   | exact byte sequence                            |
| `map`     | string/int64 keys → semantic values, unordered |
| `struct`  | nominal type ID + field name → value map       |
| `enum`    | nominal type ID + case name                    |
| `union`   | nominal type ID + case name + optional payload |

Representations:

- int64 is represented as `bigint` in TypeScript runtime code and never as
  JavaScript `number`.
- A string is a valid Unicode string: it may not contain unpaired
  surrogate code points. No Unicode normalization is ever performed.

## 3. Wire representation

The wire representation is JSON, governed by protocol v1 and by generated
codecs. It is identical on every target.

### 3.1 Primitives

```text
unit     → {}                                    (empty JSON object)
boolean  → true | false
int64    → {"$i64":"<canonical decimal>"}        (tagged string)
float64  → {"$f64":"<canonical spelling>"}       (tagged string)
string   → "<exact JSON string>"
bytes    → {"$b64":"<canonical padded base64>"}  (tagged string)
```

Canonical int64 decimal spelling:

- optional leading `-` for negative numbers only; no leading `+`
- no leading zero except the bare `"0"`; `"-0"` is prohibited

Therefore 9223372036854775807 and -9223372036854775808 both survive every
transport without precision loss.

#### ADR: canonical float64 spelling (v0.2)

The canonical spelling of a double is exactly what ECMAScript
`Number.prototype.toString()` produces: the shortest round-trip decimal,
plain decimal notation for 1e-6 ≤ |x| < 1e21, exponent notation
otherwise, and the literals `"NaN"`, `"Infinity"`, `"-Infinity"`.
Consequences: `-0` canonicalizes to `"0"`, so −0 ≡ +0 under portable
equality; NaN is a value, so NaN ≡ NaN. The Swift runtime implements the
same algorithm (`ExecSpecFloat64`), so every target emits identical
bytes; decoding rejects any spelling that is not already canonical.

#### bytes

Standard base64 (RFC 4648 §4, with padding). Decoding rejects
unpadded, over-padded, whitespace-bearing, and URL-safe spellings by
re-encoding and comparing.

#### maps

A map value is a JSON object whose keys are the encoded keys: string
keys are themselves; int64 keys are canonical decimal spellings. Key
types are restricted to `string` and `int64` so wire keys stay
canonical. Map equality is order-insensitive; canonical IR
serialization sorts encoded keys by Unicode code point.

### 3.2 Lists

JSON arrays. Ordering is semantic. Equality is element-by-element and
order-sensitive.

### 3.3 Structs

A struct value is a JSON object:

- Required fields must be present exactly once.
- Optional fields may be **absent**; presence carries meaning.
- Explicit JSON `null` for any field is invalid (an absent optional is
  valid; `null` never is).
- Unknown fields are rejected in protocol v1.
- Object key order is semantically irrelevant.

### 3.4 Enums

A JSON string equal to the semantic case name. Unknown cases are rejected.

### 3.5 Tagged unions

```json
{ "$case": "found", "value": "abc" }
```

- `$case` is mandatory.
- `value` is mandatory for non-unit payloads.
- `value` is prohibited for unit-payload cases.
- Additional keys are prohibited. Shape inference is never used.

## 4. Portable semantic equality

Equality is defined between two semantic values as follows:

- Kinds must match.
- `unit` equals `unit` only.
- Booleans, strings (exact scalar sequence), and int64s (exact numeric
  equality) compare by value.
- Lists compare element-by-element, order-sensitively, same length.
- Structs: nominal type IDs must be equal; then field sets must be equal;
  then each field value compares recursively. Field order is irrelevant.
- Enums: type IDs and case names must be equal.
- Unions: type IDs and case names must be equal; then payloads compare
  recursively (a present payload never equals an absent one).

Differences are reported as a list of `{ path, expected, actual }` using
JSONPath-like paths:

```text
$.user.name
$.items[2]
$.value              (union payload pseudo-field)
```

## 5. Validation

A semantic value is validated against an expected `ValueType` in a type
environment (the set of named declarations). Validation reports issues
with paths; it never throws for ordinary mismatches. It must detect:

- wrong primitive kind; out-of-range int64 at unsafe boundaries
- wrong nominal struct/enum/union type
- missing required field; unknown struct field; invalid enum/union case
- unit-payload mismatch; list element mismatch; unknown type reference
- optional field absence (accepted) vs explicit `null` (rejected)
