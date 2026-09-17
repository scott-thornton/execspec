/**
 * Canonical JSON serialization (docs/ir-v1.md §3).
 *
 * Explicit recursive key sorting by Unicode code point — never
 * `JSON.stringify` object insertion order.
 */

export type JSONScalar = null | boolean | string | number;

export type JSONValue =
  | JSONScalar
  | readonly JSONValue[]
  | { readonly [key: string]: JSONValue };

/** Compare strings by Unicode code point (not UTF-16 code unit). */
export function compareByCodePoint(left: string, right: string): number {
  let i = 0;
  let j = 0;
  while (i < left.length && j < right.length) {
    const leftPoint = left.codePointAt(i);
    const rightPoint = right.codePointAt(j);
    if (leftPoint === undefined || rightPoint === undefined) {
      break;
    }
    if (leftPoint !== rightPoint) {
      return leftPoint - rightPoint;
    }
    i += leftPoint > 0xffff ? 2 : 1;
    j += rightPoint > 0xffff ? 2 : 1;
  }
  const leftRest = left.length - i;
  const rightRest = right.length - j;
  return leftRest - rightRest;
}

export function canonicalJSONStringify(value: JSONValue): string {
  const chunks: string[] = [];
  writeValue(value, chunks);
  return chunks.join("");
}

function isJSONArray(value: JSONValue): value is readonly JSONValue[] {
  return Array.isArray(value);
}

function writeValue(value: JSONValue, out: string[]): void {
  if (value === null) {
    out.push("null");
    return;
  }
  if (typeof value === "boolean") {
    out.push(value ? "true" : "false");
    return;
  }
  if (typeof value === "string") {
    out.push(escapeString(value));
    return;
  }
  if (typeof value === "number") {
    out.push(formatNumber(value));
    return;
  }
  if (isJSONArray(value)) {
    out.push("[");
    value.forEach((element, index) => {
      if (index > 0) {
        out.push(",");
      }
      writeValue(element, out);
    });
    out.push("]");
    return;
  }
  const record: { readonly [key: string]: JSONValue } = value;
  const keys = Object.keys(record).sort(compareByCodePoint);
  out.push("{");
  keys.forEach((key, index) => {
    if (index > 0) {
      out.push(",");
    }
    out.push(escapeString(key), ":");
    writeValue(record[key] as JSONValue, out);
  });
  out.push("}");
}

function formatNumber(value: number): string {
  if (!Number.isInteger(value) || !Number.isSafeInteger(value)) {
    throw new Error(
      `canonical JSON only encodes safe integers; got ${String(value)}`,
    );
  }
  return value.toString(10);
}

const SHORT_ESCAPES = new Map<number, string>([
  [0x08, "\\b"],
  [0x09, "\\t"],
  [0x0a, "\\n"],
  [0x0c, "\\f"],
  [0x0d, "\\r"],
]);

function escapeString(value: string): string {
  let result = '"';
  for (let i = 0; i < value.length; i += 1) {
    const codeUnit = value.charCodeAt(i);
    if (codeUnit === 0x22) {
      result += '\\"';
      continue;
    }
    if (codeUnit === 0x5c) {
      result += "\\\\";
      continue;
    }
    const short = SHORT_ESCAPES.get(codeUnit);
    if (short !== undefined) {
      result += short;
      continue;
    }
    if (codeUnit < 0x20) {
      result += `\\u${codeUnit.toString(16).padStart(4, "0")}`;
      continue;
    }
    result += value[i];
  }
  result += '"';
  return result;
}
