/**
 * Specification builder: the public authoring entry point. Constructs a
 * static AuthoringGraph; compilation happens in @execspec/compiler.
 */

import type { TypeDeclaration } from "@execspec/core";
import type { AuthoringGraph, AuthoringOperation, AuthoringScenario } from "@execspec/compiler";

export interface SpecificationBuilder {
  type(declaration: TypeDeclaration): SpecificationBuilder;
  operation(operation: AuthoringOperation): SpecificationBuilder;
  scenario(scenario: AuthoringScenario): SpecificationBuilder;
  build(): AuthoringGraph;
}

export function specification(config: {
  readonly name: string;
  readonly version: string;
}): SpecificationBuilder {
  if (typeof config.name !== "string" || config.name.length === 0) {
    throw new Error("specification name must be a non-empty string");
  }
  if (typeof config.version !== "string" || config.version.length === 0) {
    throw new Error("specification version must be a non-empty string");
  }

  const types: TypeDeclaration[] = [];
  const operations: AuthoringOperation[] = [];
  const scenarios: AuthoringScenario[] = [];
  const typeIds = new Set<string>();
  const operationIds = new Set<string>();
  const scenarioIds = new Set<string>();
  let built = false;

  const guard = (): void => {
    if (built) {
      throw new Error("specification builder is immutable after build()");
    }
  };

  return {
    type(declaration: TypeDeclaration): SpecificationBuilder {
      guard();
      if (typeIds.has(declaration.id)) {
        throw new Error(`duplicate type registration: ${declaration.id}`);
      }
      typeIds.add(declaration.id);
      types.push(declaration);
      return this;
    },
    operation(operation: AuthoringOperation): SpecificationBuilder {
      guard();
      if (operationIds.has(operation.id)) {
        throw new Error(`duplicate operation registration: ${operation.id}`);
      }
      operationIds.add(operation.id);
      operations.push(operation);
      return this;
    },
    scenario(scenario: AuthoringScenario): SpecificationBuilder {
      guard();
      if (scenarioIds.has(scenario.id)) {
        throw new Error(`duplicate scenario registration: ${scenario.id}`);
      }
      scenarioIds.add(scenario.id);
      scenarios.push(scenario);
      return this;
    },
    build(): AuthoringGraph {
      guard();
      built = true;
      return {
        specificationName: config.name,
        specificationVersion: config.version,
        types: [...types],
        operations: [...operations],
        scenarios: [...scenarios],
      };
    },
  };
}
