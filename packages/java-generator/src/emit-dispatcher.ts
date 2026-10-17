/** Java implementation interface and dispatcher emission. */

import type { OperationIR, SemanticIR } from "@execspec/core";
import { javaMethodName, javaSpecificationPrefix } from "./identifiers.js";
import { javaValueTypeName } from "./emit.js";
import { decoderExpression, encoderExpression } from "./emit-codecs.js";

export function javaImplementationProtocolName(specificationName: string): string {
  return `${javaSpecificationPrefix(specificationName)}SpecificationImplementation`;
}

export function emitJavaImplementationProtocol(
  ir: SemanticIR,
  operations: readonly OperationIR[],
): string {
  const protocolName = javaImplementationProtocolName(ir.specificationName);
  const lines: string[] = [];
  lines.push(`interface ${protocolName} {`);
  for (const operation of operations) {
    const method = javaMethodName(operation.id);
    lines.push(`    ${javaValueTypeName(operation.output)} ${method}(${javaValueTypeName(operation.input)} input) throws Exception;`);
  }
  lines.push(`}`);
  return lines.join("\n") + "\n";
}

export function emitJavaDispatcher(
  ir: SemanticIR,
  digest: string,
  operations: readonly OperationIR[],
): string {
  const protocolName = javaImplementationProtocolName(ir.specificationName);
  const dispatcherName = `${javaSpecificationPrefix(ir.specificationName)}ExecSpecDispatcher`;
  const lines: string[] = [];
  lines.push(`import static com.execspec.generated.ExecSpecCodecs.*;`);
  lines.push("");
  lines.push(`final class ${dispatcherName} implements Host.Dispatcher {`);
  lines.push(`    private final ${protocolName} implementation;`);
  lines.push(`    private final String specificationDigest = "${digest}";`);
  lines.push("");
  lines.push(`    public ${dispatcherName}(${protocolName} implementation) {`);
  lines.push(`        this.implementation = implementation;`);
  lines.push(`    }`);
  lines.push("");
  lines.push(`    @Override`);
  lines.push(`    public String getSpecificationDigest() { return specificationDigest; }`);
  lines.push("");
  lines.push(`    @Override`);
  lines.push(`    public JSONValue dispatch(String operation, JSONValue input) throws Exception {`);
  lines.push(`        switch (operation) {`);
  for (const operation of operations) {
    const method = javaMethodName(operation.id);
    lines.push(`            case "${operation.id}": {`);
    lines.push(`                ${javaValueTypeName(operation.input)} request = ${decoderExpression(operation.input)}(input);`);
    lines.push(`                ${javaValueTypeName(operation.output)} output = implementation.${method}(request);`);
    lines.push(`                return ${encoderExpression(operation.output)}(output);`);
    lines.push(`            }`);
  }
  lines.push(`            default:`);
  lines.push(`                throw new Host.HostFailure("invalidRequest", "unknown operation: " + operation);`);
  lines.push(`        }`);
  lines.push(`    }`);
  lines.push(`}`);
  return lines.join("\n") + "\n";
}
