export const tsGeneratorVersion = "0.1.0";

export { generateTypeScript } from "./emit.js";
export type { GeneratedTsFile } from "./emit.js";

// Host runtime (used by generated hosts).
export { runExecSpecHost, ExecSpecHostFailure } from "./runtime/host.js";
export { PROTOCOL_VERSION as EXEC_SPEC_PROTOCOL_VERSION, HOST_TARGET } from "./runtime/host.js";
export { strictParseJSON, StrictJSONError } from "./runtime/strict-json.js";
export type { WireValue } from "./runtime/strict-json.js";

// Canonical float64 helpers (shared with @execspec/core so every target
// emits identical spellings).
export {
  canonicalFloat64Spelling,
  isCanonicalFloat64Spelling,
  parseFloat64Spelling,
} from "@execspec/core";
