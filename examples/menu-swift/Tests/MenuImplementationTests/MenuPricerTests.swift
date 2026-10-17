import Testing
@testable import MenuGenerated
@testable import MenuImplementation

private func gbp(_ n: Int64) -> Money {
    Money(currency: .gbp, minorUnits: n)
}

private func makeBurger() -> MenuItem {
    MenuItem(
        basePrice: gbp(850),
        modifiers: [
            Modifier(name: "size", options: [
                ModifierOption(name: "regular", priceDelta: gbp(0)),
                ModifierOption(name: "large", priceDelta: gbp(150)),
            ], required_: "true"),
            Modifier(name: "extras", options: [
                ModifierOption(name: "bacon", priceDelta: gbp(120)),
                ModifierOption(name: "cheese", priceDelta: gbp(60)),
            ], required_: "false"),
        ],
        name: "Burger",
        sku: "burger"
    )
}

private func makeFries() -> MenuItem {
    MenuItem(
        basePrice: gbp(350),
        modifiers: [],
        name: "Fries",
        sku: "fries"
    )
}

private func makeZone() -> DeliveryZone {
    DeliveryZone(
        fee: gbp(299),
        minimumOrder: gbp(1000),
        name: "Zone A"
    )
}

@Suite struct MenuPricerTests {
    @Test func plainItemMeetsMinimum() async throws {
        let pricer = MenuPricer()
        let result = try await pricer.basketPrice(PriceBasketRequest(
            basket: [BasketItem(chosen: [], quantity: 3, sku: "fries")],
            items: [makeBurger(), makeFries()],
            zone: makeZone()
        ))
        if case .priced(let basket) = result {
            #expect(basket.subtotal.minorUnits == 1050)
            #expect(basket.deliveryFee.minorUnits == 299)
            #expect(basket.total.minorUnits == 1349)
        } else {
            Issue.record("expected priced basket")
        }
    }

    @Test func modifierStackingIsAdditive() async throws {
        let pricer = MenuPricer()
        let result = try await pricer.basketPrice(PriceBasketRequest(
            basket: [BasketItem(chosen: [
                ChosenOption(modifierName: "size", optionName: "large"),
                ChosenOption(modifierName: "extras", optionName: "bacon"),
                ChosenOption(modifierName: "extras", optionName: "cheese"),
            ], quantity: 1, sku: "burger")],
            items: [makeBurger(), makeFries()],
            zone: makeZone()
        ))
        if case .priced(let basket) = result {
            #expect(basket.subtotal.minorUnits == 850 + 150 + 120 + 60)
            #expect(basket.total.minorUnits == 1180 + 299)
        } else {
            Issue.record("expected priced basket")
        }
    }

    @Test func missingRequiredModifierIsDomainError() async throws {
        let pricer = MenuPricer()
        let result = try await pricer.basketPrice(PriceBasketRequest(
            basket: [BasketItem(chosen: [], quantity: 1, sku: "burger")],
            items: [makeBurger(), makeFries()],
            zone: makeZone()
        ))
        if case .error(let error) = result, case .missingRequiredModifier(let name) = error {
            #expect(name == "size")
        } else {
            Issue.record("expected missingRequiredModifier")
        }
    }

    @Test func belowMinimumReportsShortfall() async throws {
        let pricer = MenuPricer()
        let result = try await pricer.basketPrice(PriceBasketRequest(
            basket: [BasketItem(chosen: [], quantity: 1, sku: "fries")],
            items: [makeBurger(), makeFries()],
            zone: makeZone()
        ))
        if case .error(let error) = result, case .belowMinimum(let shortfall) = error {
            #expect(shortfall.minorUnits == 1000 - 350)
        } else {
            Issue.record("expected belowMinimum")
        }
    }

    @Test func unknownSkuIsDomainError() async throws {
        let pricer = MenuPricer()
        let result = try await pricer.basketPrice(PriceBasketRequest(
            basket: [BasketItem(chosen: [], quantity: 1, sku: "pizza")],
            items: [makeBurger(), makeFries()],
            zone: makeZone()
        ))
        if case .error(let error) = result, case .unknownItem(let sku) = error {
            #expect(sku == "pizza")
        } else {
            Issue.record("expected unknownItem")
        }
    }
}
