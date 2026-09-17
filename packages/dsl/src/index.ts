export const dslVersion = "0.1.0";

export { specification } from "./specification.js";
export type { SpecificationBuilder } from "./specification.js";

export {
  unit,
  boolean,
  int64,
  string,
  list,
  ref,
  optional,
  struct,
  enumeration,
  union,
} from "./type-builders.js";
export type { FieldSpec, OptionalFieldMarker } from "./type-builders.js";

export { operation } from "./operation-builder.js";
export type { OperationSpec } from "./operation-builder.js";

export { scenario } from "./scenario-builder.js";
export type { ScenarioBuilder } from "./scenario-builder.js";

export { literal, binding, field } from "./expressions.js";

// Semantic value factories are re-exported for authoring convenience
// (specifications build literals out of canonical semantic values).
export {
  unitValue,
  booleanValue,
  int64Value,
  stringValue,
  listValue,
  structValue,
  enumValue,
  unionValue,
} from "@execspec/core";
