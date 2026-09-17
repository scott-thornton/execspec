export const harnessVersion = "0.1.0";

export * from "./protocol.js";
export { LineReader, LineReaderError } from "./line-reader.js";
export type { LineReaderErrorKind } from "./line-reader.js";
export { spawnHost } from "./host-process.js";
export type { HostCommand, HostProcess } from "./host-process.js";
export { evaluateExpression } from "./evaluator.js";
export type { ScenarioBindings } from "./evaluator.js";
export { runScenario, runSpecification } from "./runner.js";
export type { RunOptions, ScenarioResult } from "./runner.js";
export {
  ConformanceError,
  toConformanceFailure,
} from "./failures.js";
export type { ConformanceFailure, FailureKind } from "./failures.js";
export { renderReport, renderSemanticValue, summarize } from "./reporter.js";
