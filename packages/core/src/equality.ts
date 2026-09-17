/**
 * Portable semantic equality (docs/semantic-model.md §4).
 *
 * Field order is irrelevant; nominal identity, list order, exact string
 * contents, and exact bigint values are not.
 */

import type { SemanticValue } from "./semantic-value.js";
import { canonicalFloat64Spelling } from "./float64.js";

export interface EqualityDifference {
  readonly path: string;
  readonly expected: SemanticValue;
  readonly actual: SemanticValue;
}

export function semanticEqual(
  expected: SemanticValue,
  actual: SemanticValue,
): boolean {
  return semanticDiff(expected, actual).length === 0;
}

export function semanticDiff(
  expected: SemanticValue,
  actual: SemanticValue,
): readonly EqualityDifference[] {
  return diff(expected, actual, "$");
}

function difference(
  path: string,
  expected: SemanticValue,
  actual: SemanticValue,
): EqualityDifference[] {
  return [{ path, expected, actual }];
}

function diff(
  expected: SemanticValue,
  actual: SemanticValue,
  path: string,
): EqualityDifference[] {
  if (expected.kind !== actual.kind) {
    return difference(path, expected, actual);
  }
  switch (expected.kind) {
    case "unit":
      return [];
    case "boolean":
    case "string":
      return expected.value === (actual as typeof expected).value
        ? []
        : difference(path, expected, actual);
    case "int64":
      return expected.value === (actual as typeof expected).value
        ? []
        : difference(path, expected, actual);
    case "float64": {
      const actualFloat = actual as typeof expected;
      // Portable equality is defined by the canonical spelling: -0 ≡ 0
      // and NaN ≡ NaN (values, not IEEE arithmetic semantics).
      return canonicalFloat64Spelling(expected.value) === canonicalFloat64Spelling(actualFloat.value)
        ? []
        : difference(path, expected, actual);
    }
    case "bytes": {
      const actualBytes = actual as typeof expected;
      if (expected.value.length !== actualBytes.value.length) {
        return difference(path, expected, actual);
      }
      for (let index = 0; index < expected.value.length; index += 1) {
        if (expected.value[index] !== actualBytes.value[index]) {
          return difference(path, expected, actual);
        }
      }
      return [];
    }
    case "list": {
      const actualList = actual as typeof expected;
      if (expected.values.length !== actualList.values.length) {
        return difference(path, expected, actual);
      }
      const differences: EqualityDifference[] = [];
      expected.values.forEach((element, index) => {
        const actualElement = actualList.values[index];
        if (actualElement !== undefined) {
          differences.push(...diff(element, actualElement, `${path}[${index}]`));
        }
      });
      return differences;
    }
    case "map": {
      const actualMap = actual as typeof expected;
      if (expected.entries.size !== actualMap.entries.size) {
        return difference(path, expected, actual);
      }
      const differences: EqualityDifference[] = [];
      for (const [key, entry] of expected.entries) {
        const actualEntry = actualMap.entries.get(key);
        if (actualEntry === undefined) {
          return difference(path, expected, actual);
        }
        const encodedKey = typeof key === "bigint" ? key.toString(10) : key;
        differences.push(...diff(entry, actualEntry, `${path}[${JSON.stringify(encodedKey)}]`));
      }
      return differences;
    }
    case "enum": {
      const actualEnum = actual as typeof expected;
      if (expected.typeId !== actualEnum.typeId || expected.case !== actualEnum.case) {
        return difference(path, expected, actual);
      }
      return [];
    }
    case "struct": {
      const actualStruct = actual as typeof expected;
      if (expected.typeId !== actualStruct.typeId) {
        return difference(path, expected, actual);
      }
      const expectedKeys = [...expected.fields.keys()].sort().join("\u0000");
      const actualKeys = [...actualStruct.fields.keys()].sort().join("\u0000");
      if (expectedKeys !== actualKeys) {
        return difference(path, expected, actual);
      }
      const differences: EqualityDifference[] = [];
      for (const [name, value] of expected.fields) {
        const actualValue = actualStruct.fields.get(name);
        if (actualValue !== undefined) {
          differences.push(...diff(value, actualValue, `${path}.${name}`));
        }
      }
      return differences;
    }
    case "union": {
      const actualUnion = actual as typeof expected;
      if (
        expected.typeId !== actualUnion.typeId ||
        expected.case !== actualUnion.case
      ) {
        return difference(path, expected, actual);
      }
      if (expected.value === undefined || actualUnion.value === undefined) {
        if (expected.value !== undefined || actualUnion.value !== undefined) {
          return difference(`${path}.value`, expected.value ?? expected, actualUnion.value ?? actualUnion);
        }
        return [];
      }
      return diff(expected.value, actualUnion.value, `${path}.value`);
    }
  }
}
