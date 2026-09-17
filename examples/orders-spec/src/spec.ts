/**
 * The ordering reference specification: a cart-and-checkout contract
 * with exact money semantics, promo thresholds, and domain failures as
 * output values. The interesting property: scenarios pin the BUSINESS
 * MATH (totals, discounts, integer minor units), so any conforming
 * implementation in any language computes identical money.
 *
 * Deterministic rules pinned by the scenarios:
 * - Cart ids are "cart-1", "cart-2", … (process-local counter).
 * - Order ids are "ord-<cartId>"; placedAt echoes the request's `at`.
 * - Adding an existing sku increases quantity and KEEPS the original
 *   unit price (cart.add.merges-same-sku pins this).
 * - Items in a CartView keep first-insertion order; an empty cart
 *   reports amounts as gbp 0.
 * - Promo "TENOFF" takes 1000 minor units off when subtotal ≥ 5000 in
 *   the cart's currency; the discount is re-evaluated on every view.
 * - A cart's currency is set by its first item; mixing currencies is a
 *   domain failure (currencyMismatch), never an exception.
 * - Checkout: missing cart → notFound, no items → emptyCart,
 *   paymentRef "decline" → paymentDeclined, otherwise confirmed.
 */

import {
  specification,
  struct,
  union,
  enumeration,
  string,
  int64,
  unit,
  list,
  optional,
  ref,
  operation,
  scenario,
  outline,
  literal,
  binding,
  structValue,
  unionValue,
  enumValue,
  unitValue,
  stringValue,
  int64Value,
  listValue,
} from "@execspec/dsl";
import type { SemanticValue } from "@execspec/core";

const spec = specification({ name: "orders", version: "0.2.0" });

// --- Types ---------------------------------------------------------------

spec.type(enumeration("Currency", ["gbp", "eur", "usd"]));
spec.type(struct("Money", { currency: ref("Currency"), minorUnits: int64() }));
spec.type(struct("CartItem", {
  sku: string(),
  name: string(),
  unitPrice: ref("Money"),
  quantity: int64(),
}));
spec.type(struct("CartView", {
  items: list(ref("CartItem")),
  subtotal: ref("Money"),
  discount: optional(ref("Money")),
  total: ref("Money"),
}));
spec.type(union("CartError", { notFound: unit(), currencyMismatch: unit() }));
spec.type(union("CartResult", { ok: ref("CartView"), error: ref("CartError") }));
spec.type(enumeration("PromoRejection", ["unknownCode", "minimumNotMet"]));
spec.type(union("PromoResult", {
  applied: ref("CartView"),
  rejected: ref("PromoRejection"),
  error: ref("CartError"),
}));
spec.type(enumeration("OrderStatus", ["confirmed", "cancelled"]));
spec.type(struct("Order", {
  orderId: string(),
  status: ref("OrderStatus"),
  paid: ref("Money"),
  placedAt: int64(),
}));
spec.type(struct("AddItemRequest", { cartId: string(), item: ref("CartItem") }));
spec.type(struct("RemoveItemRequest", { cartId: string(), sku: string() }));
spec.type(struct("CartIdRequest", { cartId: string() }));
spec.type(struct("PromoRequest", { cartId: string(), code: string() }));
spec.type(struct("CheckoutRequest", { cartId: string(), paymentRef: string(), at: int64() }));
spec.type(union("CheckoutResult", {
  confirmed: ref("Order"),
  notFound: unit(),
  emptyCart: unit(),
  paymentDeclined: unit(),
}));

// --- Operations ------------------------------------------------------------

spec.operation(operation("cart.create", { input: unit(), output: string() }));
spec.operation(operation("cart.add", { input: ref("AddItemRequest"), output: ref("CartResult") }));
spec.operation(operation("cart.remove", { input: ref("RemoveItemRequest"), output: ref("CartResult") }));
spec.operation(operation("cart.view", { input: ref("CartIdRequest"), output: ref("CartResult") }));
spec.operation(operation("cart.promo", { input: ref("PromoRequest"), output: ref("PromoResult") }));
spec.operation(operation("order.checkout", { input: ref("CheckoutRequest"), output: ref("CheckoutResult") }));

// --- Literal helpers ---------------------------------------------------------

const money = (currency: string, minorUnits: bigint) =>
  structValue("Money", { currency: enumValue("Currency", currency), minorUnits });

const item = (sku: string, name: string, currency: string, unitPrice: bigint, quantity: bigint) =>
  structValue("CartItem", { sku, name, unitPrice: money(currency, unitPrice), quantity });

const view = (
  items: readonly SemanticValue[],
  currency: string,
  subtotal: bigint,
  discount: bigint | undefined,
  total: bigint,
) =>
  structValue("CartView", {
    items: listValue(items),
    subtotal: money(currency, subtotal),
    discount: discount === undefined ? undefined : money(currency, discount),
    total: money(currency, total),
  });

