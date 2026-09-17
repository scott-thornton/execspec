import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  structDeclaration,
  unionDeclaration,
  stringType,
  unitType,
  refType,
  structValue,
  stringValue,
  unionValue,
} from "@execspec/core";
import type { OperationId, ScenarioId, SemanticIRDocument } from "@execspec/core";
import { spawnHost } from "../src/host-process.js";
import { runScenario } from "../src/runner.js";
import { ConformanceError } from "../src/failures.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function fixtureHost(name: string) {
  return {
    executable: process.execPath,
    args: [join(fixtures, name)],
  };
}

function kvDocument(): SemanticIRDocument {
  const semantic = {
    specificationName: "kv",
    specificationVersion: "0.1.0",
    types: [
      structDeclaration("PutRequest", [
        { name: "key", type: stringType(), optional: false },
        { name: "value", type: stringType(), optional: false },
      ]),
      structDeclaration("GetRequest", [{ name: "key", type: stringType(), optional: false }]),
      unionDeclaration("GetResult", [
        { name: "found", payload: stringType() },
        { name: "missing", payload: unitType() },
      ]),
    ],
    operations: [
      { id: "kv.put" as OperationId, input: refType("PutRequest"), output: unitType() },
      { id: "kv.get" as OperationId, input: refType("GetRequest"), output: refType("GetResult") },
    ],
    scenarios: [
      {
        id: "kv.put.then-get" as ScenarioId,
        description: "a stored value can subsequently be read",
        steps: [
          {
            kind: "call" as const,
            binding: "put",
            operationId: "kv.put" as OperationId,
            input: {
              kind: "literal" as const,
              value: structValue("PutRequest", new Map([
                ["key", stringValue("a")],
                ["value", stringValue("one")],
              ])),
            },
          },
          {
            kind: "call" as const,
            binding: "get",
            operationId: "kv.get" as OperationId,
            input: {
              kind: "literal" as const,
              value: structValue("GetRequest", new Map([["key", stringValue("a")]])),
            },
          },
          {
            kind: "expectEqual" as const,
            actual: { kind: "binding" as const, binding: "get" },
            expected: {
              kind: "literal" as const,
              value: unionValue("GetResult", "found", stringValue("one")),
            },
          },
        ],
      },
    ],
  };
  return { format: "execspec", irVersion: 1, semantic, metadata: { sourceLocations: {} } } as SemanticIRDocument;
}

test("a conforming host passes the scenario end to end", async () => {
  const result = await runScenario(kvDocument(), kvDocument().semantic.scenarios[0]!, {
    hostCommand: fixtureHost("good-host.mjs"),
    timeoutMs: 5000,
  });
  assert.equal(result.status, "pass");
});

test("an incorrect host fails with the exact semantic path", async () => {
  const result = await runScenario(kvDocument(), kvDocument().semantic.scenarios[0]!, {
    hostCommand: fixtureHost("broken-host.mjs"),
    timeoutMs: 5000,
  });
  assert.equal(result.status, "fail");
  assert.equal(result.failure?.kind, "ExpectationFailure");
  assert.equal(result.failure?.stepIndex, 3);
  const diff = result.failure?.diffs?.[0];
  assert.equal(diff?.path, "$.value");
  assert.equal(diff && diff.expected.kind === "string" ? diff.expected.value : undefined, "one");
  assert.equal(diff && diff.actual.kind === "string" ? diff.actual.value : undefined, "first");
});

test("handshake rejects a stale digest before any operation runs", async () => {
  const document = kvDocument();
  const scenario = document.semantic.scenarios[0];
  if (scenario === undefined) {
    throw new Error("fixture scenario missing");
  }
  const result = await runScenario(document, scenario, {
    hostCommand: fixtureHost("stale-host.mjs"),
    timeoutMs: 5000,
  });
  assert.equal(result.status, "fail");
  assert.equal(result.failure?.kind, "HandshakeFailure");
  assert.match(result.failure?.message ?? "", /digest mismatch/);
});

test("crashes, timeouts, and garbage output map to failure classes", async () => {
  const document = kvDocument();
  const scenario = document.semantic.scenarios[0];
  if (scenario === undefined) {
    throw new Error("fixture scenario missing");
  }
  const crash = await runScenario(document, scenario, {
    hostCommand: fixtureHost("crash-host.mjs"),
    timeoutMs: 5000,
  });
  assert.equal(crash.failure?.kind, "HostCrashFailure");

  const timeout = await runScenario(document, scenario, {
    hostCommand: fixtureHost("hang-host.mjs"),
    timeoutMs: 250,
  });
  assert.equal(timeout.failure?.kind, "OperationTimeoutFailure");

  const garbage = await runScenario(document, scenario, {
    hostCommand: fixtureHost("garbage-host.mjs"),
    timeoutMs: 5000,
  });
  assert.equal(garbage.failure?.kind, "ProtocolFailure");
});

test("stderr diagnostics never corrupt the protocol stream", async () => {
  const host = await spawnHost(fixtureHost("stderr-host.mjs"));
  await host.handshake("d".repeat(64), 5000);
  const output = await host.request("kv.echo" as OperationId, { key: "a" }, 5000);
  assert.deepEqual(output, { key: "a" });
  const excerpt = host.stderrExcerpt();
  assert.match(excerpt, /booting fixture/);
  await host.close();
});

test("hosts that ignore stdin close are killed and reported", async () => {
  const host = await spawnHost(fixtureHost("immortal-host.mjs"));
  await host.handshake("d".repeat(64), 5000);
  await assert.rejects(
    () => host.close(),
    (error: unknown) => {
      assert.ok(error instanceof ConformanceError);
      assert.equal(error.kind, "HostShutdownFailure");
      return true;
    },
  );
});

test("protocol robustness: id mismatch, invalid output, version mismatch", async () => {
  const document = kvDocument();
  const scenario = document.semantic.scenarios[0];
  if (scenario === undefined) {
    throw new Error("fixture scenario missing");
  }
  const idMismatch = await runScenario(document, scenario, {
    hostCommand: fixtureHost("id-mismatch-host.mjs"),
    timeoutMs: 5000,
  });
  assert.equal(idMismatch.failure?.kind, "ProtocolFailure");
  assert.match(idMismatch.failure?.message ?? "", /id mismatch/);

  const invalidOutput = await runScenario(document, scenario, {
    hostCommand: fixtureHost("invalid-output-host.mjs"),
    timeoutMs: 5000,
  });
  assert.equal(invalidOutput.failure?.kind, "InvalidOutputFailure");
  assert.match(invalidOutput.failure?.message ?? "", /invalidUnionCase/);

  const versionMismatch = await runScenario(document, scenario, {
    hostCommand: fixtureHost("version-mismatch-host.mjs"),
    timeoutMs: 5000,
  });
  assert.equal(versionMismatch.failure?.kind, "HandshakeFailure");
  assert.match(versionMismatch.failure?.message ?? "", /protocol version mismatch/);
});

test("spawn failures are typed", async () => {
  await assert.rejects(
    () => spawnHost({ executable: "/nonexistent/execspec-host", args: [] }),
    (error: unknown) => {
      assert.ok(error instanceof ConformanceError);
      assert.equal(error.kind, "HostCrashFailure");
      return true;
    },
  );
});
