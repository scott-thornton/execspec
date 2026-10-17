/**
 * `execspec probe`: deterministic differential conformance.
 * Generates deterministic inputs from the spec, sends them to every
 * implementation, and verifies all implementations agree.
 *
 * Verdict semantics (docs/verdicts.md):
 * - "N disagreements" means: for N of the generated inputs, at least two
 *   hosts produced semantically different outputs. The exact input and
 *   both output values are reported.
 * - "N failed (category)" means: N probes could not complete comparison.
 *   Each failure is classified (crash, decode, timeout, other) and
 *   reported with the operation, iteration, and category. Failed probes
 *   cause exit 1 (fail-closed): inability to verify agreement is not
 *   evidence of agreement.
 * - "0 disagreements, 0 failed" means: for the specific inputs generated
 *   by (digest, operation, iteration, seed), all hosts produced
 *   identical outputs. This is not a proof of general agreement; it is
 *   evidence bounded by the generator's coverage.
 */

import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import {
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
  OperationId,
  SemanticIRDocument,
  SemanticValue,
  TypeEnvironment,
  ValueType,
  TypeId,
} from "@execspec/core";
import { ConformanceError, spawnHost } from "@execspec/harness";
import type { HostCommand, HostProcess } from "@execspec/harness";
import type { CliIO } from "./index.js";

type ProbeFailureCategory = "crash" | "decode" | "timeout" | "other";

interface ProbeFailure {
  readonly operationId: string;
  readonly iteration: number;
  readonly hostIndex: number;
  readonly category: ProbeFailureCategory;
  readonly detail: string;
}

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
  io.writeOut(`seed: ${seedBase}, digest: ${digest.slice(0, 16)}...\n`);

  let totalProbes = 0;
  let disagreements = 0;
  const failures: ProbeFailure[] = [];

  const sortedOps = [...document.semantic.operations].sort((a, b) => compareByCodePoint(a.id, b.id));

  for (const operation of sortedOps) {
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
      if (validation.length > 0) continue;

      const encoded = encodeSemanticValue(input, operation.input, typeEnv);
      const outputs: SemanticValue[] = [];
      let failure: ProbeFailure | undefined;

      for (let h = 0; h < hostProcs.length; h++) {
        const host = hostProcs[h];
        if (host === undefined) { failure = { operationId: operation.id, iteration, hostIndex: h, category: "other", detail: "host unavailable" }; break; }
        try {
          const outputJson = await host.request(operation.id, encoded, 5000);
          const decodedOutput = decodeSemanticValue(outputJson, operation.output, typeEnv);
          if (decodedOutput.ok) {
            outputs.push(decodedOutput.value);
          } else {
            const issues = decodedOutput.issues.map((i) => `${i.path}: ${i.code}`).join("; ");
            failure = { operationId: operation.id, iteration, hostIndex: h, category: "decode", detail: `output failed validation: ${issues}` };
            break;
          }
        } catch (error) {
          const category: ProbeFailureCategory = error instanceof ConformanceError
            ? (error.kind === "HostCrashFailure" ? "crash"
              : error.kind === "OperationTimeoutFailure" ? "timeout"
              : "other")
            : "other";
          const detail = error instanceof Error ? error.message : String(error);
          failure = { operationId: operation.id, iteration, hostIndex: h, category, detail };
          break;
        }
      }

      totalProbes++;
      if (failure !== undefined) {
        failures.push(failure);
        continue;
      }

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

    for (const h of hostProcs) {
      await h.close().catch(() => undefined);
    }
  }

  // Summary with exact claims
  io.writeOut(`\n${totalProbes} probes, ${disagreements} disagreements, ${failures.length} failed\n`);

  if (failures.length > 0) {
    const byCategory = new Map<ProbeFailureCategory, number>();
    for (const f of failures) {
      byCategory.set(f.category, (byCategory.get(f.category) ?? 0) + 1);
    }
    io.writeOut(`\nfailures:\n`);
    for (const [category, count] of byCategory) {
      io.writeOut(`  ${category}: ${count}\n`);
    }
    for (const f of failures.slice(0, 10)) {
      io.writeOut(`  ${f.operationId} iter=${f.iteration} host=${f.hostIndex} [${f.category}]: ${f.detail}\n`);
    }
    if (failures.length > 10) {
      io.writeOut(`  ... and ${failures.length - 10} more\n`);
    }
    io.writeOut(`\nfail-closed: ${failures.length} probe(s) could not obtain comparable outputs.\n`);
    io.writeOut(`inability to verify agreement is not evidence of agreement.\n`);
  }

  if (disagreements === 0 && failures.length === 0) {
    io.writeOut(`\nall ${totalProbes} probes agreed across ${hosts.length} hosts.\n`);
    io.writeOut(`this establishes agreement for the tested inputs only; it is not a proof of general agreement.\n`);
  }

  return disagreements > 0 || failures.length > 0 ? 1 : 0;
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
      const decl = env.declarations.get(type.typeId as TypeId);
      if (decl === undefined) return stringValue("unknown");
      switch (decl.kind) {
        case "struct": {
          const fields = new Map<string, SemanticValue>();
          for (const field of decl.fields) {
            if (field.optional && nextRandom() % 3 === 0) continue;
            fields.set(field.name, genValue(field.type, env, depth + 1));
          }
          return structValue(decl.id, fields);
        }
        case "enum": {
          const caseName = decl.cases[nextRandom() % decl.cases.length] ?? decl.cases[0] ?? "unknown";
          return enumValue(decl.id, caseName);
        }
        case "union": {
          const chosen: { name: string; payload: ValueType } | undefined = decl.cases[nextRandom() % decl.cases.length] ?? decl.cases[0];
          if (chosen === undefined) return stringValue("no-case");
          if (chosen.payload.kind === "unit") {
            return unionValue(decl.id, chosen.name);
          }
          return unionValue(decl.id, chosen.name, genValue(chosen.payload, env, depth + 1));
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
