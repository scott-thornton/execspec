import Testing
@testable import OrdersGenerated
@testable import OrdersImplementation

@Suite struct OrderStoreTests {
    @Test func mergeKeepsFirstUnitPrice() async throws {
        let store = OrderStore()
        let cartId = try await store.cartCreate(ExecSpecUnit())
        _ = try await store.cartAdd(AddItemRequest(cartId: cartId, item: CartItem(
            name: "Tea", quantity: 2, sku: "tea",
            unitPrice: Money(currency: .gbp, minorUnits: 325)
        )))
        _ = try await store.cartAdd(AddItemRequest(cartId: cartId, item: CartItem(
            name: "Tea", quantity: 3, sku: "tea",
            unitPrice: Money(currency: .gbp, minorUnits: 300)
        )))
        let result = try await store.cartView(CartIdRequest(cartId: cartId))
        if case .ok(let view) = result {
            #expect(view.subtotal.minorUnits == 1625)
            #expect(view.discount == nil)
            if let first = view.items.first {
                #expect(first.quantity == 5)
                #expect(first.unitPrice.minorUnits == 325)
            } else {
                Issue.record("expected merged line")
            }
        } else {
            Issue.record("expected ok view")
        }
    }

    @Test func promoAndCheckoutMoney() async throws {
        let store = OrderStore()
        let cartId = try await store.cartCreate(ExecSpecUnit())
        _ = try await store.cartAdd(AddItemRequest(cartId: cartId, item: CartItem(
            name: "Plate", quantity: 2, sku: "plate",
            unitPrice: Money(currency: .gbp, minorUnits: 2500)
        )))
        let promo = try await store.cartPromo(PromoRequest(cartId: cartId, code: "TENOFF"))
        if case .applied(let view) = promo {
            #expect(view.subtotal.minorUnits == 5000)
            #expect(view.discount?.minorUnits == 1000)
            #expect(view.total.minorUnits == 4000)
        } else {
            Issue.record("expected applied promo")
        }
        let checkout = try await store.orderCheckout(CheckoutRequest(at: 1730000000, cartId: cartId, paymentRef: "pm_good"))
        if case .confirmed(let order) = checkout {
            #expect(order.orderId == "ord-\(cartId)")
            #expect(order.paid.minorUnits == 4000)
            #expect(order.placedAt == 1730000000)
        } else {
            Issue.record("expected confirmed order")
        }
    }

    @Test func domainFailuresAreValues() async throws {
        let store = OrderStore()
        let missing = try await store.cartView(CartIdRequest(cartId: "nope"))
        if case .error(let error) = missing, case .notFound = error {
        } else {
            Issue.record("expected notFound")
        }
        let cartId = try await store.cartCreate(ExecSpecUnit())
        let empty = try await store.orderCheckout(CheckoutRequest(at: 1, cartId: cartId, paymentRef: "pm"))
        if case .emptyCart = empty {
        } else {
            Issue.record("expected emptyCart")
        }
    }
}
