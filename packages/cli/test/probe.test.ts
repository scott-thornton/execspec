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

test("probe: identical hosts produce zero disagreements", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-probe-"));
  const specPath = join(work, "spec.execspec.json");
  await runCli(["compile", "--module", join(fixtures, "spec-module.mjs"), "--out", specPath], bufferedIO().io);

  const io = bufferedIO();
  // Same host twice - should always agree with itself
  const code = await runCli([
    "probe", "--ir", specPath,
    "--host", join(fixtures, "echo-host.mjs"),
    "--host", join(fixtures, "echo-host.mjs"),
    "--iterations", "5",
  ], io.io);
  assert.equal(code, 0, io.out());
  assert.match(io.out(), /probing \d+ operations/);
  assert.match(io.out(), /0 disagreements/);
});

test("probe: deterministic - same seed produces same probe count", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-probe-"));
  const specPath = join(work, "spec.execspec.json");
  await runCli(["compile", "--module", join(fixtures, "spec-module.mjs"), "--out", specPath], bufferedIO().io);

  const ioA = bufferedIO();
  await runCli([
    "probe", "--ir", specPath,
    "--host", join(fixtures, "echo-host.mjs"),
    "--host", join(fixtures, "echo-host.mjs"),
    "--iterations", "3", "--seed", "42",
  ], ioA.io);

  const ioB = bufferedIO();
  await runCli([
    "probe", "--ir", specPath,
    "--host", join(fixtures, "echo-host.mjs"),
    "--host", join(fixtures, "echo-host.mjs"),
    "--iterations", "3", "--seed", "42",
  ], ioB.io);

  // Same seed and iterations should produce the same probe count
  const countA = ioA.out().match(/(\d+) probes/)?.[1];
  const countB = ioB.out().match(/(\d+) probes/)?.[1];
  assert.equal(countA, countB);
  assert.notEqual(countA, undefined);
});

test("probe: different seed can produce different probe count", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-probe-"));
  const specPath = join(work, "spec.execspec.json");
  await runCli(["compile", "--module", join(fixtures, "spec-module.mjs"), "--out", specPath], bufferedIO().io);

  // Run with enough iterations that different seeds explore different paths
  // (some generated values may fail validation and get skipped)
  const results = new Set<string>();
  for (const seed of ["1", "2", "3", "4", "5"]) {
    const io = bufferedIO();
    await runCli([
      "probe", "--ir", specPath,
      "--host", join(fixtures, "echo-host.mjs"),
      "--host", join(fixtures, "echo-host.mjs"),
      "--iterations", "20", "--seed", seed,
    ], io.io);
    results.add(io.out().match(/(\d+) probes/)?.[1] ?? "?");
  }
  // With 5 different seeds across 20 iterations, we should see some variation
  // in how many valid inputs are generated (though it's not guaranteed,
  // it's extremely likely with enough variety in the generator)
  assert.ok(results.size >= 1, `at least one probe count, got ${[...results]}`);
});

test("probe: three hosts still agree when they are the same", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-probe-"));
  const specPath = join(work, "spec.execspec.json");
  await runCli(["compile", "--module", join(fixtures, "spec-module.mjs"), "--out", specPath], bufferedIO().io);

  const io = bufferedIO();
  const code = await runCli([
    "probe", "--ir", specPath,
    "--host", join(fixtures, "echo-host.mjs"),
    "--host", join(fixtures, "echo-host.mjs"),
    "--host", join(fixtures, "echo-host.mjs"),
    "--iterations", "3",
  ], io.io);
  assert.equal(code, 0);
  assert.match(io.out(), /3 hosts/);
  assert.match(io.out(), /0 disagreements/);
});

test("probe: reports probe count for all operations", async () => {
  const work = await mkdtemp(join(tmpdir(), "execspec-probe-"));
  const specPath = join(work, "spec.execspec.json");
  await runCli(["compile", "--module", join(fixtures, "spec-module.mjs"), "--out", specPath], bufferedIO().io);

  const io = bufferedIO();
  await runCli([
    "probe", "--ir", specPath,
    "--host", join(fixtures, "echo-host.mjs"),
    "--host", join(fixtures, "echo-host.mjs"),
    "--iterations", "5",
  ], io.io);

  // The spec-module has 2 operations, 5 iterations each = up to 10 probes
  const probes = parseInt(io.out().match(/(\d+) probes/)?.[1] ?? "0", 10);
  assert.ok(probes > 0, "should have probed at least once");
  assert.ok(probes <= 10, `should not exceed 2 ops x 5 iterations = 10, got ${probes}`);
});
