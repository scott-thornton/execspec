import { test } from "node:test";
import assert from "node:assert/strict";
import { MenuPricer } from "../dist/MenuPricer.js";

const gbp = (n) => ({ currency: "gbp", minorUnits: n });
const opt = (name, delta) => ({ name, priceDelta: gbp(delta) });
const mod = (name, options, req) => ({ name, options, required: req ? "true" : "false" });

const burger = {
  sku: "burger",
  name: "Burger",
  basePrice: gbp(850n),
  modifiers: [
    mod("size", [opt("regular", 0n), opt("large", 150n)], true),
    mod("extras", [opt("bacon", 120n), opt("cheese", 60n)], false),
  ],
};
const fries = { sku: "fries", name: "Fries", basePrice: gbp(350n), modifiers: [] };
const zone = { name: "Zone A", fee: gbp(299n), minimumOrder: gbp(1000n) };
const menu = [burger, fries];

test("plain item meeting the minimum prices correctly", () => {
  const result = new MenuPricer().basketPrice({
    items: menu,
    basket: [{ sku: "fries", quantity: 3n, chosen: [] }],
    zone,
  });
  assert.deepEqual(result, {
    kind: "priced",
    value: {
      lines: [{ description: "Fries", unitPrice: gbp(350n), quantity: 3n, lineTotal: gbp(1050n) }],
      subtotal: gbp(1050n),
      deliveryFee: gbp(299n),
      total: gbp(1349n),
    },
  });
});

test("modifier stacking is additive", () => {
  const result = new MenuPricer().basketPrice({
    items: menu,
    basket: [{
      sku: "burger", quantity: 1n,
      chosen: [
        { modifierName: "size", optionName: "large" },
        { modifierName: "extras", optionName: "bacon" },
        { modifierName: "extras", optionName: "cheese" },
      ],
    }],
    zone,
  });
  assert.equal(result.kind, "priced");
  if (result.kind === "priced") {
    assert.equal(result.value.subtotal.minorUnits, 850n + 150n + 120n + 60n);
  }
});

test("missing required modifier is a domain error", () => {
  const result = new MenuPricer().basketPrice({
    items: menu,
    basket: [{ sku: "burger", quantity: 1n, chosen: [] }],
    zone,
  });
  assert.deepEqual(result, {
    kind: "error",
    value: { kind: "missingRequiredModifier", value: "size" },
  });
});

test("below minimum reports the shortfall", () => {
  const result = new MenuPricer().basketPrice({
    items: menu,
    basket: [{ sku: "fries", quantity: 1n, chosen: [] }],
    zone,
  });
  assert.deepEqual(result, {
    kind: "error",
    value: { kind: "belowMinimum", value: gbp(650n) },
  });
});

test("unknown sku is a domain error", () => {
  const result = new MenuPricer().basketPrice({
    items: menu,
    basket: [{ sku: "pizza", quantity: 1n, chosen: [] }],
    zone,
  });
  assert.deepEqual(result, {
    kind: "error",
    value: { kind: "unknownItem", value: "pizza" },
  });
});
