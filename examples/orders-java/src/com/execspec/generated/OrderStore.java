package com.execspec.generated;

import com.execspec.runtime.*;
import java.util.*;

public final class OrderStore implements OrdersSpecificationImplementation {
    private static final class Line {
        final String sku;
        final String name;
        final long unitPriceMinor;
        long quantity;
        Line(String sku, String name, long unitPriceMinor, long quantity) {
            this.sku = sku; this.name = name; this.unitPriceMinor = unitPriceMinor; this.quantity = quantity;
        }
    }
    private static final class Cart {
        final List<Line> lines = new ArrayList<>();
        Currency currency = Currency.gbp;
        String promo;
    }

    private final Map<String, Cart> carts = new LinkedHashMap<>();
    private int nextCart = 1;

    @Override
    public CartResult cartAdd(AddItemRequest input) {
        Cart cart = carts.get(input.getCartId());
        if (cart == null) return err("notFound");
        if (cart.lines.isEmpty()) cart.currency = input.getItem().getUnitPrice().getCurrency();
        else if (cart.currency != input.getItem().getUnitPrice().getCurrency()) return err("currencyMismatch");
        Line existing = null;
        for (Line l : cart.lines) { if (l.sku.equals(input.getItem().getSku())) { existing = l; break; } }
        if (existing == null) {
            cart.lines.add(new Line(input.getItem().getSku(), input.getItem().getName(),
                input.getItem().getUnitPrice().getMinorUnits(), input.getItem().getQuantity()));
        } else {
            existing.quantity += input.getItem().getQuantity();
        }
        return ok(view(cart));
    }

    @Override
    public String cartCreate(Unit input) {
        String id = "cart-" + nextCart;
        nextCart++;
        carts.put(id, new Cart());
        return id;
    }

    @Override
    public PromoResult cartPromo(PromoRequest input) {
        Cart cart = carts.get(input.getCartId());
        if (cart == null) return new PromoResult.Error(CartError.NotFound.INSTANCE);
        if (!"TENOFF".equals(input.getCode())) return new PromoResult.Rejected(PromoRejection.unknownCode);
        if (subtotal(cart) < 5000L) return new PromoResult.Rejected(PromoRejection.minimumNotMet);
        cart.promo = input.getCode();
        return new PromoResult.Applied(view(cart));
    }

    @Override
    public CartResult cartRemove(RemoveItemRequest input) {
        Cart cart = carts.get(input.getCartId());
        if (cart == null) return err("notFound");
        cart.lines.removeIf(l -> l.sku.equals(input.getSku()));
        return ok(view(cart));
    }

    @Override
    public CartResult cartView(CartIdRequest input) {
        Cart cart = carts.get(input.getCartId());
        if (cart == null) return err("notFound");
        return ok(view(cart));
    }

    @Override
    public CheckoutResult orderCheckout(CheckoutRequest input) {
        Cart cart = carts.get(input.getCartId());
        if (cart == null) return CheckoutResult.NotFound.INSTANCE;
        if (cart.lines.isEmpty()) return CheckoutResult.EmptyCart.INSTANCE;
        if ("decline".equals(input.getPaymentRef())) return CheckoutResult.PaymentDeclined.INSTANCE;
        return new CheckoutResult.Confirmed(new Order(
            "ord-" + input.getCartId(), money(cart, total(cart)), input.getAt(), OrderStatus.confirmed));
    }

    private long subtotal(Cart cart) {
        long sum = 0;
        for (Line l : cart.lines) sum += l.unitPriceMinor * l.quantity;
        return sum;
    }
    private long discount(Cart cart) {
        return "TENOFF".equals(cart.promo) && subtotal(cart) >= 5000L ? 1000L : 0L;
    }
    private long total(Cart cart) { return subtotal(cart) - discount(cart); }
    private Money money(Cart cart, long minor) { return new Money(cart.currency, minor); }

    private CartView view(Cart cart) {
        List<CartItem> items = new ArrayList<>();
        for (Line l : cart.lines) {
            items.add(new CartItem(l.name, l.quantity, l.sku, new Money(cart.currency, l.unitPriceMinor)));
        }
        long disc = discount(cart);
        Money discMoney = disc > 0 ? money(cart, disc) : null;
        return new CartView(discMoney, items, money(cart, subtotal(cart)), money(cart, total(cart)));
    }

    private CartResult ok(CartView view) { return new CartResult.Ok(view); }
    private CartResult err(String caseName) {
        if ("notFound".equals(caseName)) return new CartResult.Error(CartError.NotFound.INSTANCE);
        return new CartResult.Error(CartError.CurrencyMismatch.INSTANCE);
    }
}
