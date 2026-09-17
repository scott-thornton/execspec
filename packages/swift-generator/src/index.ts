export const swiftGeneratorVersion = "0.1.0";

export { generateSwift } from "./emit.js";
export type { GeneratedFile } from "./emit.js";

export {
  swiftTypeName,
  swiftPropertyName,
  swiftEnumCaseName,
  swiftMethodName,
  swiftSpecificationPrefix,
  assertNoEscapedCollisions,
} from "./identifiers.js";
export {
  swiftImplementationProtocolName,
  swiftDispatcherName,
} from "./emit-protocol.js";
