/**
 * `execspec diff` and `execspec compatible`: semantic compatibility
 * between IR versions. Diff shows what changed; compatible answers
 * whether the new spec is backward-compatible with the old.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  decodeSemanticIRDocument,
  compareByCodePoint,
} from "@execspec/core";
import type {
  OperationIR,
  ScenarioIR,
  SemanticIR,
  TypeDeclaration,
  ValueType,
} from "@execspec/core";
import type { CliIO } from "./index.js";

interface Change {
  readonly kind: "added" | "removed" | "changed";
  readonly scope: string;
  readonly description: string;
  readonly compatible: boolean;
}

export async function loadIR(path: string, io: CliIO): Promise<SemanticIR | undefined> {
  try {
    const raw = await readFile(resolve(path), "utf8");
    const decoded = decodeSemanticIRDocument(JSON.parse(raw));
    if (!decoded.ok) {
      io.writeErr(`cannot load ${path}: IR rejected\n`);
      return undefined;
    }
    return decoded.document.semantic;
  } catch (error) {
    io.writeErr(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}\n`);
    return undefined;
  }
}

export async function diffCommand(args: readonly string[], io: CliIO): Promise<number> {
  const oldPath = args[args.indexOf("--old") + 1];
  const newPath = args[args.indexOf("--new") + 1];
  if (oldPath === undefined || newPath === undefined) {
    io.writeErr("diff: requires --old <file> --new <file>\n");
    return 2;
  }
  const oldIR = await loadIR(oldPath, io);
  const newIR = await loadIR(newPath, io);
  if (oldIR === undefined || newIR === undefined) return 1;

  const changes = computeDiff(oldIR, newIR);
  if (changes.length === 0) {
    io.writeOut("no differences\n");
    return 0;
  }
  for (const change of changes) {
    const marker = change.compatible ? "  " : "BC";
    io.writeOut(`${marker} ${change.kind.padEnd(7)} ${change.scope}: ${change.description}\n`);
  }
  const breaking = changes.filter((c) => !c.compatible).length;
  io.writeOut(`\n${changes.length} change(s), ${breaking} breaking\n`);
  return 0;
}

export async function compatibleCommand(args: readonly string[], io: CliIO): Promise<number> {
  const oldPath = args[args.indexOf("--old") + 1];
  const newPath = args[args.indexOf("--new") + 1];
  if (oldPath === undefined || newPath === undefined) {
    io.writeErr("compatible: requires --old <file> --new <file>\n");
    return 2;
  }
  const oldIR = await loadIR(oldPath, io);
  const newIR = await loadIR(newPath, io);
  if (oldIR === undefined || newIR === undefined) return 1;

  const changes = computeDiff(oldIR, newIR);
  const breaking = changes.filter((c) => !c.compatible);
  if (breaking.length === 0) {
    io.writeOut("compatible: yes\n");
    io.writeOut("\nchecked:\n");
    io.writeOut("  every operation in old exists in new\n");
    io.writeOut("  all " + oldIR.operations.length + " operation input/output types pass variance rules\n");
    io.writeOut("  all " + oldIR.types.length + " type declarations checked for field/case changes\n");
    io.writeOut("  all " + oldIR.scenarios.length + " scenarios exist in new with identical step contents\n");
    io.writeOut("\nnot checked:\n");
    io.writeOut("  behavioral equivalence of implementations\n");
    io.writeOut("  semantic model changes (governed by digest lineage)\n");
    return 0;
  }
  io.writeOut("compatible: no\n");
  for (const change of breaking) {
    io.writeOut("  breaking: " + change.scope + ": " + change.description + "\n");
  }
  io.writeOut("\n" + breaking.length + " breaking change(s) found across " + changes.length + " total change(s)\n");
  return 1;
}

// --- Diff computation ---

export function computeDiff(oldIR: SemanticIR, newIR: SemanticIR): readonly Change[] {
  const changes: Change[] = [];
  const oldTypes = new Map(oldIR.types.map((t) => [t.id, t]));
  const newTypes = new Map(newIR.types.map((t) => [t.id, t]));
  const oldOps = new Map(oldIR.operations.map((o) => [o.id, o]));
  const newOps = new Map(newIR.operations.map((o) => [o.id, o]));

  // Types
  for (const [id, oldType] of oldTypes) {
    if (!newTypes.has(id)) {
      changes.push({ kind: "removed", scope: `type ${id}`, description: "type removed", compatible: false });
    } else {
      changes.push(...diffType(oldType, newTypes.get(id)!));
    }
  }
  for (const id of newTypes.keys()) {
    if (!oldTypes.has(id)) {
      changes.push({ kind: "added", scope: `type ${id}`, description: "type added", compatible: true });
    }
  }

  // Operations
  for (const [id, oldOp] of oldOps) {
    if (!newOps.has(id)) {
      changes.push({ kind: "removed", scope: `operation ${id}`, description: "operation removed", compatible: false });
    } else {
      const newOp = newOps.get(id)!;
      if (!typeEquals(oldOp.input, newOp.input)) {
        const compatible = isInputCompatible(oldOp.input, newOp.input, oldTypes, newTypes);
        changes.push({
          kind: "changed",
          scope: `operation ${id}`,
          description: `input type changed (${describeType(oldOp.input)} → ${describeType(newOp.input)})`,
          compatible,
        });
      }
      if (!typeEquals(oldOp.output, newOp.output)) {
        const compatible = isOutputCompatible(oldOp.output, newOp.output, oldTypes, newTypes);
        changes.push({
          kind: "changed",
          scope: `operation ${id}`,
          description: `output type changed (${describeType(oldOp.output)} → ${describeType(newOp.output)})`,
          compatible,
        });
      }
    }
  }
  for (const id of newOps.keys()) {
    if (!oldOps.has(id)) {
      changes.push({ kind: "added", scope: `operation ${id}`, description: "operation added", compatible: true });
    }
  }

  // Scenarios: check ID sets AND content changes
  const oldScenarioMap = new Map(oldIR.scenarios.map((s) => [s.id, s]));
  const newScenarioMap = new Map(newIR.scenarios.map((s) => [s.id, s]));
  for (const [id, oldScenario] of oldScenarioMap) {
    if (!newScenarioMap.has(id)) {
      changes.push({ kind: "removed", scope: `scenario ${id}`, description: "scenario removed (behavioral guarantee lost)", compatible: false });
    } else {
      const newScenario = newScenarioMap.get(id)!;
      if (scenarioStepsChanged(oldScenario, newScenario)) {
        changes.push({
          kind: "changed",
          scope: `scenario ${id}`,
          description: "scenario steps or expectations changed (behavioral contract modified)",
          compatible: false,
        });
      }
    }
  }
  for (const id of newScenarioMap.keys()) {
    if (!oldScenarioMap.has(id)) {
      changes.push({ kind: "added", scope: `scenario ${id}`, description: "scenario added", compatible: true });
    }
  }

  return changes;
}

function diffType(oldType: TypeDeclaration, newType: TypeDeclaration): readonly Change[] {
  const changes: Change[] = [];
  const scope = `type ${oldType.id}`;

  if (oldType.kind !== newType.kind) {
    changes.push({ kind: "changed", scope, description: `kind changed (${oldType.kind} → ${newType.kind})`, compatible: false });
    return changes;
  }

  if (oldType.kind === "struct" && newType.kind === "struct") {
    const oldFields = new Map(oldType.fields.map((f) => [f.name, f]));
    const newFields = new Map(newType.fields.map((f) => [f.name, f]));
    for (const [name, oldField] of oldFields) {
      if (!newFields.has(name)) {
        changes.push({ kind: "removed", scope, description: `field '${name}' removed`, compatible: false });
      } else {
        const newField = newFields.get(name)!;
        if (!typeEquals(oldField.type, newField.type)) {
          changes.push({ kind: "changed", scope, description: `field '${name}' type changed (${describeType(oldField.type)} → ${describeType(newField.type)})`, compatible: false });
        }
        if (oldField.optional && !newField.optional) {
          changes.push({ kind: "changed", scope, description: `field '${name}' became required`, compatible: false });
        }
        if (!oldField.optional && newField.optional) {
          changes.push({ kind: "changed", scope, description: `field '${name}' became optional`, compatible: true });
        }
      }
    }
    for (const name of newFields.keys()) {
      if (!oldFields.has(name)) {
        const newField = newFields.get(name)!;
        changes.push({
          kind: "added",
          scope,
          description: `field '${name}' added${newField.optional ? " (optional)" : " (required)"}`,
          compatible: newField.optional,
        });
      }
    }
  } else if (oldType.kind === "enum" && newType.kind === "enum") {
    const oldCases = new Set(oldType.cases);
    const newCases = new Set(newType.cases);
    for (const c of oldCases) {
      if (!newCases.has(c)) {
        changes.push({ kind: "removed", scope, description: `case '${c}' removed`, compatible: false });
      }
    }
    for (const c of newCases) {
      if (!oldCases.has(c)) {
        changes.push({ kind: "added", scope, description: `case '${c}' added`, compatible: true });
      }
    }
  } else if (oldType.kind === "union" && newType.kind === "union") {
    const oldCases = new Map(oldType.cases.map((c) => [c.name, c]));
    const newCases = new Map(newType.cases.map((c) => [c.name, c]));
    for (const [name, oldCase] of oldCases) {
      if (!newCases.has(name)) {
        changes.push({ kind: "removed", scope, description: `case '${name}' removed`, compatible: false });
      } else {
        const newCase = newCases.get(name)!;
        if (!typeEquals(oldCase.payload, newCase.payload)) {
          changes.push({ kind: "changed", scope, description: `case '${name}' payload changed`, compatible: false });
        }
      }
    }
    for (const name of newCases.keys()) {
      if (!oldCases.has(name)) {
        changes.push({ kind: "added", scope, description: `case '${name}' added`, compatible: true });
      }
    }
  }

  return changes;
}

// --- Type compatibility ---

function typeEquals(a: ValueType, b: ValueType): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "unit": case "boolean": case "int64": case "float64": case "string": case "bytes":
      return true;
    case "ref":
      return a.typeId === (b as { typeId: string }).typeId;
    case "list":
      return typeEquals(a.element, (b as { element: ValueType }).element);
    case "map":
      return typeEquals(a.key, (b as { key: ValueType }).key)
        && typeEquals(a.value, (b as { value: ValueType }).value);
  }
}

function isInputCompatible(
  oldInput: ValueType,
  newInput: ValueType,
  oldTypes: Map<string, TypeDeclaration>,
  newTypes: Map<string, TypeDeclaration>,
): boolean {
  // Input compatibility: new input must accept everything old input accepted.
  // Contravariant: new can be MORE permissive (wider).
  if (typeEquals(oldInput, newInput)) return true;
  if (oldInput.kind === "ref" && newInput.kind === "ref") {
    const oldT = oldTypes.get(oldInput.typeId);
    const newT = newTypes.get(newInput.typeId);
    if (oldT && newT && oldT.kind === "struct" && newT.kind === "struct") {
      // Old input must be a subset of new input (new can have extra optional fields)
      return oldT.fields.every((oldField) => {
        const newField = newT.fields.find((f) => f.name === oldField.name);
        if (!newField) return false;
        if (!typeEquals(oldField.type, newField.type)) return false;
        if (oldField.optional && !newField.optional) return false; // tightening
        return true;
      });
    }
    if (oldT && newT && oldT.kind === "union" && newT.kind === "union") {
      // Old union cases must all exist in new (new can add cases for input)
      return oldT.cases.every((oldCase) => {
        const newCase = newT.cases.find((c) => c.name === oldCase.name);
        return newCase && typeEquals(oldCase.payload, newCase.payload);
      });
    }
  }
  return false;
}

function isOutputCompatible(
  oldOutput: ValueType,
  newOutput: ValueType,
  oldTypes: Map<string, TypeDeclaration>,
  newTypes: Map<string, TypeDeclaration>,
): boolean {
  // Output compatibility: new output must only produce what old output could produce.
  // Covariant: new can be MORE restrictive (narrower).
  if (typeEquals(oldOutput, newOutput)) return true;
  if (oldOutput.kind === "ref" && newOutput.kind === "ref") {
    const oldT = oldTypes.get(oldOutput.typeId);
    const newT = newTypes.get(newOutput.typeId);
    if (oldT && newT && oldT.kind === "struct" && newT.kind === "struct") {
      // New struct must have all old fields with compatible types
      return newT.fields.every((newField) => {
        const oldField = oldT.fields.find((f) => f.name === newField.name);
        if (!oldField) return newField.optional; // extra optional fields OK
        return typeEquals(oldField.type, newField.type) && (!oldField.optional || newField.optional || !oldField.optional);
        // required→optional is fine for output, optional→required is not
      });
    }
    if (oldT && newT && oldT.kind === "union" && newT.kind === "union") {
      // New union cases must be a subset of old (can remove cases for output)
      return newT.cases.every((newCase) => {
        const oldCase = oldT.cases.find((c) => c.name === newCase.name);
        return oldCase && typeEquals(oldCase.payload, newCase.payload);
      });
    }
    if (oldT && newT && oldT.kind === "enum" && newT.kind === "enum") {
      // New enum cases must be a subset of old
      return newT.cases.every((c) => oldT.cases.includes(c));
    }
  }
  return false;
}

function describeType(type: ValueType): string {
  switch (type.kind) {
    case "unit": return "unit";
    case "boolean": return "boolean";
    case "int64": return "int64";
    case "float64": return "float64";
    case "string": return "string";
    case "bytes": return "bytes";
    case "ref": return type.typeId;
    case "list": return `list<${describeType(type.element)}>`;
    case "map": return `map<${describeType(type.key)}, ${describeType(type.value)}>`;
  }
}


function scenarioStepsChanged(
  oldScenario: ScenarioIR,
  newScenario: ScenarioIR,
): boolean {
  if (oldScenario.steps.length !== newScenario.steps.length) return true;
  for (let i = 0; i < oldScenario.steps.length; i++) {
    const oldStep = oldScenario.steps[i];
    const newStep = newScenario.steps[i];
    if (oldStep === undefined || newStep === undefined) return true;
    if (oldStep.kind !== newStep.kind) return true;
    if (oldStep.kind === "call" && newStep.kind === "call") {
      if (oldStep.operationId !== newStep.operationId) return true;
      if (oldStep.binding !== newStep.binding) return true;
      // Compare input expressions structurally
      if (expressionChanged(oldStep.input, newStep.input)) return true;
    }
    if (oldStep.kind === "expectEqual" && newStep.kind === "expectEqual") {
      if (expressionChanged(oldStep.actual, newStep.actual)) return true;
      if (expressionChanged(oldStep.expected, newStep.expected)) return true;
    }
  }
  return false;
}

function expressionChanged(
  oldExpr: import("@execspec/core").ValueExpressionIR,
  newExpr: import("@execspec/core").ValueExpressionIR,
): boolean {
  if (oldExpr.kind !== newExpr.kind) return true;
  switch (oldExpr.kind) {
    case "literal": {
      const newLit = newExpr as { kind: "literal"; value: unknown };
      return JSON.stringify(canonicalizeValue(oldExpr.value)) !== JSON.stringify(canonicalizeValue(newLit.value));
    }
    case "binding": {
      const newBind = newExpr as { kind: "binding"; binding: string };
      return oldExpr.binding !== newBind.binding;
    }
    case "field": {
      const newField = newExpr as { kind: "field"; base: import("@execspec/core").ValueExpressionIR; field: string };
      return oldExpr.field !== newField.field || expressionChanged(oldExpr.base, newField.base);
    }
  }
}

function canonicalizeValue(value: unknown): unknown {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    if (value instanceof Map) {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of value) {
        obj[typeof k === "bigint" ? k.toString() : String(k)] = canonicalizeValue(v);
      }
      return obj;
    }
    if (Array.isArray(value)) return value.map(canonicalizeValue);
    const obj: Record<string, unknown> = {};
    const sortedKeys = Object.keys(value).sort();
    for (const key of sortedKeys) {
      const val = (value as Record<string, unknown>)[key];
      if (val !== undefined) obj[key] = canonicalizeValue(val);
    }
    return obj;
  }
  if (typeof value === "bigint") return value.toString();
  return value;
}
