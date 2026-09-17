/**
 * Host process abstraction (plan Task 30). One scenario = one host
 * process; stderr is captured bounded; timeouts are enforced; crashes
 * and protocol violations are typed failures.
 */

import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import type { OperationId } from "@execspec/core";
import type { JSONValue } from "@execspec/core";
import { LineReader } from "./line-reader.js";
import {
  PROTOCOL_VERSION,
  WIRE_TARGET,
  decodeHostMessage,
  encodeHello,
  encodeRequest,
} from "./protocol.js";
import { ConformanceError } from "./failures.js";

const STDERR_LIMIT = 1024 * 1024;
const STDERR_HALF = 512 * 1024;
const SHUTDOWN_GRACE_MS = 1000;

export interface HostCommand {
  readonly executable: string;
  readonly args: readonly string[];
  readonly cwd?: string;
  readonly env?: Readonly<Record<string, string>>;
}

export interface HostProcess {
  handshake(expectedDigest: string, timeoutMs: number): Promise<void>;
  request(
    operationId: OperationId,
    input: JSONValue,
    timeoutMs: number,
  ): Promise<JSONValue>;
  close(): Promise<void>;
  stderrExcerpt(): string;
}

class BoundedStderr {
  private head: Buffer = Buffer.alloc(0);
  private tail: Buffer = Buffer.alloc(0);
  private dropped = 0;
  private total = 0;

  public append(chunk: Buffer): void {
    this.total += chunk.length;
    const remainingHead = Math.max(0, STDERR_HALF - this.head.length);
    if (remainingHead > 0) {
      this.head = Buffer.concat([this.head, chunk.subarray(0, remainingHead)]);
    }
    this.tail = Buffer.concat([this.tail, chunk]).subarray(-STDERR_HALF);
    if (this.total > STDERR_LIMIT) {
      this.dropped = this.total - STDERR_LIMIT;
    }
  }

  public excerpt(): string {
    const parts: string[] = [];
    if (this.dropped > 0) {
      parts.push(`[${this.dropped} bytes dropped]`);
      parts.push(this.head.toString("utf8"));
      parts.push("…");
      parts.push(this.tail.toString("utf8"));
    } else {
      parts.push(Buffer.concat([this.head, this.tail]).subarray(0, this.total).toString("utf8"));
    }
    return parts.join("\n").slice(0, 4000);
  }
}

