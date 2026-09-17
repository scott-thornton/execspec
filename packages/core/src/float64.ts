/**
 * Canonical float64 spelling (docs/semantic-model.md §3.1, ADR).
 *
 * The canonical spelling of a double is exactly what ECMAScript's
 * `Number.prototype.toString()` produces: the shortest round-trip
 * decimal, decimal notation for 1e-6 ≤ |x| < 1e21, exponent notation
 * otherwise, and the literals "NaN", "Infinity", "-Infinity". "-0"
 * canonicalizes to "0", so -0 ≡ +0 and NaN ≡ NaN under portable
 * equality. Targets generate the same spelling bit-for-bit (see the
 * Swift generator's ecmaSpelling for the non-JavaScript side).
 */

export function canonicalFloat64Spelling(value: number): string {
  return String(value);
}

export function isCanonicalFloat64Spelling(spelling: string): boolean {
  const parsed = Number(spelling);
  if (Number.isNaN(parsed) && spelling !== "NaN") {
    return false;
  }
  return String(parsed) === spelling;
}

export function parseFloat64Spelling(spelling: string): number | undefined {
  const parsed = Number(spelling);
  if (Number.isNaN(parsed) && spelling !== "NaN") {
    return undefined;
  }
  return parsed;
}
