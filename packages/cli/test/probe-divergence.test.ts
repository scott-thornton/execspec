import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";

import { runCli } from "../src/index.js";
import type { CliIO } from "../src/index.js";

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

async function compile(modulePath: string, work: string, name: string): Promise<string> {
  const outPath = join(work, `${name}.execspec.json`);
  await runCli(["compile", "--module", modulePath, "--out", outPath], bufferedIO().io);
  return outPath;
}

// --- Probe: disagreement detection (the core feature) ---

test("probe: detects disagreement between correct and wrong hosts", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-probe-div-"));
  const specPath = await compile(join(fixtures, "spec-module.mjs"), work, "spec");

  const io = bufferedIO();
  const code = await runCli([
    "probe", "--ir", specPath,
    "--host", join(fixtures, "echo-host.mjs"),
    "--host", join(fixtures, "wrong-output-host.mjs"),
    "--iterations", "10",
  ], io.io);

  assert.equal(code, 1, `expected exit 1, got ${code}, output: ${io.out()}`);
  assert.match(io.out(), /DISAGREEMENT/);
  assert.match(io.out(), /host\[0\]/);
  assert.match(io.out(), /host\[1\]/);
  assert.match(io.out(), /input:/);
  assert.match(io.out(), /[1-9]\d* disagreements/);
});

test("probe: disagreement output shows divergent values and the input", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-probe-div-"));
  const specPath = await compile(join(fixtures, "spec-module.mjs"), work, "spec");

  const io = bufferedIO();
  await runCli([
    "probe", "--ir", specPath,
    "--host", join(fixtures, "echo-host.mjs"),
    "--host", join(fixtures, "wrong-output-host.mjs"),
    "--iterations", "10",
  ], io.io);

  const blocks = io.out().split("DISAGREEMENT:").slice(1);
  assert.ok(blocks.length > 0, `should have disagreements, output: ${io.out()}`);
  for (const block of blocks) {
    assert.match(block, /host\[0\]:/, "shows first host output");
    assert.match(block, /host\[1\]:/, "shows second host output");
    assert.match(block, /input:/, "shows the input that caused divergence");
  }
});

test("probe: same host always agrees with itself", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-probe-div-"));
  const specPath = await compile(join(fixtures, "spec-module.mjs"), work, "spec");

  const io = bufferedIO();
  await runCli([
    "probe", "--ir", specPath,
    "--host", join(fixtures, "echo-host.mjs"),
    "--host", join(fixtures, "echo-host.mjs"),
    "--iterations", "10",
  ], io.io);
  assert.match(io.out(), /0 disagreements/);
});

// --- Compatibility: type-level changes via compiled spec pairs ---

test("compatible: adding an optional field is non-breaking", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-compat-"));
  const v1Path = await compile(join(fixtures, "spec-module.mjs"), work, "v1");
  const v2Path = await compile(join(fixtures, "spec-v2-compatible.mjs"), work, "v2");

  const io = bufferedIO();
  const code = await runCli(["compatible", "--old", v1Path, "--new", v2Path], io.io);
  assert.equal(code, 0, io.out());
  assert.match(io.out(), /compatible: yes/);
});

test("compatible: adding a required field is breaking", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-compat-"));
  const v1Path = await compile(join(fixtures, "spec-module.mjs"), work, "v1");
  const v2Path = await compile(join(fixtures, "spec-v2-breaking.mjs"), work, "v2");

  const io = bufferedIO();
  const code = await runCli(["compatible", "--old", v1Path, "--new", v2Path], io.io);
  assert.equal(code, 1, io.out());
  assert.match(io.out(), /compatible: no/);
  assert.match(io.out(), /breaking/);
});

test("compatible: removing an operation is breaking", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-compat-"));
  const v1Path = await compile(join(fixtures, "spec-module.mjs"), work, "v1");
  // Compile a spec that has fewer operations (use the v2 spec which has the same ops)
  // Instead create a minimal spec with only one operation
  const v2Path = await compile(join(fixtures, "spec-echo-only.mjs"), work, "v2-minimal");

  const io = bufferedIO();
  const code = await runCli(["compatible", "--old", v1Path, "--new", v2Path], io.io);
  assert.equal(code, 1, io.out());
  assert.match(io.out(), /compatible: no/);
  assert.match(io.out(), /operation kv\.get.*removed/);
});

test("diff: shows field addition and required/optional distinction", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-diff-"));
  const v1Path = await compile(join(fixtures, "spec-module.mjs"), work, "v1");
  const v2Path = await compile(join(fixtures, "spec-v2-compatible.mjs"), work, "v2");

  const io = bufferedIO();
  const code = await runCli(["diff", "--old", v1Path, "--new", v2Path], io.io);
  assert.equal(code, 0);
  assert.match(io.out(), /added.*nickname.*optional/);
  assert.match(io.out(), /0 breaking/);
});
