/**
 * Swift dispatcher emission (plan Task 26). The dispatcher contains only
 * the operation switch, input decode, implementation call, and output
 * encode - no product logic. The digest is a generated constant.
 */

import type { OperationIR, SemanticIR } from "@execspec/core";
import { swiftMethodName } from "./identifiers.js";
import {
  swiftDispatcherName,
  swiftImplementationProtocolName,
} from "./emit-protocol.js";
import { decoderExpression, encoderExpression } from "./emit-codecs.js";

export function emitSwiftDispatcher(
  ir: SemanticIR,
  digest: string,
  operations: readonly OperationIR[],
): string {
  const dispatcherName = swiftDispatcherName(ir.specificationName);
  const protocolName = swiftImplementationProtocolName(ir.specificationName);

  const lines: string[] = [];
  lines.push(`public struct ${dispatcherName}<Implementation: ${protocolName}>: ExecSpecDispatcher {`);
  lines.push(`    public let implementation: Implementation`);
  lines.push(`    public let specificationDigest: String`);
  lines.push(``);
  lines.push(`    public init(implementation: Implementation) {`);
  lines.push(`        self.implementation = implementation`);
  lines.push(`        self.specificationDigest = "${digest}"`);
  lines.push(`    }`);
  lines.push(``);
  lines.push(`    public func dispatch(operation: String, input: JSONValue) async throws -> JSONValue {`);
  lines.push(`        switch operation {`);
  for (const operation of operations) {
    const method = swiftMethodName(operation.id);
    const requestLocal = `request${method.charAt(0).toUpperCase()}${method.slice(1)}`;
    lines.push(`        case "${operation.id}":`);
    lines.push(`            let ${requestLocal} = try ${decoderExpression(operation.input)}(input)`);
    lines.push(`            let output = try await implementation.${method}(${requestLocal})`);
    lines.push(`            return try ${encoderExpression(operation.output)}(output)`);
  }
  lines.push(`        default:`);
  lines.push(`            throw ExecSpecHostFailure.invalidRequest("unknown operation: \\(operation)")`);
  lines.push(`        }`);
  lines.push(`    }`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}
