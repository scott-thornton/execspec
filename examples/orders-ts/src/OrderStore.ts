// The handwritten ordering implementation (TypeScript target) - the
// same business rules as the Swift OrderStore, proven by the same
// fifteen scenarios.

import type {
  AddItemRequest,
  CartItem,
  CartIdRequest,
  CartResult,
  CartView,
  CheckoutRequest,
  CheckoutResult,
  Currency,
  ExecSpecUnit,
  Money,
  PromoRequest,
  PromoResult,
  RemoveItemRequest,
} from "./OrdersGenerated/ExecSpecTypes.js";
import type { OrdersSpecificationImplementation } from "./OrdersGenerated/ExecSpecImplementation.js";

interface Line {
  readonly sku: string;
  readonly name: string;
  readonly unitPriceMinor: bigint;
  quantity: bigint;
}

interface Cart {
  lines: Line[];
  currency: Currency;
  promo?: string;
}

function subtotalMinor(cart: Cart): bigint {
  return cart.lines.reduce((total, line) => total + line.unitPriceMinor * line.quantity, 0n);
}

function discountMinor(cart: Cart): bigint {
  return cart.promo === "TENOFF" && subtotalMinor(cart) >= 5000n ? 1000n : 0n;
}

function totalMinor(cart: Cart): bigint {
  return subtotalMinor(cart) - discountMinor(cart);
}

function money(currency: Currency, minorUnits: bigint): Money {
  return { currency, minorUnits };
}

function view(cart: Cart): CartView {
  const discount = discountMinor(cart);
  return {
    items: cart.lines.map((line): CartItem => ({
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      unitPrice: money(cart.currency, line.unitPriceMinor),
    })),
    ...(discount > 0n ? { discount: money(cart.currency, discount) } : {}),
    subtotal: money(cart.currency, subtotalMinor(cart)),
    total: money(cart.currency, totalMinor(cart)),
  };
}

export class OrderStore implements OrdersSpecificationImplementation {
  private readonly carts = new Map<string, Cart>();
  private nextCartNumber = 1;

  public cartCreate(_input: ExecSpecUnit): string {
    const id = `cart-${this.nextCartNumber}`;
    this.nextCartNumber += 1;
    this.carts.set(id, { lines: [], currency: "gbp" });
    return id;
  }

  public cartAdd(input: AddItemRequest): CartResult {
    const cart = this.carts.get(input.cartId);
    if (cart === undefined) {
      return { kind: "error", value: { kind: "notFound" } };
    }
    if (cart.lines.length === 0) {
      cart.currency = input.item.unitPrice.currency;
    } else if (cart.currency !== input.item.unitPrice.currency) {
      return { kind: "error", value: { kind: "currencyMismatch" } };
    }
    const existing = cart.lines.find((line) => line.sku === input.item.sku);
    if (existing === undefined) {
      cart.lines.push({
        sku: input.item.sku,
        name: input.item.name,
        unitPriceMinor: input.item.unitPrice.minorUnits,
        quantity: input.item.quantity,
      });
    } else {
      existing.quantity += input.item.quantity;
    }
    return { kind: "ok", value: view(cart) };
  }

  public cartRemove(input: RemoveItemRequest): CartResult {
    const cart = this.carts.get(input.cartId);
    if (cart === undefined) {
      return { kind: "error", value: { kind: "notFound" } };
    }
    cart.lines = cart.lines.filter((line) => line.sku !== input.sku);
    return { kind: "ok", value: view(cart) };
  }

  public cartView(input: CartIdRequest): CartResult {
    const cart = this.carts.get(input.cartId);
    if (cart === undefined) {
      return { kind: "error", value: { kind: "notFound" } };
    }
    return { kind: "ok", value: view(cart) };
  }

  public cartPromo(input: PromoRequest): PromoResult {
    const cart = this.carts.get(input.cartId);
    if (cart === undefined) {
      return { kind: "error", value: { kind: "notFound" } };
    }
    if (input.code !== "TENOFF") {
      return { kind: "rejected", value: "unknownCode" };
    }
    if (subtotalMinor(cart) < 5000n) {
      return { kind: "rejected", value: "minimumNotMet" };
    }
    cart.promo = input.code;
    return { kind: "applied", value: view(cart) };
  }

  public orderCheckout(input: CheckoutRequest): CheckoutResult {
    const cart = this.carts.get(input.cartId);
    if (cart === undefined) {
      return { kind: "notFound" };
    }
    if (cart.lines.length === 0) {
      return { kind: "emptyCart" };
    }
    if (input.paymentRef === "decline") {
      return { kind: "paymentDeclined" };
    }
    return {
      kind: "confirmed",
      value: {
        orderId: `ord-${input.cartId}`,
        paid: money(cart.currency, totalMinor(cart)),
        placedAt: input.at,
        status: "confirmed",
      },
    };
  }
}