export function spawnHost(command: HostCommand): Promise<HostProcess> {
  return new Promise<HostProcess>((resolve, reject) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(command.executable, [...command.args], {
        cwd: command.cwd,
        env: command.env === undefined ? process.env : { ...process.env, ...command.env },
        stdio: ["pipe", "pipe", "pipe"],
      }) as ChildProcessWithoutNullStreams;
    } catch (error) {
      reject(
        new ConformanceError(
          "HostCrashFailure",
          `failed to spawn host: ${error instanceof Error ? error.message : String(error)}`,
        ),
      );
      return;
    }

    const stderr = new BoundedStderr();
    const reader = new LineReader(child.stdout);
    let exitCode: number | null = null;
    let spawnFailed = false;
    let nextRequestId = 0;

    child.stderr.on("data", (chunk: Buffer) => {
      stderr.append(chunk);
    });

    const exitPromise = new Promise<number | null>((resolveExit) => {
      child.on("error", (error: Error) => {
        spawnFailed = true;
        exitCode = -1;
        stderr.append(Buffer.from(`spawn error: ${error.message}\n`, "utf8"));
        resolveExit(-1);
      });
      child.on("close", (code) => {
        exitCode = code;
        resolveExit(code ?? -1);
      });
    });

    const readLine = (timeoutMs: number): Promise<string | null> => {
      const linePromise = reader.next();
      const timer = new Promise<never>((_, rejectTimer) => {
        setTimeout(() => {
          rejectTimer(new ConformanceError("OperationTimeoutFailure", `no response within ${timeoutMs} ms`));
        }, timeoutMs).unref();
      });
      const crash = exitPromise.then((code) => {
        throw new ConformanceError(
          "HostCrashFailure",
          `host exited with code ${code} before responding`,
          stderr.excerpt(),
        );
      });
      const result = Promise.race([linePromise, timer, crash]);
      // Avoid unhandled rejections from the losers of the race.
      for (const loser of [linePromise, timer, crash]) {
        void loser.catch(() => undefined);
      }
      return result;
    };

    const writeLine = (line: string): void => {
      child.stdin.write(`${line}\n`);
    };

    child.on("spawn", () => {
      resolve({
        handshake(expectedDigest: string, timeoutMs: number): Promise<void> {
          if (spawnFailed) {
            return Promise.reject(
              new ConformanceError("HostCrashFailure", "host failed to spawn", stderr.excerpt()),
            );
          }
          writeLine(encodeHello(expectedDigest));
          return (async () => {
            const line = await readLine(timeoutMs);
            if (line === null) {
              throw new ConformanceError(
                "HandshakeFailure",
                `host closed stdout before helloAck (exit ${exitCode ?? "unknown"})`,
                stderr.excerpt(),
              );
            }
            let json: unknown;
            try {
              json = JSON.parse(line);
            } catch {
              throw new ConformanceError("HandshakeFailure", `helloAck is not JSON: ${line.slice(0, 200)}`);
            }
            const decoded = decodeHostMessage(json);
            if (!decoded.ok) {
              throw new ConformanceError("HandshakeFailure", `helloAck rejected: ${decoded.error}`);
            }
            const message = decoded.message;
            if (message.kind !== "helloAck") {
              throw new ConformanceError(
                "HandshakeFailure",
                `expected helloAck, got '${message.kind}'`,
                stderr.excerpt(),
              );
            }
            if (message.protocolVersion !== PROTOCOL_VERSION) {
              throw new ConformanceError(
                "HandshakeFailure",
                `protocol version mismatch: harness ${PROTOCOL_VERSION}, host ${message.protocolVersion}`,
              );
            }
            if (message.specificationDigest !== expectedDigest) {
              throw new ConformanceError(
                "HandshakeFailure",
                `specification digest mismatch: harness ${expectedDigest}, host ${message.specificationDigest}`,
              );
            }
            if (message.target !== WIRE_TARGET) {
              throw new ConformanceError(
                "HandshakeFailure",
                `unexpected target '${message.target}', expected '${WIRE_TARGET}'`,
              );
            }
          })();
        },
        request(operationId: OperationId, input: JSONValue, timeoutMs: number): Promise<JSONValue> {
          const id = String(++nextRequestId);
          writeLine(encodeRequest(id, operationId, input));
          return (async () => {
            const line = await readLine(timeoutMs);
            if (line === null) {
              throw new ConformanceError(
                "HostCrashFailure",
                `host closed stdout before responding (exit ${exitCode ?? "unknown"})`,
                stderr.excerpt(),
              );
            }
            let json: unknown;
            try {
              json = JSON.parse(line);
            } catch {
              throw new ConformanceError("ProtocolFailure", `response is not JSON: ${line.slice(0, 200)}`);
            }
            const decoded = decodeHostMessage(json);
            if (!decoded.ok) {
              throw new ConformanceError("ProtocolFailure", decoded.error, stderr.excerpt());
            }
            const message = decoded.message;
            if (message.kind === "response") {
              if (message.id !== id) {
                throw new ConformanceError(
                  "ProtocolFailure",
                  `response id mismatch: expected '${id}', got '${message.id}'`,
                  stderr.excerpt(),
                );
              }
              return message.output;
            }
            if (message.kind !== "failure") {
              throw new ConformanceError("ProtocolFailure", `unexpected message '${message.kind}'`);
            }
            if (message.id !== id) {
              throw new ConformanceError(
                "ProtocolFailure",
                `failure id mismatch: expected '${id}', got '${message.id}'`,
                stderr.excerpt(),
              );
            }
            if (message.category === "implementationException") {
              throw new ConformanceError(
                "ImplementationExceptionFailure",
                `implementation threw: ${message.message}`,
                stderr.excerpt(),
              );
            }
            throw new ConformanceError(
              "ProtocolFailure",
              `host reported '${message.category}': ${message.message}`,
              stderr.excerpt(),
            );
          })();
        },
        async close(): Promise<void> {
          child.stdin.end();
          const graceful = await Promise.race([
            exitPromise.then(() => true),
            new Promise<false>((resolveGrace) => {
              setTimeout(() => {
                resolveGrace(false);
              }, SHUTDOWN_GRACE_MS).unref();
            }),
          ]);
          if (!graceful) {
            child.kill("SIGKILL");
            await exitPromise;
            throw new ConformanceError(
              "HostShutdownFailure",
              `host did not exit within ${SHUTDOWN_GRACE_MS} ms of stdin close`,
              stderr.excerpt(),
            );
          }
          reader.close();
        },
        stderrExcerpt(): string {
          return stderr.excerpt();
        },
      });
    });

    child.on("error", (error: Error) => {
      // Spawn-time failures (ENOENT): surface to the pending spawnHost promise.
      reject(
        new ConformanceError(
          "HostCrashFailure",
          `failed to spawn host '${command.executable}': ${error.message}`,
        ),
      );
    });
  });
}
