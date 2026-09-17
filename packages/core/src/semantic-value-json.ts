/**
 * Type-directed JSON codec for semantic values
 * (docs/semantic-model.md §3). Encoding is unambiguous structurally;
 * decoding requires the expected type because struct and enum values
 * are nominal.
 */

import type { JSONValue } from "./canonical-json.js";
import type { ValueType } from "./types.js";
import type { SemanticValue } from "./semantic-value.js";
import {
  int64Value,
  float64Value,
  bytesValue,
  mapValue,
  listValue,
  booleanValue,
  stringValue,
  structValue,
  enumValue,
  unionValue,
  unitValue,
  INT64_MAX,
  INT64_MIN,
} from "./semantic-value.js";
import { validateValue } from "./validate-value.js";
import { canonicalFloat64Spelling, isCanonicalFloat64Spelling, parseFloat64Spelling } from "./float64.js";
import type { TypeEnvironment, ValidationIssue } from "./validate-value.js";
import type { TypeId } from "./ids.js";

export type DecodeResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

const INT64_SPELLING = /^-?(0|[1-9][0-9]*)$/;

/** Untyped wire encoding; assumes the value is valid for its own sake. */
export function semanticValueToJSON(value: SemanticValue): JSONValue {
  switch (value.kind) {
    case "unit":
      return {};
    case "boolean":
      return value.value;
    case "int64":
      return { $i64: value.value.toString(10) };
    case "float64":
      return { $f64: canonicalFloat64Spelling(value.value) };
    case "string":
      return value.value;
    case "bytes":
      return { $b64: Buffer.from(value.value).toString("base64") };
    case "list":
      return value.values.map((element) => semanticValueToJSON(element));
    case "map": {
      const object: { [key: string]: JSONValue } = {};
      for (const [key, entry] of value.entries) {
        const encodedKey = typeof key === "bigint" ? key.toString(10) : key;
        object[encodedKey] = semanticValueToJSON(entry);
      }
      return object;
    }
    case "struct": {
      const object: { [key: string]: JSONValue } = {};
      for (const [name, field] of value.fields) {
        object[name] = semanticValueToJSON(field);
      }
      return object;
    }
    case "enum":
      return value.case;
    case "union": {
      const object: { [key: string]: JSONValue } = { $case: value.case };
      if (value.value !== undefined) {
        object.value = semanticValueToJSON(value.value);
      }
      return object;
    }
  }
}

export function encodeSemanticValue(
  value: SemanticValue,
  expectedType: ValueType,
  environment: TypeEnvironment,
): JSONValue {
  const issues = validateValue(value, expectedType, environment);
  if (issues.length > 0) {
    const first = issues[0];
    throw new Error(
      `cannot encode semantically invalid value: ${first?.code} at ${first?.path}`,
    );
  }
  return semanticValueToJSON(value);
}

export function decodeSemanticValue(
  json: JSONValue,
  expectedType: ValueType,
  environment: TypeEnvironment,
): DecodeResult<SemanticValue> {
  const issues: ValidationIssue[] = [];
  const value = decode(json, expectedType, environment, issues, "$");
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true, value: value as SemanticValue };
}

type DecodeAccumulator = ValidationIssue[];

function issue(issues: DecodeAccumulator, path: string, code: string, message: string): void {
  issues.push({ path, code, message });
}

