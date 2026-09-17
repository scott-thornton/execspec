/**
 * TypeScript implementation-protocol and dispatcher emission. Sync or
 * async implementations are both allowed; rejection (or thrown errors)
 * map to implementationException failures.
 */

import type { OperationIR, SemanticIR } from "@execspec/core";
import { tsMethodName, tsSpecificationPrefix } from "./identifiers.js";
import { tsValueTypeName } from "./emit-types.js";
import { decoderExpression, encoderExpression } from "./emit-codecs.js";

export function tsImplementationProtocolName(specificationName: string): string {
  return `${tsSpecificationPrefix(specificationName)}SpecificationImplementation`;
}

export function tsDispatcherName(specificationName: string): string {
  return `${tsSpecificationPrefix(specificationName)}ExecSpecDispatcher`;
}

export function emitTsImplementationProtocol(
  ir: SemanticIR,
  operations: readonly OperationIR[],
): string {
  const protocolName = tsImplementationProtocolName(ir.specificationName);
  const lines: string[] = [];
  const typeImports = [...new Set([
    ...operations.flatMap((operation) => [
      tsValueTypeName(operation.input),
      tsValueTypeName(operation.output),
    ]).filter((name) => /^[A-Z]/.test(name)),
    "ExecSpecUnit",
  ])].sort();
  lines.push(`import type { ${typeImports.join(", ")} } from "./ExecSpecTypes.js";`);
  lines.push(``);
  lines.push(`export interface ${protocolName} {`);
  for (const operation of operations) {
    const method = tsMethodName(operation.id);
    const input = tsValueTypeName(operation.input);
    const output = tsValueTypeName(operation.output);
    lines.push(`    ${method}(input: ${input}): ${output} | Promise<${output}>;`);
  }
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

export function emitTsDispatcher(
  ir: SemanticIR,
  digest: string,
  operations: readonly OperationIR[],
): string {
  const dispatcherName = tsDispatcherName(ir.specificationName);
  const protocolName = tsImplementationProtocolName(ir.specificationName);
  const namedTypes = [...new Set([
    ...operations.flatMap((operation) => [
      tsValueTypeName(operation.input),
      tsValueTypeName(operation.output),
    ]).filter((name) => /^[A-Z]/.test(name)),
    "ExecSpecUnit",
  ])].sort();

  const lines: string[] = [];
  lines.push(`import { ExecSpecHostFailure } from "@execspec/ts-generator";`);
  lines.push(`import type { WireValue } from "@execspec/ts-generator";`);
  lines.push(`import type { ${namedTypes.join(", ")} } from "./ExecSpecTypes.js";`);
  const codecImports = [...new Set(operations.flatMap((operation) => [
    decoderExpression(operation.input),
    encoderExpression(operation.output),
  ]))].sort();
  lines.push(`import {`);
  for (const name of codecImports) {
    lines.push(`    ${name},`);
  }
  lines.push(`} from "./ExecSpecCodecs.js";`);
  lines.push(`import type { ${protocolName} } from "./ExecSpecImplementation.js";`);
  lines.push(``);
  lines.push(`export class ${dispatcherName} {`);
  lines.push(`    readonly specificationDigest: string;`);
  lines.push(``);
  lines.push(`    constructor(private readonly implementation: ${protocolName}) {`);
  lines.push(`        this.specificationDigest = "${digest}";`);
  lines.push(`    }`);
  lines.push(``);
  lines.push(`    async dispatch(operation: string, input: WireValue): Promise<WireValue> {`);
  lines.push(`        switch (operation) {`);
  for (const operation of operations) {
    const method = tsMethodName(operation.id);
    lines.push(`            case "${operation.id}": {`);
    lines.push(`                const request = ${decoderExpression(operation.input)}(input);`);
    lines.push(`                const output = await this.implementation.${method}(request);`);
    lines.push(`                return ${encoderExpression(operation.output)}(output);`);
    lines.push(`            }`);
  }
  lines.push(`            default:`);
  lines.push(`                throw new ExecSpecHostFailure("invalidRequest", \`unknown operation: \${operation}\`);`);
  lines.push(`        }`);
  lines.push(`    }`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}
