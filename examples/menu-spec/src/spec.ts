/**
 * A menu pricing contract: baskets of items with modifiers, priced
 * against a delivery zone's fee and minimum order. Every scenario pins
 * the money math to the minor unit, so both implementations (Swift,
 * TypeScript) must produce identical totals.
 *
 * Deterministic rules pinned by the scenarios:
 * - Modifier price deltas are additive on the base item price.
 * - A required modifier with no selection is missingRequiredModifier.
 * - The unit price of a basket item is base + all selected deltas.
 * - The line total is unit price x quantity.
 * - Delivery fee applies only when subtotal >= zone minimum.
 * - Grand total = subtotal + delivery fee (when applied).
 */

import {
  specification, struct, union, enumeration,
  string, int64, unit, list, ref,
  operation, scenario, literal, binding,
  structValue, unionValue, enumValue, unitValue, stringValue, int64Value, listValue,
} from "@execspec/dsl";
import type { SemanticValue } from "@execspec/core";

const spec = specification({ name: "menu", version: "0.3.0" });

// --- Types ---

spec.type(enumeration("Currency", ["gbp"]));
spec.type(struct("Money", { currency: ref("Currency"), minorUnits: int64() }));
spec.type(struct("ModifierOption", {
  name: string(),
  priceDelta: ref("Money"),
}));
spec.type(struct("Modifier", {
  name: string(),
  options: list(ref("ModifierOption")),
  required: string(),
}));

spec.type(struct("MenuItem", {
  sku: string(),
  name: string(),
  basePrice: ref("Money"),
  modifiers: list(ref("Modifier")),
}));

spec.type(struct("ChosenOption", {
  modifierName: string(),
  optionName: string(),
}));

spec.type(struct("BasketItem", {
  sku: string(),
  quantity: int64(),
  chosen: list(ref("ChosenOption")),
}));

spec.type(struct("DeliveryZone", {
  name: string(),
  fee: ref("Money"),
  minimumOrder: ref("Money"),
}));

spec.type(struct("PricedLine", {
  description: string(),
  unitPrice: ref("Money"),
  quantity: int64(),
  lineTotal: ref("Money"),
}));

spec.type(struct("PricedBasket", {
  lines: list(ref("PricedLine")),
  subtotal: ref("Money"),
  deliveryFee: ref("Money"),
  total: ref("Money"),
}));

spec.type(union("PricingError", {
  unknownItem: string(),
  unknownOption: ref("ChosenOption"),
  missingRequiredModifier: string(),
  belowMinimum: ref("Money"),
}));

spec.type(union("PriceBasketResult", {
  priced: ref("PricedBasket"),
  error: ref("PricingError"),
}));

spec.type(struct("PriceBasketRequest", {
  items: list(ref("MenuItem")),
  basket: list(ref("BasketItem")),
  zone: ref("DeliveryZone"),
}));

// --- Operation ---

spec.operation(operation("basket.price", {
  input: ref("PriceBasketRequest"),
  output: ref("PriceBasketResult"),
}));

// --- Helpers ---

const money = (n: bigint) => structValue("Money", { currency: enumValue("Currency", "gbp"), minorUnits: n });

const opt = (name: string, delta: bigint) =>
  structValue("ModifierOption", { name, priceDelta: money(delta) });

const modifier = (name: string, options: SemanticValue[], required: boolean) =>
  structValue("Modifier", { name, options: listValue(options), required: required ? "true" : "false" });

const burger = structValue("MenuItem", {
  sku: stringValue("burger"),
  name: stringValue("Burger"),
  basePrice: money(850n),
  modifiers: listValue([
    modifier("size", [opt("regular", 0n), opt("large", 150n)], true),
    modifier("extras", [opt("bacon", 120n), opt("cheese", 60n)], false),
  ]),
});

const fries = structValue("MenuItem", {
  sku: stringValue("fries"),
  name: stringValue("Fries"),
  basePrice: money(350n),
  modifiers: listValue([]),
});

const standardZone = structValue("DeliveryZone", {
  name: stringValue("Zone A"),
  fee: money(299n),
  minimumOrder: money(1000n),
});

const basketItem = (sku: string, qty: bigint, chosen: SemanticValue[]) =>
  structValue("BasketItem", { sku: stringValue(sku), quantity: qty, chosen: listValue(chosen) });

