export const compilerVersion = "0.1.0";

export type {
  AuthoringGraph,
  AuthoringOperation,
  AuthoringScenario,
} from "./authoring-graph.js";
export { isAuthoringGraph } from "./authoring-graph.js";
export type { CompilerDiagnostic } from "./diagnostics.js";
export { formatDiagnostics } from "./diagnostics.js";
export { validateAuthoringGraph } from "./validate-authoring.js";
export { compileSpecification } from "./normalize.js";
export type { CompileResult } from "./normalize.js";