function decode(
  json: JSONValue,
  expectedType: ValueType,
  environment: TypeEnvironment,
  issues: DecodeAccumulator,
  path: string,
): SemanticValue | undefined {
  switch (expectedType.kind) {
    case "unit": {
      if (!isPlainObject(json)) {
        issue(issues, path, "expectedObject", "unit must be an empty JSON object");
        return undefined;
      }
      const keys = Object.keys(json);
      if (keys.length > 0) {
        issue(issues, path, "unexpectedUnitKey", `unit must encode as {}, found keys ${keys.join(",")}`);
        return undefined;
      }
      return unitValue();
    }
    case "boolean":
      if (typeof json !== "boolean") {
        issue(issues, path, "expectedBoolean", "expected a JSON boolean");
        return undefined;
      }
      return booleanValue(json);
    case "int64": {
      if (!isPlainObject(json)) {
        issue(issues, path, "invalidInt64Wire", 'int64 must be {"$i64":"..."}');
        return undefined;
      }
      const keys = Object.keys(json);
      if (keys.length !== 1 || keys[0] !== "$i64") {
        issue(issues, path, "invalidInt64Wire", 'int64 must be exactly {"$i64":"..."}');
        return undefined;
      }
      const spelling = json.$i64;
      if (typeof spelling !== "string" || !INT64_SPELLING.test(spelling) || spelling === "-0") {
        issue(issues, path, "invalidInt64Spelling", `non-canonical int64 spelling ${JSON.stringify(spelling)}`);
        return undefined;
      }
      const parsed = BigInt(spelling);
      if (parsed < INT64_MIN || parsed > INT64_MAX) {
        issue(issues, path, "int64OutOfRange", "int64 outside signed 64-bit range");
        return undefined;
      }
      return int64Value(parsed);
    }
    case "float64": {
      if (!isPlainObject(json)) {
        issue(issues, path, "invalidFloat64Wire", 'float64 must be {"$f64":"..."}');
        return undefined;
      }
      const keys = Object.keys(json);
      if (keys.length !== 1 || keys[0] !== "$f64") {
        issue(issues, path, "invalidFloat64Wire", 'float64 must be exactly {"$f64":"..."}');
        return undefined;
      }
      const spelling = json.$f64;
      if (typeof spelling !== "string" || !isCanonicalFloat64Spelling(spelling)) {
        issue(issues, path, "invalidFloat64Spelling", `non-canonical float64 spelling ${JSON.stringify(spelling)}`);
        return undefined;
      }
      const parsed = parseFloat64Spelling(spelling);
      if (parsed === undefined) {
        issue(issues, path, "invalidFloat64Spelling", `unparseable float64 spelling ${JSON.stringify(spelling)}`);
        return undefined;
      }
      return float64Value(parsed);
    }
    case "bytes": {
      if (!isPlainObject(json)) {
        issue(issues, path, "invalidBytesWire", 'bytes must be {"$b64":"..."}');
        return undefined;
      }
      const keys = Object.keys(json);
      if (keys.length !== 1 || keys[0] !== "$b64") {
        issue(issues, path, "invalidBytesWire", 'bytes must be exactly {"$b64":"..."}');
        return undefined;
      }
      const spelling = json.$b64;
      if (typeof spelling !== "string" || !/^[A-Za-z0-9+/]*={0,2}$/.test(spelling)) {
        issue(issues, path, "invalidBytesWire", "bytes must be standard base64");
        return undefined;
      }
      const decoded = Buffer.from(spelling, "base64");
      // Reject non-canonical spellings (trailing bits, whitespace, urlsafe alphabet).
      if (Buffer.from(decoded).toString("base64") !== spelling) {
        issue(issues, path, "invalidBytesWire", "bytes must be canonical padded base64");
        return undefined;
      }
      return bytesValue(new Uint8Array(decoded));
    }
    case "string":
      if (typeof json !== "string") {
        issue(issues, path, "expectedString", "expected a JSON string");
        return undefined;
      }
      try {
        return stringValue(json);
      } catch {
        issue(issues, path, "invalidString", "string contains unpaired surrogates");
        return undefined;
      }
    case "list": {
      if (!Array.isArray(json)) {
        issue(issues, path, "expectedArray", "expected a JSON array");
        return undefined;
      }
      const values: SemanticValue[] = [];
      let ok = true;
      json.forEach((element, index) => {
        const decoded = decode(element, expectedType.element, environment, issues, `${path}[${index}]`);
        if (decoded === undefined) {
          ok = false;
        } else {
          values.push(decoded);
        }
      });
      return ok ? listValue(values) : undefined;
    }
    case "map": {
      if (!isPlainObject(json)) {
        issue(issues, path, "expectedObject", "map must be a JSON object");
        return undefined;
      }
      const entries = new Map<string | bigint, SemanticValue>();
      let ok = true;
      for (const [encodedKey, rawValue] of Object.entries(json)) {
        const key = expectedType.key.kind === "int64"
          ? decodeMapKeyInt64(encodedKey, issues, path)
          : encodedKey;
        if (key === undefined) {
          ok = false;
          continue;
        }
        const decodedValue = decode(rawValue, expectedType.value, environment, issues, `${path}[${JSON.stringify(encodedKey)}]`);
        if (decodedValue === undefined) {
          ok = false;
        } else {
          entries.set(key, decodedValue);
        }
      }
      return ok ? mapValue(entries) : undefined;
    }
    case "ref": {
      const declaration = environment.declarations.get(expectedType.typeId as TypeId);
      if (declaration === undefined) {
        issue(issues, path, "unknownTypeReference", `no declaration for '${expectedType.typeId}'`);
        return undefined;
      }
      switch (declaration.kind) {
        case "struct":
          return decodeStruct(json, declaration, environment, issues, path);
        case "enum":
          return decodeEnum(json, declaration, issues, path);
        case "union":
          return decodeUnion(json, declaration, environment, issues, path);
      }
    }
  }
}

