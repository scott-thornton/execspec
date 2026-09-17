/**
 * Swift implementation protocol emission (plan Task 24). `throws` means
 * implementation exceptions only; domain failures are output values.
 */

import type { OperationIR, SemanticIR } from "@execspec/core";
import {
  assertNoEscapedCollisions,
  swiftMethodName,
  swiftSpecificationPrefix,
} from "./identifiers.js";
import { swiftValueTypeName } from "./emit-types.js";

export function swiftImplementationProtocolName(specificationName: string): string {
  return `${swiftSpecificationPrefix(specificationName)}SpecificationImplementation`;
}

export function swiftDispatcherName(specificationName: string): string {
  return `${swiftSpecificationPrefix(specificationName)}ExecSpecDispatcher`;
}

export function emitSwiftImplementationProtocol(
  ir: SemanticIR,
  operations: readonly OperationIR[],
): string {
  assertNoEscapedCollisions(
    operations.map((operation) => operation.id),
    "implementation protocol",
    swiftMethodName,
  );

  const protocolName = swiftImplementationProtocolName(ir.specificationName);
  const lines: string[] = [];
  lines.push(`public protocol ${protocolName}: Sendable {`);
  for (const operation of operations) {
    const method = swiftMethodName(operation.id);
    lines.push(
      `    func ${method}(_ input: ${swiftValueTypeName(operation.input)}) async throws -> ${swiftValueTypeName(operation.output)}`,
    );
  }
  lines.push(`}`);
  return lines.join("\n") + "\n";
}
