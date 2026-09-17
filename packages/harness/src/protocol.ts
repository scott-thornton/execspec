/**
 * Host protocol codec (docs/protocol-v1.md). Strict decoding from
 * `unknown`; missing fields, wrong types, unknown kinds, and additional
 * fields are rejected. No schema dependency.
 */

import { canonicalJSONStringify } from "@execspec/core";
import type { JSONValue } from "@execspec/core";

export const PROTOCOL_VERSION = 1;
/** Protocol v1 target identifies the implementation language. */
export const WIRE_TARGETS: readonly string[] = ["swift", "typescript"];
export const MAX_LINE_BYTES = 16 * 1024 * 1024;

export interface HelloMessage {
  readonly kind: "hello";
  readonly protocolVersion: number;
  readonly specificationDigest: string;
}

export interface HelloAckMessage {
  readonly kind: "helloAck";
  readonly protocolVersion: number;
  readonly specificationDigest: string;
  readonly target: string;
}

export interface RequestMessage {
  readonly kind: "request";
  readonly id: string;
  readonly operation: string;
  readonly input: JSONValue;
}

export interface ResponseMessage {
  readonly kind: "response";
  readonly id: string;
  readonly output: JSONValue;
}

export interface FailureMessage {
  readonly kind: "failure";
  readonly id: string;
  readonly category: string;
  readonly message: string;
}

export type HostMessage =
  | HelloAckMessage
  | ResponseMessage
  | FailureMessage;

export type DecodeResult =
  | { readonly ok: true; readonly message: HostMessage }
  | { readonly ok: false; readonly error: string };

export function encodeHello(specificationDigest: string): string {
  const message: HelloMessage = {
    kind: "hello",
    protocolVersion: PROTOCOL_VERSION,
    specificationDigest,
  };
  return canonicalJSONStringify(message as unknown as JSONValue);
}

export function encodeRequest(
  id: string,
  operation: string,
  input: JSONValue,
): string {
  const message: RequestMessage = { kind: "request", id, operation, input };
  return canonicalJSONStringify(message as unknown as JSONValue);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function checkExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
  scope: string,
): string | undefined {
  const present = Object.keys(record);
  if (present.length !== keys.length) {
    return `${scope}: expected exactly ${keys.length} fields, got ${present.length}`;
  }
  for (const key of keys) {
    if (!(key in record)) {
      return `${scope}: missing field '${key}'`;
    }
  }
  return undefined;
}

export function decodeHostMessage(json: unknown): DecodeResult {
  const record = asRecord(json);
  if (record === undefined) {
    return { ok: false, error: "message must be a JSON object" };
  }
  switch (record.kind) {
    case "helloAck": {
      const keyError = checkExactKeys(record, ["kind", "protocolVersion", "specificationDigest", "target"], "helloAck");
      if (keyError !== undefined) {
        return { ok: false, error: keyError };
      }
      if (typeof record.protocolVersion !== "number" || !Number.isInteger(record.protocolVersion)) {
        return { ok: false, error: "helloAck.protocolVersion must be an integer" };
      }
      if (typeof record.specificationDigest !== "string") {
        return { ok: false, error: "helloAck.specificationDigest must be a string" };
      }
      if (typeof record.target !== "string") {
        return { ok: false, error: "helloAck.target must be a string" };
      }
      return {
        ok: true,
        message: {
          kind: "helloAck",
          protocolVersion: record.protocolVersion,
          specificationDigest: record.specificationDigest,
          target: record.target,
        },
      };
    }
    case "response": {
      const keyError = checkExactKeys(record, ["kind", "id", "output"], "response");
      if (keyError !== undefined) {
        return { ok: false, error: keyError };
      }
      if (typeof record.id !== "string") {
        return { ok: false, error: "response.id must be a string" };
      }
      return {
        ok: true,
        message: { kind: "response", id: record.id, output: record.output as JSONValue },
      };
    }
    case "failure": {
      const keyError = checkExactKeys(record, ["kind", "id", "category", "message"], "failure");
      if (keyError !== undefined) {
        return { ok: false, error: keyError };
      }
      if (typeof record.id !== "string") {
        return { ok: false, error: "failure.id must be a string" };
      }
      if (typeof record.category !== "string") {
        return { ok: false, error: "failure.category must be a string" };
      }
      if (typeof record.message !== "string") {
        return { ok: false, error: "failure.message must be a string" };
      }
      return {
        ok: true,
        message: {
          kind: "failure",
          id: record.id,
          category: record.category,
          message: record.message,
        },
      };
    }
    default:
      return { ok: false, error: `unknown message kind ${JSON.stringify(record.kind)}` };
  }
}
