import { test } from "node:test";
import assert from "node:assert/strict";

import graph from "../src/spec.js";
import { compileSpecification } from "@execspec/compiler";

test("the ordering specification compiles cleanly with fifteen scenarios", () => {
  const result = compileSpecification(graph);
  if (!result.ok) {
    assert.fail(result.diagnostics.map((d) => d.message).join("\n"));
  }
  assert.match(result.digest, /^[0-9a-f]{64}$/);
  assert.equal(result.document.semantic.operations.length, 6);
  assert.equal(result.document.semantic.scenarios.length, 15);
  assert.deepEqual(
    result.document.semantic.scenarios.map((s) => s.id),
    [
      "cart.add.currency-mismatch",
      "cart.add.merges-same-sku",
      "cart.add.missing-cart",
      "cart.add.totals.eur",
      "cart.add.totals.gbp",
      "cart.create.returns-id",
      "cart.promo.applies",
      "cart.promo.below-minimum",
      "cart.promo.unknown-code",
      "cart.remove.line",
      "cart.view.empty",
      "cart.view.missing",
      "order.checkout.confirmed",
      "order.checkout.empty-cart",
      "order.checkout.payment-declined",
    ],
  );
});
