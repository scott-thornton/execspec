/**
 * Compilation: AuthoringGraph → validated, canonical SemanticIRDocument
 * plus specification digest (plan Task 17). No target-language code.
 */

import {
  validateSemanticIR,
} from "@execspec/core";
import type {
  OperationIR,
  ScenarioIR,
  SemanticIR,
  SemanticIRDocument,
} from "@execspec/core";
import { specificationDigest } from "@execspec/core";
import type { AuthoringGraph } from "./authoring-graph.js";
import type { CompilerDiagnostic } from "./diagnostics.js";
import { validateAuthoringGraph } from "./validate-authoring.js";

export type CompileResult =
  | {
      readonly ok: true;
      readonly document: SemanticIRDocument;
      readonly digest: string;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly CompilerDiagnostic[];
    };

export function compileSpecification(graph: AuthoringGraph): CompileResult {
  // Stage 1: validate authoring identifiers and structure (graph may be
  // an untrusted module export).
  const authoringDiagnostics = validateAuthoringGraph(graph);
  if (authoringDiagnostics.length > 0) {
    return { ok: false, diagnostics: authoringDiagnostics };
  }

  // Stages 2-4: resolve named references, lower DSL markers (already
  // lowered by the type builders), construct Semantic IR.
  const semantic: SemanticIR = {
    specificationName: graph.specificationName,
    specificationVersion: graph.specificationVersion,
    types: [...graph.types],
    operations: graph.operations.map((operation): OperationIR => ({
      id: operation.id,
      input: operation.input,
      output: operation.output,
    })),
    scenarios: graph.scenarios.map((scenario): ScenarioIR => ({
      id: scenario.id,
      description: scenario.description,
      steps: [...scenario.steps],
    })),
  };

  // Stage 5: full IR validation (static typing, references, scenarios).
  const irDiagnostics = validateSemanticIR(semantic);
  if (irDiagnostics.length > 0) {
    return { ok: false, diagnostics: irDiagnostics };
  }

  // Stage 6: canonicalize declaration order (types/operations/scenarios
  // sorted by ID; declaration members sorted inside digest.ts, and the
  // document round-trips through the canonical JSON form).
  const canonical: SemanticIR = {
    ...semantic,
    types: [...semantic.types].sort((left, right) => compareIds(left.id, right.id)),
    operations: [...semantic.operations].sort((left, right) => compareIds(left.id, right.id)),
    scenarios: [...semantic.scenarios].sort((left, right) => compareIds(left.id, right.id)),
  };

  // Stage 7: digest over canonical semantic bytes.
  const digest = specificationDigest(canonical);

  // Stage 8: attach source metadata (v0.1 DSL produces no locations).
  const document: SemanticIRDocument = {
    format: "execspec",
    irVersion: 1,
    semantic: canonical,
    metadata: { sourceLocations: {} },
  };

  return { ok: true, document, digest };
}

function compareIds(left: string, right: string): number {
  if (left < right) {
    return -1;
  }
  if (left > right) {
    return 1;
  }
  return 0;
}