function decodeStruct(
  json: JSONValue,
  declaration: { readonly id: string; readonly fields: readonly { readonly name: string; readonly type: ValueType; readonly optional: boolean }[] },
  environment: TypeEnvironment,
  issues: DecodeAccumulator,
  path: string,
): SemanticValue | undefined {
  if (!isPlainObject(json)) {
    issue(issues, path, "expectedObject", `struct ${declaration.id} must be a JSON object`);
    return undefined;
  }
  const fieldTypes = new Map(declaration.fields.map((field) => [field.name, field]));
  for (const key of Object.keys(json)) {
    if (!fieldTypes.has(key)) {
      issue(issues, `${path}.${key}`, "unknownStructField", `unknown field '${key}'`);
    }
  }
  const fields = new Map<string, SemanticValue>();
  let ok = true;
  for (const field of declaration.fields) {
    const raw = json[field.name];
    if (raw === undefined) {
      if (!field.optional) {
        issue(issues, `${path}.${field.name}`, "missingRequiredField", `missing field '${field.name}'`);
        ok = false;
      }
      continue;
    }
    if (raw === null) {
      issue(issues, `${path}.${field.name}`, "invalidNull", `field '${field.name}' must not be null`);
      ok = false;
      continue;
    }
    const decoded = decode(raw, field.type, environment, issues, `${path}.${field.name}`);
    if (decoded === undefined) {
      ok = false;
    } else {
      fields.set(field.name, decoded);
    }
  }
  return ok ? structValue(declaration.id, fields) : undefined;
}

function decodeEnum(
  json: JSONValue,
  declaration: { readonly id: string; readonly cases: readonly string[] },
  issues: DecodeAccumulator,
  path: string,
): SemanticValue | undefined {
  if (typeof json !== "string") {
    issue(issues, path, "expectedString", `enum ${declaration.id} must be a JSON string`);
    return undefined;
  }
  if (!declaration.cases.includes(json)) {
    issue(issues, path, "invalidEnumCase", `unknown case '${json}'`);
    return undefined;
  }
  return enumValue(declaration.id, json);
}

function decodeUnion(
  json: JSONValue,
  declaration: { readonly id: string; readonly cases: readonly { readonly name: string; readonly payload: ValueType }[] },
  environment: TypeEnvironment,
  issues: DecodeAccumulator,
  path: string,
): SemanticValue | undefined {
  if (!isPlainObject(json)) {
    issue(issues, path, "expectedObject", `union ${declaration.id} must be a JSON object`);
    return undefined;
  }
  const caseName = json.$case;
  if (typeof caseName !== "string") {
    issue(issues, path, "invalidUnionCase", `union ${declaration.id} requires a string '$case'`);
    return undefined;
  }
  const matched = declaration.cases.find((entry) => entry.name === caseName);
  if (matched === undefined) {
    issue(issues, `${path}.case`, "invalidUnionCase", `unknown case '${caseName}'`);
    return undefined;
  }
  const payloadIsUnit = matched.payload.kind === "unit";
  const keyCount = Object.keys(json).length;
  const hasValueKey = Object.hasOwn(json, "value") && json.value !== undefined;
  if (payloadIsUnit) {
    if (keyCount !== 1) {
      issue(issues, path, "unexpectedUnionPayloadKey", `unit-payload case '${caseName}' must not carry 'value' or extra keys`);
      return undefined;
    }
    return unionValue(declaration.id, caseName);
  }
  if (!hasValueKey) {
    issue(issues, `${path}.value`, "missingUnionPayload", `case '${caseName}' requires a payload`);
    return undefined;
  }
  if (keyCount !== 2) {
    issue(issues, path, "unexpectedUnionPayloadKey", `case '${caseName}' allows exactly '$case' and 'value'`);
    return undefined;
  }
  const rawPayload = json.value;
  if (rawPayload === undefined) {
    issue(issues, `${path}.value`, "missingUnionPayload", `case '${caseName}' requires a payload`);
    return undefined;
  }
  const payload = decode(rawPayload, matched.payload, environment, issues, `${path}.value`);
  if (payload === undefined) {
    return undefined;
  }
  return unionValue(declaration.id, caseName, payload);
}

function decodeMapKeyInt64(
  encodedKey: string,
  issues: DecodeAccumulator,
  path: string,
): bigint | undefined {
  if (!/^-?(0|[1-9][0-9]*)$/.test(encodedKey) || encodedKey === "-0") {
    issue(issues, path, "invalidMapKey", `int64 map keys must be canonical decimal, got ${JSON.stringify(encodedKey)}`);
    return undefined;
  }
  const parsed = BigInt(encodedKey);
  if (parsed < INT64_MIN || parsed > INT64_MAX) {
    issue(issues, path, "int64OutOfRange", "int64 map key outside signed 64-bit range");
    return undefined;
  }
  return parsed;
}

function isPlainObject(json: JSONValue): json is { readonly [key: string]: JSONValue } {
  return typeof json === "object" && json !== null && !Array.isArray(json);
}
