/**
 * Bounded streaming line reader (plan Task 29). Splits a byte stream on
 * LF without waiting for process completion; enforces the 16 MiB line
 * limit; strictly decodes UTF-8; treats a trailing partial line at EOF
 * as a protocol failure; strips only one terminal LF plus optional CR.
 */

import type { Readable } from "node:stream";

export const MAX_LINE_BYTES_DEFAULT = 16 * 1024 * 1024;

export type LineReaderErrorKind = "lineTooLong" | "invalidUTF8" | "partialLineAtEOF";

export class LineReaderError extends Error {
  public readonly kind: LineReaderErrorKind;
  public constructor(kind: LineReaderErrorKind, message: string) {
    super(message);
    this.name = "LineReaderError";
    this.kind = kind;
  }
}

interface Waiter {
  readonly resolve: (line: string | null) => void;
  readonly reject: (error: Error) => void;
}

export class LineReader {
  private readonly stream: Readable;
  private readonly maxLineBytes: number;
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private pending: Buffer = Buffer.alloc(0);
  private readonly lines: string[] = [];
  private waiter: Waiter | undefined;
  private eof = false;
  private failure: LineReaderError | undefined;
  private closed = false;

  public constructor(stream: Readable, maxLineBytes: number = MAX_LINE_BYTES_DEFAULT) {
    this.stream = stream;
    this.maxLineBytes = maxLineBytes;
    stream.on("data", (chunk: Buffer) => {
      this.onData(chunk);
    });
    stream.on("end", () => {
      this.onEnd();
    });
    stream.on("error", (error: Error) => {
      this.fail(new LineReaderError("partialLineAtEOF", `stream error: ${error.message}`));
    });
  }

  /** Next decoded line, or null at clean EOF. */
  public async next(): Promise<string | null> {
    if (this.failure !== undefined) {
      throw this.failure;
    }
    if (this.lines.length > 0) {
      return this.lines.shift() ?? null;
    }
    if (this.eof) {
      return null;
    }
    if (this.closed) {
      throw new LineReaderError("partialLineAtEOF", "reader closed");
    }
    return await new Promise<string | null>((resolve, reject) => {
      this.waiter = { resolve, reject };
      this.stream.resume();
    });
  }

  /** Detaches listeners; outstanding lines are discarded. */
  public close(): void {
    this.closed = true;
    this.waiter = undefined;
    this.stream.removeAllListeners("data");
    this.stream.removeAllListeners("end");
    this.stream.removeAllListeners("error");
  }

  private onData(chunk: Buffer): void {
    if (this.failure !== undefined || this.eof) {
      return;
    }
    this.pending = this.pending.length === 0 ? chunk : Buffer.concat([this.pending, chunk]);
    let newlineIndex = this.pending.indexOf(0x0a);
    while (newlineIndex >= 0) {
      let line = this.pending.subarray(0, newlineIndex);
      if (line.length > 0 && line[line.length - 1] === 0x0d) {
        line = line.subarray(0, line.length - 1);
      }
      if (line.length > this.maxLineBytes) {
        this.fail(new LineReaderError("lineTooLong", `line exceeds ${this.maxLineBytes} bytes`));
        return;
      }
      let decoded: string;
      try {
        decoded = this.decoder.decode(line);
      } catch {
        this.fail(new LineReaderError("invalidUTF8", "line is not valid UTF-8"));
        return;
      }
      this.lines.push(decoded);
      this.pending = this.pending.subarray(newlineIndex + 1);
      newlineIndex = this.pending.indexOf(0x0a);
    }
    if (this.pending.length > this.maxLineBytes) {
      this.fail(new LineReaderError("lineTooLong", `line exceeds ${this.maxLineBytes} bytes`));
      return;
    }
    this.flush();
  }

  private onEnd(): void {
    this.eof = true;
    if (this.pending.length > 0) {
      this.fail(new LineReaderError("partialLineAtEOF", "partial NDJSON message at EOF"));
      return;
    }
    this.flush();
  }

  private flush(): void {
    if (this.waiter === undefined) {
      if (this.lines.length === 0 && !this.eof) {
        this.stream.pause();
      }
      return;
    }
    const waiter = this.waiter;
    this.waiter = undefined;
    if (this.lines.length > 0) {
      waiter.resolve(this.lines.shift() ?? null);
      return;
    }
    if (this.eof) {
      waiter.resolve(null);
      return;
    }
    // Nothing available yet: re-arm the waiter.
    this.waiter = waiter;
    this.stream.resume();
  }

  private fail(error: LineReaderError): void {
    this.failure = error;
    const waiter = this.waiter;
    this.waiter = undefined;
    this.lines.length = 0;
    if (waiter !== undefined) {
      waiter.reject(error);
    }
  }
}
