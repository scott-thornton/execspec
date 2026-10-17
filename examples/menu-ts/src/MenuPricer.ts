import type {
  BasketItem,
  ChosenOption,
  MenuItem,
  Money,
  PriceBasketRequest,
  PriceBasketResult,
  PricedBasket,
  PricedLine,
} from "./MenuGenerated/ExecSpecTypes.js";
import type { MENUSpecificationImplementation } from "./MenuGenerated/ExecSpecImplementation.js";

function money(currency: Money["currency"], minorUnits: bigint): Money {
  return { currency, minorUnits };
}

export class MenuPricer implements MENUSpecificationImplementation {
  public basketPrice(input: PriceBasketRequest): PriceBasketResult {
    const menuBySku = new Map<string, MenuItem>();
    for (const item of input.items) {
      menuBySku.set(item.sku, item);
    }

    const lines: PricedLine[] = [];
    let subtotal = 0n;
    let currency: Money["currency"] = input.zone.fee.currency;

    for (const basketItem of input.basket) {
      const menuItem = menuBySku.get(basketItem.sku);
      if (menuItem === undefined) {
        return { kind: "error", value: { kind: "unknownItem", value: basketItem.sku } };
      }
      currency = menuItem.basePrice.currency;

      let unitPrice = menuItem.basePrice.minorUnits;
      for (const chosen of basketItem.chosen) {
        const modifier = menuItem.modifiers.find((m) => m.name === chosen.modifierName);
        if (modifier === undefined) {
          return { kind: "error", value: { kind: "unknownOption", value: chosen } };
        }
        const option = modifier.options.find((o) => o.name === chosen.optionName);
        if (option === undefined) {
          return { kind: "error", value: { kind: "unknownOption", value: chosen } };
        }
        unitPrice += option.priceDelta.minorUnits;
      }

      for (const modifier of menuItem.modifiers) {
        if (modifier.required === "true"
          && !basketItem.chosen.some((c: ChosenOption) => c.modifierName === modifier.name)) {
          return { kind: "error", value: { kind: "missingRequiredModifier", value: modifier.name } };
        }
      }

      const lineTotal = unitPrice * basketItem.quantity;
      subtotal += lineTotal;
      lines.push({
        description: menuItem.name,
        lineTotal: money(currency, lineTotal),
        quantity: basketItem.quantity,
        unitPrice: money(currency, unitPrice),
      });
    }

    if (subtotal < input.zone.minimumOrder.minorUnits) {
      const shortfall = input.zone.minimumOrder.minorUnits - subtotal;
      return { kind: "error", value: { kind: "belowMinimum", value: money(currency, shortfall) } };
    }

    const fee = input.zone.fee.minorUnits;
    const total = subtotal + fee;
    const priced: PricedBasket = {
      lines,
      subtotal: money(currency, subtotal),
      deliveryFee: money(currency, fee),
      total: money(currency, total),
    };
    return { kind: "priced", value: priced };
  }
}
