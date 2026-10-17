import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { runCli } from "../src/index.js";
import type { CliIO } from "../src/index.js";
import { decodeSemanticIRDocument } from "@execspec/core";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");

function bufferedIO(): { io: CliIO; out(): string; err(): string } {
  let out = "";
  let err = "";
  return {
    io: {
      writeOut(t: string) { out += t; },
      writeErr(t: string) { err += t; },
    },
    out: () => out,
    err: () => err,
  };
}


test("diff: same spec shows no differences", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-diff-"));
  const specPath = join(work, "v1.execspec.json");
  const compileIO = bufferedIO();
  await runCli(["compile", "--module", join(fixtures, "spec-module.mjs"), "--out", specPath], compileIO.io);

  const diffIO = bufferedIO();
  const code = await runCli(["diff", "--old", specPath, "--new", specPath], diffIO.io);
  assert.equal(code, 0);
  assert.match(diffIO.out(), /no differences/);
});

test("diff: different spec shows changes with BC markers", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-diff-"));
  const v1Path = join(work, "v1.execspec.json");
  const v2Path = join(work, "v2.execspec.json");

  await runCli(["compile", "--module", join(fixtures, "spec-module.mjs"), "--out", v1Path], bufferedIO().io);

  // Create a v2 that removes an operation (breaking)
  const v1 = JSON.parse(await readFile(v1Path, "utf8"));
  const v2 = {
    ...v1,
    semantic: {
      ...v1.semantic,
      operations: v1.semantic.operations.filter((op: { id: string }) => op.id !== "kv.get"),
    },
  };
  await writeFile(v2Path, JSON.stringify(v2), "utf8");

  const diffIO = bufferedIO();
  const code = await runCli(["diff", "--old", v1Path, "--new", v2Path], diffIO.io);
  assert.equal(code, 0);
  assert.match(diffIO.out(), /removed.*operation kv\.get/);
  assert.match(diffIO.out(), /BC/);
  assert.match(diffIO.out(), /1 breaking/);
});

test("compatible: same spec is compatible", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-compat-"));
  const specPath = join(work, "spec.execspec.json");
  await runCli(["compile", "--module", join(fixtures, "spec-module.mjs"), "--out", specPath], bufferedIO().io);

  const compatIO = bufferedIO();
  const code = await runCli(["compatible", "--old", specPath, "--new", specPath], compatIO.io);
  assert.equal(code, 0);
  assert.match(compatIO.out(), /compatible: yes/);
});

test("compatible: removed operation is breaking", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-compat-"));
  const v1Path = join(work, "v1.execspec.json");
  const v2Path = join(work, "v2.execspec.json");

  await runCli(["compile", "--module", join(fixtures, "spec-module.mjs"), "--out", v1Path], bufferedIO().io);
  const v1 = JSON.parse(await readFile(v1Path, "utf8"));
  const v2 = {
    ...v1,
    semantic: {
      ...v1.semantic,
      operations: v1.semantic.operations.slice(0, 1), // keep only first op
    },
  };
  await writeFile(v2Path, JSON.stringify(v2), "utf8");

  const compatIO = bufferedIO();
  const code = await runCli(["compatible", "--old", v1Path, "--new", v2Path], compatIO.io);
  assert.equal(code, 1);
  assert.match(compatIO.out(), /compatible: no/);
  assert.match(compatIO.out(), /breaking.*operation/);
});

test("compatible: added operation is non-breaking", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-compat-"));
  const v1Path = join(work, "v1.execspec.json");
  const v2Path = join(work, "v2.execspec.json");

  await runCli(["compile", "--module", join(fixtures, "spec-module.mjs"), "--out", v1Path], bufferedIO().io);
  const v1 = JSON.parse(await readFile(v1Path, "utf8"));
  // Add a new operation (non-breaking)
  const newOp = {
    id: "kv.new-op",
    input: { kind: "unit" },
    output: { kind: "string" },
  };
  const v2 = {
    ...v1,
    semantic: {
      ...v1.semantic,
      operations: [...v1.semantic.operations, newOp],
    },
  };
  await writeFile(v2Path, JSON.stringify(v2), "utf8");

  const compatIO = bufferedIO();
  const code = await runCli(["compatible", "--old", v1Path, "--new", v2Path], compatIO.io);
  assert.equal(code, 0);
  assert.match(compatIO.out(), /compatible: yes/);
});

test("compatible: removed scenario is breaking (behavioral guarantee lost)", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-compat-"));
  const v1Path = join(work, "v1.execspec.json");
  const v2Path = join(work, "v2.execspec.json");

  await runCli(["compile", "--module", join(fixtures, "spec-module.mjs"), "--out", v1Path], bufferedIO().io);
  const v1 = JSON.parse(await readFile(v1Path, "utf8"));
  const v2 = {
    ...v1,
    semantic: {
      ...v1.semantic,
      scenarios: [], // will be rejected by IR validation (must have >=1)
    },
  };
  await writeFile(v2Path, JSON.stringify(v2), "utf8");

  const compatIO = bufferedIO();
  const code = await runCli(["compatible", "--old", v1Path, "--new", v2Path], compatIO.io);
  assert.equal(code, 1); // exits 1 either way (can't load or incompatible)
});

test("diff: missing flags exit 2", async () => {
  const io = bufferedIO();
  assert.equal(await runCli(["diff"], io.io), 2);
  assert.equal(await runCli(["compatible"], io.io), 2);
});

test("probe: requires at least two hosts", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-probe-"));
  const specPath = join(work, "spec.execspec.json");
  await runCli(["compile", "--module", join(fixtures, "spec-module.mjs"), "--out", specPath], bufferedIO().io);

  const probeIO = bufferedIO();
  const code = await runCli(["probe", "--ir", specPath, "--host", "/bin/true"], probeIO.io);
  assert.equal(code, 2);
  assert.match(probeIO.err(), /at least two --host/);
});