const okView = (
  items: readonly SemanticValue[],
  currency: string,
  subtotal: bigint,
  discount: bigint | undefined,
  total: bigint,
) => unionValue("CartResult", "ok", view(items, currency, subtotal, discount, total));

const cartError = (caseName: "notFound" | "currencyMismatch") =>
  unionValue("CartResult", "error", unionValue("CartError", caseName));

// --- Scenarios ----------------------------------------------------------------

spec.scenario(
  scenario("cart.create.returns-id", "cart ids are deterministic")
    .call("id", "cart.create", literal(unitValue()))
    .expectEqual(binding("id"), literal(stringValue("cart-1")))
    .build(),
);

spec.scenario(
  scenario("cart.view.empty", "an empty cart reports gbp zero amounts and no discount")
    .call("id", "cart.create", literal(unitValue()))
    .call("view", "cart.view", literal(structValue("CartIdRequest", { cartId: "cart-1" })))
    .expectEqual(binding("view"), literal(okView([], "gbp", 0n, undefined, 0n)))
    .build(),
);

spec.scenario(
  scenario("cart.view.missing", "viewing an unknown cart reports notFound")
    .call("view", "cart.view", literal(structValue("CartIdRequest", { cartId: "nope" })))
    .expectEqual(binding("view"), literal(cartError("notFound")))
    .build(),
);

for (const built of outline(
  "cart.add.totals",
  "line items sum to exact minor-unit totals",
  [
    { id: "gbp", data: { currency: "gbp", widget: 325n, gadget: 450n, subtotal: 1100n } },
    { id: "eur", data: { currency: "eur", widget: 110n, gadget: 220n, subtotal: 440n } },
  ],
  (row, _index, builder) =>
    builder
      .call("id", "cart.create", literal(unitValue()))
      .call("addWidget", "cart.add", literal(structValue("AddItemRequest", {
        cartId: "cart-1",
        item: item("widget", "Widget", row.data.currency, row.data.widget, 2n),
      })))
      .call("addGadget", "cart.add", literal(structValue("AddItemRequest", {
        cartId: "cart-1",
        item: item("gadget", "Gadget", row.data.currency, row.data.gadget, 1n),
      })))
      .call("view", "cart.view", literal(structValue("CartIdRequest", { cartId: "cart-1" })))
      .expectEqual(
        binding("view"),
        literal(okView(
          [
            item("widget", "Widget", row.data.currency, row.data.widget, 2n),
            item("gadget", "Gadget", row.data.currency, row.data.gadget, 1n),
          ],
          row.data.currency,
          row.data.subtotal,
          undefined,
          row.data.subtotal,
        )),
      ),
)) {
  spec.scenario(built);
}

spec.scenario(
  scenario("cart.add.merges-same-sku", "re-adding a sku merges quantity and keeps the first unit price")
    .call("id", "cart.create", literal(unitValue()))
    .call("first", "cart.add", literal(structValue("AddItemRequest", {
      cartId: "cart-1",
      item: item("tea", "Tea", "gbp", 325n, 2n),
    })))
    .call("second", "cart.add", literal(structValue("AddItemRequest", {
      cartId: "cart-1",
      item: item("tea", "Tea", "gbp", 300n, 3n),
    })))
    .call("view", "cart.view", literal(structValue("CartIdRequest", { cartId: "cart-1" })))
    .expectEqual(
      binding("view"),
      literal(okView([item("tea", "Tea", "gbp", 325n, 5n)], "gbp", 1625n, undefined, 1625n)),
    )
    .build(),
);

spec.scenario(
  scenario("cart.add.missing-cart", "adding to an unknown cart reports notFound")
    .call("add", "cart.add", literal(structValue("AddItemRequest", {
      cartId: "ghost",
      item: item("widget", "Widget", "gbp", 100n, 1n),
    })))
    .expectEqual(binding("add"), literal(cartError("notFound")))
    .build(),
);

spec.scenario(
  scenario("cart.add.currency-mismatch", "mixing currencies in one cart is a domain failure")
    .call("id", "cart.create", literal(unitValue()))
    .call("first", "cart.add", literal(structValue("AddItemRequest", {
      cartId: "cart-1",
      item: item("widget", "Widget", "gbp", 100n, 1n),
    })))
    .call("second", "cart.add", literal(structValue("AddItemRequest", {
      cartId: "cart-1",
      item: item("croissant", "Croissant", "eur", 150n, 1n),
    })))
    .expectEqual(binding("second"), literal(cartError("currencyMismatch")))
    .build(),
);

