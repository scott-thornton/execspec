import ExecSpecRuntime
import MenuGenerated

public actor MenuPricer: MENUSpecificationImplementation {
    public init() {}

    public func basketPrice(_ input: PriceBasketRequest) async throws -> PriceBasketResult {
        var menuBySku: [String: MenuItem] = [:]
        for item in input.items {
            menuBySku[item.sku] = item
        }

        var lines: [PricedLine] = []
        var subtotal: Int64 = 0

        for basketItem in input.basket {
            guard let menuItem = menuBySku[basketItem.sku] else {
                return .error(.unknownItem(basketItem.sku))
            }

            var unitPrice = menuItem.basePrice.minorUnits
            let description = menuItem.name

            for chosen in basketItem.chosen {
                guard let modifier = menuItem.modifiers.first(where: { $0.name == chosen.modifierName }) else {
                    return .error(.unknownOption(chosen))
                }
                guard let option = modifier.options.first(where: { $0.name == chosen.optionName }) else {
                    return .error(.unknownOption(chosen))
                }
                unitPrice &+= option.priceDelta.minorUnits
            }

            for modifier in menuItem.modifiers {
                let isRequired = modifier.required_ == "true"
                if isRequired && !basketItem.chosen.contains(where: { $0.modifierName == modifier.name }) {
                    return .error(.missingRequiredModifier(modifier.name))
                }
            }

            let lineTotal = unitPrice &* basketItem.quantity
            subtotal &+= lineTotal
            lines.append(PricedLine(
                description: description,
                lineTotal: Money(currency: menuItem.basePrice.currency, minorUnits: lineTotal),
                quantity: basketItem.quantity,
                unitPrice: Money(currency: menuItem.basePrice.currency, minorUnits: unitPrice)
            ))
        }

        let currency = input.zone.fee.currency
        if subtotal < input.zone.minimumOrder.minorUnits {
            let shortfall = input.zone.minimumOrder.minorUnits - subtotal
            return .error(.belowMinimum(Money(currency: currency, minorUnits: shortfall)))
        }

        let fee = input.zone.fee.minorUnits
        let total = subtotal &+ fee
        return .priced(PricedBasket(
            deliveryFee: Money(currency: currency, minorUnits: fee),
            lines: lines,
            subtotal: Money(currency: currency, minorUnits: subtotal),
            total: Money(currency: currency, minorUnits: total)
        ))
    }
}
