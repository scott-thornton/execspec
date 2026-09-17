/**
 * TS host runtime (docs/protocol-v1.md): NDJSON over stdin/stdout, 16
 * MiB lines, strict JSON, digest-gated handshake, sequential requests.
 * Mirrors the Swift runtime's HostLoop exactly.
 */

import { strictParseJSON } from "./strict-json.js";
import type { WireValue } from "./strict-json.js";

export { strictParseJSON } from "./strict-json.js";
export type { WireValue } from "./strict-json.js";

export const PROTOCOL_VERSION = 1;
export const HOST_TARGET = "typescript";
const MAX_LINE_BYTES = 16 * 1024 * 1024;

/** Failures reported as `failure` messages, never implementation
 *  exceptions. */
export class ExecSpecHostFailure extends Error {
  public readonly category: "invalidRequest" | "protocolViolation";

  public constructor(category: "invalidRequest" | "protocolViolation", message: string) {
    super(message);
    this.name = "ExecSpecHostFailure";
    this.category = category;
  }
}

export interface ExecSpecDispatcherLike {
  readonly specificationDigest: string;
  dispatch(operation: string, input: WireValue): Promise<WireValue> | WireValue;
}

function writeLine(value: WireValue): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

function writeFailure(id: string, category: string, message: string): void {
  try {
    writeLine({ kind: "failure", id, category, message });
  } catch {
    // stdout gone; nothing more to do
  }
}

function describeError(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function expectObject(value: WireValue, keys: readonly string[], scope: string): { [key: string]: WireValue } {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${scope}: expected a JSON object`);
  }
  const present = Object.keys(value);
  if (present.length !== keys.length || !keys.every((key) => key in value)) {
    throw new Error(`${scope}: expected exactly fields ${keys.join(", ")}`);
  }
  return value;
}

/** Blocking line iterator over stdin; enforces the protocol framing. */
async function* readStdinLines(): AsyncGenerator<string> {
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer: Uint8Array = Buffer.alloc(0);
  for await (const chunk of process.stdin) {
    const data = chunk as Buffer;
    buffer = buffer.length === 0 ? data : Buffer.concat([buffer, data]);
    for (;;) {
      const newline = buffer.indexOf(0x0a);
      if (newline < 0) {
        break;
      }
      let line = buffer.subarray(0, newline);
      if (line.length > 0 && line[line.length - 1] === 0x0d) {
        line = line.subarray(0, line.length - 1);
      }
      if (line.length > MAX_LINE_BYTES) {
        throw new Error(`line exceeds ${MAX_LINE_BYTES} bytes`);
      }
      const text = decoder.decode(line);
      buffer = buffer.subarray(newline + 1);
      yield text;
    }
    if (buffer.length > MAX_LINE_BYTES) {
      throw new Error(`line exceeds ${MAX_LINE_BYTES} bytes`);
    }
  }
  if (buffer.length > 0) {
    throw new Error("partial NDJSON message at EOF");
  }
}

export async function runExecSpecHost(dispatcher: ExecSpecDispatcherLike): Promise<void> {
  const lines = readStdinLines();
  // --- Handshake ---
  let hello: { kind: string; protocolVersion: number; specificationDigest: string };
  try {
    const first = await lines.next();
    if (first.done || first.value === undefined) {
      process.stderr.write("execspec host: EOF before hello\n");
      process.exit(1);
    }
    const raw = strictParseJSON(first.value);
    const object = expectObject(raw, ["kind", "protocolVersion", "specificationDigest"], "hello");
    if (object.kind !== "hello") {
      throw new Error("hello: wrong kind");
    }
    if (typeof object.protocolVersion !== "number" || typeof object.specificationDigest !== "string") {
      throw new Error("hello: wrong field types");
    }
    hello = { kind: "hello", protocolVersion: object.protocolVersion, specificationDigest: object.specificationDigest };
  } catch (error) {
    process.stderr.write(`execspec host: handshake failure: ${describeError(error)}\n`);
    process.exit(1);
  }
  if (hello.protocolVersion !== PROTOCOL_VERSION) {
    process.stderr.write(
      `execspec host: protocol version mismatch (harness ${hello.protocolVersion}, host ${PROTOCOL_VERSION})\n`,
    );
    process.exit(1);
  }
  if (hello.specificationDigest !== dispatcher.specificationDigest) {
    process.stderr.write("execspec host: specification digest mismatch\n");
    process.exit(1);
  }
  writeLine({
    kind: "helloAck",
    protocolVersion: PROTOCOL_VERSION,
    specificationDigest: dispatcher.specificationDigest,
    target: HOST_TARGET,
  });

  // --- Sequential request loop ---
  for (;;) {
    let text: string | undefined;
    try {
      const next = await lines.next();
      if (next.done) {
        process.exit(0);
      }
      text = next.value;
    } catch (error) {
      process.stderr.write(`execspec host: read failure: ${describeError(error)}\n`);
      writeFailure("", "protocolViolation", describeError(error));
      process.exit(1);
    }
    let raw: WireValue;
    try {
      raw = strictParseJSON(text);
    } catch (error) {
      writeFailure("", "protocolViolation", describeError(error));
      continue;
    }
    let request: { id: string; operation: string; input: WireValue };
    try {
      const object = expectObject(raw, ["kind", "id", "operation", "input"], "request");
      if (object.kind !== "request"
        || typeof object.id !== "string" || typeof object.operation !== "string") {
        throw new Error("request: wrong field types");
      }
      const input: WireValue | undefined = object.input;
      if (input === undefined) {
        throw new Error("request: missing input");
      }
      request = { id: object.id, operation: object.operation, input };
    } catch (error) {
      writeFailure("", "protocolViolation", describeError(error));
      continue;
    }
    try {
      const output = await dispatcher.dispatch(request.operation, request.input);
      writeLine({ kind: "response", id: request.id, output });
    } catch (error) {
      if (error instanceof ExecSpecHostFailure) {
        writeFailure(request.id, error.category, error.message);
      } else {
        writeFailure(request.id, "implementationException", describeError(error));
      }
    }
  }
}
