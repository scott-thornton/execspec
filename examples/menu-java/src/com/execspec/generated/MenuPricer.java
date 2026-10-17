package com.execspec.generated;

import com.execspec.runtime.*;
import java.util.*;

public final class MenuPricer implements MENUSpecificationImplementation {
    @Override
    public PriceBasketResult basketPrice(PriceBasketRequest input) {
        Map<String, MenuItem> menuBySku = new LinkedHashMap<>();
        for (MenuItem item : input.getItems()) menuBySku.put(item.getSku(), item);

        List<PricedLine> lines = new ArrayList<>();
        long subtotal = 0;
        Currency currency = input.getZone().getFee().getCurrency();

        for (BasketItem basketItem : input.getBasket()) {
            MenuItem menuItem = menuBySku.get(basketItem.getSku());
            if (menuItem == null) return err(new PricingError.UnknownItem(basketItem.getSku()));
            currency = menuItem.getBasePrice().getCurrency();

            long unitPrice = menuItem.getBasePrice().getMinorUnits();
            for (ChosenOption chosen : basketItem.getChosen()) {
                Modifier mod = null;
                for (Modifier m : menuItem.getModifiers()) {
                    if (m.getName().equals(chosen.getModifierName())) { mod = m; break; }
                }
                if (mod == null) return err(new PricingError.UnknownOption(chosen));
                ModifierOption opt = null;
                for (ModifierOption o : mod.getOptions()) {
                    if (o.getName().equals(chosen.getOptionName())) { opt = o; break; }
                }
                if (opt == null) return err(new PricingError.UnknownOption(chosen));
                unitPrice += opt.getPriceDelta().getMinorUnits();
            }

            for (Modifier mod : menuItem.getModifiers()) {
                if ("true".equals(mod.getRequired())) {
                    boolean found = false;
                    for (ChosenOption c : basketItem.getChosen()) {
                        if (c.getModifierName().equals(mod.getName())) { found = true; break; }
                    }
                    if (!found) return err(new PricingError.MissingRequiredModifier(mod.getName()));
                }
            }

            long lineTotal = unitPrice * basketItem.getQuantity();
            subtotal += lineTotal;
            lines.add(new PricedLine(menuItem.getName(), money(currency, lineTotal),
                basketItem.getQuantity(), money(currency, unitPrice)));
        }

        if (subtotal < input.getZone().getMinimumOrder().getMinorUnits()) {
            long shortfall = input.getZone().getMinimumOrder().getMinorUnits() - subtotal;
            return err(new PricingError.BelowMinimum(money(currency, shortfall)));
        }

        long fee = input.getZone().getFee().getMinorUnits();
        return new PriceBasketResult.Priced(new PricedBasket(
            money(currency, fee), lines, money(currency, subtotal), money(currency, subtotal + fee)));
    }

    private static Money money(Currency c, long minor) { return new Money(c, minor); }
    private static PriceBasketResult err(PricingError e) { return new PriceBasketResult.Error(e); }
}
