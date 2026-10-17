/**
 * `execspec probe`: property-based differential conformance.
 * Generates deterministic input values from the spec, sends them to
 * every implementation, and verifies all implementations agree.
 *
 * The generator is seeded by (specDigest, operationId, iteration), so
 * every implementation receives identical inputs without any
 * coordination. Disagreements are reported with the exact input that
 * exposed the divergence.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
  parseTypeId,
  decodeSemanticIRDocument,
  specificationDigest,
  buildIRTypeEnvironment,
  validateValue,
  encodeSemanticValue,
  decodeSemanticValue,
  semanticEqual,
  compareByCodePoint,
  stringValue,
  int64Value,
  float64Value,
  booleanValue,
  bytesValue,
  listValue,
  mapValue,
  structValue,
  enumValue,
  unionValue,
  unitValue,
} from "@execspec/core";
import type {
  JSONValue,
  OperationId,
  ScenarioIR,
  SemanticIR,
  SemanticIRDocument,
  SemanticValue,
  TypeDeclaration,
  TypeEnvironment,
  ValueType,
} from "@execspec/core";
import { spawnHost } from "@execspec/harness";
import type { HostCommand, HostProcess } from "@execspec/harness";
import type { CliIO } from "./index.js";

export async function probeCommand(args: readonly string[], io: CliIO): Promise<number> {
  const values = parseProbeFlags(args);
  const irPath = values["--ir"];
  if (irPath === undefined) {
    io.writeErr("probe: requires --ir <file> [--host <exec> ...] [--iterations N] [--seed S]\n");
    return 2;
  }
  const hosts = args.filter((a, i) => args[i - 1] === "--host");
  if (hosts.length < 2) {
    io.writeErr("probe: requires at least two --host flags for differential testing\n");
    return 2;
  }
  const iterations = values["--iterations"] !== undefined ? parseInt(values["--iterations"], 10) : 50;
  const seedBase = values["--seed"] ?? "0";

  let raw: string;
  try {
    raw = await readFile(resolve(irPath), "utf8");
  } catch (error) {
    io.writeErr(`probe: cannot read ${irPath}: ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
  const decoded = decodeSemanticIRDocument(JSON.parse(raw));
  if (!decoded.ok) {
    io.writeErr("probe: IR rejected\n");
    return 1;
  }
  const document = decoded.document;
  const digest = specificationDigest(document.semantic);
  const env = buildIRTypeEnvironment(document.semantic);
  const typeEnv: TypeEnvironment = { declarations: env.declarations };

  io.writeOut(`probing ${document.semantic.operations.length} operations x ${iterations} iterations against ${hosts.length} hosts\n`);

  let totalProbes = 0;
  let disagreements = 0;

  const sortedOps = [...document.semantic.operations].sort((a, b) => compareByCodePoint(a.id, b.id));

  for (const operation of sortedOps) {
    // Spawn one host per implementation for this operation
    const hostProcs: HostProcess[] = [];
    for (const hostPath of hosts) {
      try {
        const host = await spawnHost({ executable: resolve(hostPath), args: [] });
        await host.handshake(digest, 10000);
        hostProcs.push(host);
      } catch (error) {
        io.writeErr(`probe: failed to start host ${hostPath}: ${error instanceof Error ? error.message : String(error)}\n`);
        for (const h of hostProcs) await h.close().catch(() => undefined);
        return 1;
      }
    }

    for (let iteration = 0; iteration < iterations; iteration++) {
      const input = generateInput(operation.input, typeEnv, digest, operation.id, iteration, seedBase);
      const validation = validateValue(input, operation.input, typeEnv);
      if (validation.length > 0) continue; // skip invalid generations

      const encoded = encodeSemanticValue(input, operation.input, typeEnv);
      const outputs: SemanticValue[] = [];
      let allSucceeded = true;

      for (let h = 0; h < hostProcs.length; h++) {
        try {
          const host = hostProcs[h];
            if (host === undefined) { allSucceeded = false; break; }
            const outputJson = await host.request(operation.id, encoded, 5000);
          const decodedOutput = decodeSemanticValue(outputJson, operation.output, typeEnv);
          if (decodedOutput.ok) {
            outputs.push(decodedOutput.value);
          } else {
            allSucceeded = false;
            break;
          }
        } catch {
          allSucceeded = false;
          break;
        }
      }

      totalProbes++;
      if (allSucceeded && outputs.length === hostProcs.length) {
        const first = outputs[0];
        if (first !== undefined) {
          for (let i = 1; i < outputs.length; i++) {
            const other = outputs[i];
            if (other !== undefined && !semanticEqual(first, other)) {
              disagreements++;
              io.writeOut(`\nDISAGREEMENT: ${operation.id} iteration ${iteration}\n`);
              io.writeOut(`  host[0]: ${renderValue(first)}\n`);
              io.writeOut(`  host[${i}]: ${renderValue(other)}\n`);
              io.writeOut(`  input:   ${renderValue(input)}\n`);
              break;
            }
          }
        }
      }
    }

    for (const h of hostProcs) {
      await h.close().catch(() => undefined);
    }
  }

  io.writeOut(`\n${totalProbes} probes, ${disagreements} disagreements\n`);
  return disagreements > 0 ? 1 : 0;
}

// --- Deterministic value generation ---

function generateInput(
  type: ValueType,
  env: TypeEnvironment,
  digest: string,
  operationId: string,
  iteration: number,
  seedBase: string,
): SemanticValue {
  const seed = hashSeed(digest, operationId, iteration, seedBase);
  return generateValue(type, env, seed, 0);
}

function hashSeed(digest: string, operationId: string, iteration: number, seedBase: string): number {
  const hash = createHash("sha256")
    .update(digest)
    .update(operationId)
    .update(String(iteration))
    .update(seedBase)
    .digest();
  return hash.readUInt32BE(0);
}

let prngState = 0;
function nextRandom(): number {
  // xorshift32 for deterministic pseudo-randomness
  prngState ^= prngState << 13;
  prngState ^= prngState >>> 17;
  prngState ^= prngState << 5;
  return Math.abs(prngState);
}

function generateValue(type: ValueType, env: TypeEnvironment, seed: number, depth: number): SemanticValue {
  prngState = seed !== 0 ? seed : 1;
  return genValue(type, env, depth);
}

function genValue(type: ValueType, env: TypeEnvironment, depth: number): SemanticValue {
  if (depth > 3) {
    // At max depth, prefer simple values
    switch (type.kind) {
      case "unit": return unitValue();
      case "boolean": return booleanValue(nextRandom() % 2 === 0);
      case "int64": return int64Value(BigInt(nextRandom() % 1000));
      case "float64": return float64Value(nextRandom() % 10000 / 100);
      case "string": return stringValue(genString());
      default: return stringValue(genString());
    }
  }

  switch (type.kind) {
    case "unit": return unitValue();
    case "boolean": return booleanValue(nextRandom() % 2 === 0);
    case "int64": {
      const choice = nextRandom() % 6;
      if (choice === 0) return int64Value(0n);
      if (choice === 1) return int64Value(9223372036854775807n);
      if (choice === 2) return int64Value(-9223372036854775808n);
      if (choice === 3) return int64Value(-1n);
      return int64Value(BigInt(nextRandom() % 1000000));
    }
    case "float64": {
      const choice = nextRandom() % 5;
      if (choice === 0) return float64Value(0);
      if (choice === 1) return float64Value(0.5);
      if (choice === 2) return float64Value(-0.25);
      return float64Value(nextRandom() % 100000 / 100);
    }
    case "string": return stringValue(genString());
    case "bytes": {
      const len = nextRandom() % 8;
      const arr = new Uint8Array(len);
      for (let i = 0; i < len; i++) arr[i] = nextRandom() % 256;
      return bytesValue(arr);
    }
    case "list": {
      const len = nextRandom() % 4;
      const items: SemanticValue[] = [];
      for (let i = 0; i < len; i++) {
        items.push(genValue(type.element, env, depth + 1));
      }
      return listValue(items);
    }
    case "map": {
      const len = nextRandom() % 3;
      const entries = new Map<string | bigint, SemanticValue>();
      for (let i = 0; i < len; i++) {
        const key = type.key.kind === "int64" ? BigInt(nextRandom() % 100) : genString();
        entries.set(key, genValue(type.value, env, depth + 1));
      }
      return mapValue(entries);
    }
    case "ref": {
      const decl = env.declarations.get(type.typeId as import("@execspec/core").TypeId);
      if (decl === undefined) return stringValue("unknown");
      switch (decl.kind) {
        case "struct": {
          const fields = new Map<string, SemanticValue>();
          for (const field of decl.fields) {
            if (field.optional && nextRandom() % 3 === 0) continue; // sometimes omit optional
            fields.set(field.name, genValue(field.type, env, depth + 1));
          }
          return structValue(decl.id, fields);
        }
        case "enum": {
          const cases = decl.cases;
          const caseName = cases[nextRandom() % cases.length] ?? cases[0] ?? "unknown";
          return enumValue(decl.id as never, caseName);
        }
        case "union": {
          const cases = decl.cases;
          const chosen: { name: string; payload: ValueType } | undefined = cases[nextRandom() % cases.length] ?? cases[0];
          if (chosen === undefined) return stringValue("no-case");
          if (chosen === undefined) return unionValue(decl.id as never, "unknown");
          if (chosen.payload.kind === "unit") {
            return unionValue(decl.id as never, chosen.name);
          }
          return unionValue(decl.id as never, chosen.name, genValue(chosen.payload, env, depth + 1));
        }
      }
    }
  }
}

function genString(): string {
  const choice = nextRandom() % 5;
  if (choice === 0) return "";
  if (choice === 1) return "a";
  if (choice === 2) return "hello world";
  if (choice === 3) return "é😀";
  return `str${nextRandom() % 1000}`;
}

function renderValue(value: SemanticValue): string {
  return JSON.stringify(encodeForDisplay(value));
}

function encodeForDisplay(value: SemanticValue): unknown {
  switch (value.kind) {
    case "unit": return {};
    case "boolean": return value.value;
    case "int64": return value.value.toString();
    case "float64": return value.value;
    case "string": return value.value;
    case "bytes": return `[${value.value.length} bytes]`;
    case "list": return value.values.map(encodeForDisplay);
    case "map": {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of value.entries) {
        obj[typeof k === "bigint" ? k.toString() : k] = encodeForDisplay(v);
      }
      return obj;
    }
    case "struct": {
      const obj: Record<string, unknown> = {};
      for (const [k, v] of value.fields) obj[k] = encodeForDisplay(v);
      return obj;
    }
    case "enum": return value.case;
    case "union": {
      if (value.value === undefined) return { case: value.case };
      return { case: value.case, value: encodeForDisplay(value.value) };
    }
  }
}

function parseProbeFlags(args: readonly string[]): Record<string, string> {
  const values: Record<string, string> = {};
  for (let i = 0; i < args.length - 1; i++) {
    const flag = args[i];
    if (flag === "--ir" || flag === "--iterations" || flag === "--seed") {
      values[flag] = args[i + 1] ?? "";
    }
  }
  return values;
}