spec.scenario(
  scenario("cart.remove.line", "removing a line re-computes the subtotal")
    .call("id", "cart.create", literal(unitValue()))
    .call("addA", "cart.add", literal(structValue("AddItemRequest", {
      cartId: "cart-1",
      item: item("a", "A", "gbp", 100n, 2n),
    })))
    .call("addB", "cart.add", literal(structValue("AddItemRequest", {
      cartId: "cart-1",
      item: item("b", "B", "gbp", 50n, 3n),
    })))
    .call("remove", "cart.remove", literal(structValue("RemoveItemRequest", { cartId: "cart-1", sku: "a" })))
    .call("view", "cart.view", literal(structValue("CartIdRequest", { cartId: "cart-1" })))
    .expectEqual(
      binding("view"),
      literal(okView([item("b", "B", "gbp", 50n, 3n)], "gbp", 150n, undefined, 150n)),
    )
    .build(),
);

spec.scenario(
  scenario("cart.promo.applies", "TENOFF takes 1000 minor units off at subtotal 5000 or more")
    .call("id", "cart.create", literal(unitValue()))
    .call("add", "cart.add", literal(structValue("AddItemRequest", {
      cartId: "cart-1",
      item: item("plate", "Plate", "gbp", 2500n, 2n),
    })))
    .call("promo", "cart.promo", literal(structValue("PromoRequest", { cartId: "cart-1", code: "TENOFF" })))
    .expectEqual(
      binding("promo"),
      literal(unionValue("PromoResult", "applied", view(
        [item("plate", "Plate", "gbp", 2500n, 2n)],
        "gbp",
        5000n,
        1000n,
        4000n,
      ))),
    )
    .build(),
);

spec.scenario(
  scenario("cart.promo.below-minimum", "TENOFF below the 5000 minimum is rejected")
    .call("id", "cart.create", literal(unitValue()))
    .call("add", "cart.add", literal(structValue("AddItemRequest", {
      cartId: "cart-1",
      item: item("plate", "Plate", "gbp", 4999n, 1n),
    })))
    .call("promo", "cart.promo", literal(structValue("PromoRequest", { cartId: "cart-1", code: "TENOFF" })))
    .expectEqual(
      binding("promo"),
      literal(unionValue("PromoResult", "rejected", enumValue("PromoRejection", "minimumNotMet"))),
    )
    .build(),
);

spec.scenario(
  scenario("cart.promo.unknown-code", "unknown promo codes are rejected")
    .call("id", "cart.create", literal(unitValue()))
    .call("promo", "cart.promo", literal(structValue("PromoRequest", { cartId: "cart-1", code: "BOGOF" })))
    .expectEqual(
      binding("promo"),
      literal(unionValue("PromoResult", "rejected", enumValue("PromoRejection", "unknownCode"))),
    )
    .build(),
);

spec.scenario(
  scenario("order.checkout.confirmed", "checkout charges the discounted total and echoes the epoch")
    .call("id", "cart.create", literal(unitValue()))
    .call("add", "cart.add", literal(structValue("AddItemRequest", {
      cartId: "cart-1",
      item: item("plate", "Plate", "gbp", 2500n, 2n),
    })))
    .call("promo", "cart.promo", literal(structValue("PromoRequest", { cartId: "cart-1", code: "TENOFF" })))
    .call("checkout", "order.checkout", literal(structValue("CheckoutRequest", {
      cartId: "cart-1",
      paymentRef: "pm_good",
      at: int64Value(1730000000n),
    })))
    .expectEqual(
      binding("checkout"),
      literal(unionValue("CheckoutResult", "confirmed", structValue("Order", {
        orderId: stringValue("ord-cart-1"),
        status: enumValue("OrderStatus", "confirmed"),
        paid: money("gbp", 4000n),
        placedAt: int64Value(1730000000n),
      }))),
    )
    .build(),
);

spec.scenario(
  scenario("order.checkout.empty-cart", "checking out an empty cart is a domain failure")
    .call("id", "cart.create", literal(unitValue()))
    .call("checkout", "order.checkout", literal(structValue("CheckoutRequest", {
      cartId: "cart-1",
      paymentRef: "pm_good",
      at: int64Value(1n),
    })))
    .expectEqual(
      binding("checkout"),
      literal(unionValue("CheckoutResult", "emptyCart")),
    )
    .build(),
);

spec.scenario(
  scenario("order.checkout.payment-declined", "a declined payment is a domain failure, not an exception")
    .call("id", "cart.create", literal(unitValue()))
    .call("add", "cart.add", literal(structValue("AddItemRequest", {
      cartId: "cart-1",
      item: item("plate", "Plate", "gbp", 100n, 1n),
    })))
    .call("checkout", "order.checkout", literal(structValue("CheckoutRequest", {
      cartId: "cart-1",
      paymentRef: "decline",
      at: int64Value(1n),
    })))
    .expectEqual(
      binding("checkout"),
      literal(unionValue("CheckoutResult", "paymentDeclined")),
    )
    .build(),
);

export default spec.build();
