import { test } from "node:test";
import assert from "node:assert/strict";
import { OrderStore } from "../dist/OrderStore.js";

test("the TS ordering implementation matches the pinned rules", () => {
  const store = new OrderStore();
  assert.equal(store.cartCreate(undefined), "cart-1");
  store.cartAdd({ cartId: "cart-1", item: { sku: "tea", name: "Tea", quantity: 2n, unitPrice: { currency: "gbp", minorUnits: 325n } } });
  store.cartAdd({ cartId: "cart-1", item: { sku: "tea", name: "Tea", quantity: 3n, unitPrice: { currency: "gbp", minorUnits: 300n } } });
  const view = store.cartView({ cartId: "cart-1" });
  assert.deepEqual(view, {
    kind: "ok",
    value: {
      items: [{ sku: "tea", name: "Tea", quantity: 5n, unitPrice: { currency: "gbp", minorUnits: 325n } }],
      subtotal: { currency: "gbp", minorUnits: 1625n },
      total: { currency: "gbp", minorUnits: 1625n },
    },
  });
  assert.deepEqual(
    store.orderCheckout({ cartId: "missing", paymentRef: "pm", at: 1n }),
    { kind: "notFound" },
  );
});
