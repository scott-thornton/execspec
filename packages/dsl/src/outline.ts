/**
 * Scenario outlines: one authored shape, a table of rows, N compiled
 * scenarios. Pure authoring sugar - the compiler only ever sees plain
 * scenarios, so no semantics change.
 */

import type { AuthoringScenario } from "@execspec/compiler";
import { scenario } from "./scenario-builder.js";
import type { ScenarioBuilder } from "./scenario-builder.js";

export interface OutlineRow<Row> {
  /** Final dot-separated segment(s) of the scenario ID. */
  readonly id: string;
  readonly description?: string;
  readonly data: Row;
}

/**
 * `make` receives a builder already identified as
 * `${baseId}.${row.id}` with the row's description; it only adds steps.
 */
export function outline<Row>(
  baseId: string,
  baseDescription: string,
  rows: readonly OutlineRow<Row>[],
  make: (row: OutlineRow<Row>, index: number, builder: ScenarioBuilder) => ScenarioBuilder,
): readonly AuthoringScenario[] {
  if (rows.length === 0) {
    throw new Error(`outline '${baseId}' requires at least one row`);
  }
  const seen = new Set<string>();
  const scenarios: AuthoringScenario[] = [];
  for (const [index, row] of rows.entries()) {
    const id = `${baseId}.${row.id}`;
    if (seen.has(id)) {
      throw new Error(`outline '${baseId}' has duplicate row id '${row.id}'`);
    }
    seen.add(id);
    const builder = scenario(id, row.description ?? baseDescription);
    scenarios.push(make(row, index, builder).build());
  }
  return scenarios;
}