const choose = (m: string, o: string) =>
  structValue("ChosenOption", { modifierName: stringValue(m), optionName: stringValue(o) });

const request = (menuItems: SemanticValue[], basket: SemanticValue[], zone: SemanticValue) =>
  structValue("PriceBasketRequest", { items: listValue(menuItems), basket: listValue(basket), zone });

const pricedLine = (desc: string, unit: bigint, qty: bigint, total: bigint) =>
  structValue("PricedLine", {
    description: stringValue(desc),
    unitPrice: money(unit),
    quantity: qty,
    lineTotal: money(total),
  });

const pricedBasket = (lines: SemanticValue[], subtotal: bigint, deliveryFee: bigint | undefined, total: bigint) =>
  unionValue("PriceBasketResult", "priced", structValue("PricedBasket", {
    lines: listValue(lines),
    subtotal: money(subtotal),
    ...(deliveryFee !== undefined ? { deliveryFee: money(deliveryFee) } : {}),
    total: money(total),
  }));

const pricingError = (caseName: string, payload: SemanticValue | string) =>
  unionValue("PriceBasketResult", "error", unionValue("PricingError", caseName,
    typeof payload === "string" ? stringValue(payload) : payload));

const menu = [burger, fries];

// --- Scenarios ---

spec.scenario(
  scenario("basket.price.plain-item", "an item with no modifiers and no choices prices to base x qty")
    .call("price", "basket.price", literal(request(menu, [basketItem("fries", 3n, [])], standardZone)))
    .expectEqual(binding("price"), literal(pricedBasket(
      [pricedLine("Fries", 350n, 3n, 1050n)],
      1050n, 299n, 1349n,
    )))
    .build(),
);

spec.scenario(
  scenario("basket.price.with-modifiers", "size and extras stack additively on the base price")
    .call("price", "basket.price", literal(request(menu, [basketItem("burger", 1n, [
      choose("size", "large"),
      choose("extras", "bacon"),
      choose("extras", "cheese"),
    ])], standardZone)))
    .expectEqual(binding("price"), literal(pricedBasket(
      [pricedLine("Burger", 850n + 150n + 120n + 60n, 1n, 1180n)],
      1180n, 299n, 1479n,
    )))
    .build(),
);

spec.scenario(
  scenario("basket.price.mixed-basket", "multiple items with and without modifiers price per line")
    .call("price", "basket.price", literal(request(menu, [
      basketItem("burger", 1n, [choose("size", "regular")]),
      basketItem("fries", 2n, []),
    ], standardZone)))
    .expectEqual(binding("price"), literal(pricedBasket(
      [
        pricedLine("Burger", 850n, 1n, 850n),
        pricedLine("Fries", 350n, 2n, 700n),
      ],
      1550n, 299n, 1849n,
    )))
    .build(),
);

spec.scenario(
  scenario("basket.price.missing-required", "skipping a required modifier is a domain error")
    .call("price", "basket.price", literal(request(menu, [basketItem("burger", 1n, [])], standardZone)))
    .expectEqual(binding("price"), literal(pricingError("missingRequiredModifier", "size")))
    .build(),
);

spec.scenario(
  scenario("basket.price.unknown-item", "a sku not on the menu is a domain error")
    .call("price", "basket.price", literal(request(menu, [basketItem("pizza", 1n, [])], standardZone)))
    .expectEqual(binding("price"), literal(pricingError("unknownItem", "pizza")))
    .build(),
);

spec.scenario(
  scenario("basket.price.below-minimum", "a subtotal under the zone minimum is a domain error")
    .call("price", "basket.price", literal(request(menu, [basketItem("fries", 1n, [])], standardZone)))
    .expectEqual(binding("price"), literal(pricingError("belowMinimum", money(650n))))
    .build(),
);

spec.scenario(
  scenario("basket.price.exact-minimum", "a subtotal exactly at the zone minimum passes")
    .call("price", "basket.price", literal(request(menu, [
      basketItem("burger", 1n, [choose("size", "regular")]),
      basketItem("fries", 1n, []),
    ], standardZone)))
    .expectEqual(binding("price"), literal(pricedBasket(
      [
        pricedLine("Burger", 850n, 1n, 850n),
        pricedLine("Fries", 350n, 1n, 350n),
      ],
      1200n, 299n, 1499n,
    )))
    .build(),
);

export default spec.build();
