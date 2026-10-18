#!/usr/bin/env node
/**
 * execspec CLI (plan Tasks 34-37). No parsing dependency; unknown
 * commands exit 2, validation failures exit 1.
 */

import { pathToFileURL } from "node:url";
import { compileCommand } from "./compile-command.js";
import { generateSwiftCommand } from "./generate-swift-command.js";
import { generateTypescriptCommand } from "./generate-typescript-command.js";
import { testCommand } from "./test-command.js";
import { initCommand } from "./init-command.js";
import { diffCommand, compatibleCommand } from "./compatibility-command.js";
import { probeCommand } from "./property-command.js";
import { importCommand } from "./import-command.js";

export interface CliIO {
  writeOut(text: string): void;
  writeErr(text: string): void;
}

export const defaultIO: CliIO = {
  writeOut(text: string): void {
    process.stdout.write(text);
  },
  writeErr(text: string): void {
    process.stderr.write(text);
  },
};

const USAGE = `usage:
  execspec init --name <package-name> --out <directory>
  execspec compile --module <spec.js> --out <file.execspec.json>
  execspec generate swift --ir <file.execspec.json> --out <dir>
  execspec generate typescript --ir <file.execspec.json> --out <dir>
  execspec test --ir <file.execspec.json> --host <executable> [--timeout-ms <n>]
`;

export async function runCli(argv: readonly string[], io: CliIO = defaultIO): Promise<number> {
  const [command, ...rest] = argv;
  if (command === undefined) {
    io.writeErr(USAGE);
    return 2;
  }
  if (command === "compile") {
    return await compileCommand(rest, io);
  }
  if (command === "generate" && rest[0] === "swift") {
    return await generateSwiftCommand(rest.slice(1), io);
  }
  if (command === "generate" && rest[0] === "typescript") {
    return await generateTypescriptCommand(rest.slice(1), io);
  }
  if (command === "test") {
    return await testCommand(rest, io);
  }
  if (command === "init") {
    return await initCommand(rest, io);
  }
  if (command === "diff") {
    return await diffCommand(rest, io);
  }
  if (command === "compatible") {
    return await compatibleCommand(rest, io);
  }
  if (command === "probe") {
    return await probeCommand(rest, io);
  }
  if (command === "import") {
    return await importCommand(rest, io);
  }
  io.writeErr(`unknown command: ${command}\n${USAGE}`);
  return 2;
}

async function main(): Promise<void> {
  const exitCode = await runCli(process.argv.slice(2));
  process.exit(exitCode);
}

const invokedDirectly = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedDirectly) {
  void main();
}
