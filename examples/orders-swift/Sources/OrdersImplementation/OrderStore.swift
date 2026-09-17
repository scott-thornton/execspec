// The handwritten ordering implementation (Swift target). All business
// rules live here; the scenarios above are what pin them down.

import ExecSpecRuntime
import OrdersGenerated

private struct Line {
    let sku: String
    let name: String
    let unitPriceMinor: Int64
    var quantity: Int64
}

private struct Cart {
    var lines: [Line] = []
    var currency: Currency = .gbp
    var promo: String?

    var isEmpty: Bool { lines.isEmpty }

    var subtotalMinor: Int64 {
        lines.reduce(0) { total, line in total &+ line.unitPriceMinor &* line.quantity }
    }

    var discountMinor: Int64 {
        promo == "TENOFF" && subtotalMinor >= 5000 ? 1000 : 0
    }

    var totalMinor: Int64 { subtotalMinor - discountMinor }

    func view() -> CartView {
        CartView(
            discount: discountMinor > 0
                ? Money(currency: currency, minorUnits: discountMinor)
                : nil,
            items: lines.map { line in
                CartItem(
                    name: line.name,
                    quantity: line.quantity,
                    sku: line.sku,
                    unitPrice: Money(currency: currency, minorUnits: line.unitPriceMinor)
                )
            },
            subtotal: Money(currency: currency, minorUnits: subtotalMinor),
            total: Money(currency: currency, minorUnits: totalMinor)
        )
    }
}

public actor OrderStore: OrdersSpecificationImplementation {
    private var carts: [String: Cart] = [:]
    private var nextCartNumber = 1

    public init() {}

    public func cartCreate(_ input: ExecSpecUnit) async throws -> String {
        let id = "cart-\(nextCartNumber)"
        nextCartNumber += 1
        carts[id] = Cart()
        return id
    }

    public func cartAdd(_ input: AddItemRequest) async throws -> CartResult {
        guard var cart = carts[input.cartId] else {
            return .error(.notFound)
        }
        if cart.lines.isEmpty {
            cart.currency = input.item.unitPrice.currency
        } else if cart.currency != input.item.unitPrice.currency {
            return .error(.currencyMismatch)
        }
        if let index = cart.lines.firstIndex(where: { $0.sku == input.item.sku }) {
            cart.lines[index].quantity &+= input.item.quantity
        } else {
            cart.lines.append(Line(
                sku: input.item.sku,
                name: input.item.name,
                unitPriceMinor: input.item.unitPrice.minorUnits,
                quantity: input.item.quantity
            ))
        }
        carts[input.cartId] = cart
        return .ok(cart.view())
    }

    public func cartRemove(_ input: RemoveItemRequest) async throws -> CartResult {
        guard var cart = carts[input.cartId] else {
            return .error(.notFound)
        }
        cart.lines.removeAll { $0.sku == input.sku }
        carts[input.cartId] = cart
        return .ok(cart.view())
    }

    public func cartView(_ input: CartIdRequest) async throws -> CartResult {
        guard let cart = carts[input.cartId] else {
            return .error(.notFound)
        }
        return .ok(cart.view())
    }

    public func cartPromo(_ input: PromoRequest) async throws -> PromoResult {
        guard var cart = carts[input.cartId] else {
            return .error(.notFound)
        }
        guard input.code == "TENOFF" else {
            return .rejected(.unknownCode)
        }
        guard cart.subtotalMinor >= 5000 else {
            return .rejected(.minimumNotMet)
        }
        cart.promo = input.code
        carts[input.cartId] = cart
        return .applied(cart.view())
    }

    public func orderCheckout(_ input: CheckoutRequest) async throws -> CheckoutResult {
        guard let cart = carts[input.cartId] else {
            return .notFound
        }
        guard !cart.isEmpty else {
            return .emptyCart
        }
        guard input.paymentRef != "decline" else {
            return .paymentDeclined
        }
        return .confirmed(Order(
            orderId: "ord-\(input.cartId)",
            paid: Money(currency: cart.currency, minorUnits: cart.totalMinor),
            placedAt: input.at,
            status: .confirmed
        ))
    }
}
