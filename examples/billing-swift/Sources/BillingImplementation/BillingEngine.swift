import ExecSpecRuntime
import BillingGenerated

struct StoredSubscription {
    let subscriptionId: String
    var planId: String
    var status: SubscriptionStatus
    var periodStart: Int64
    var periodEnd: Int64
}

public actor BillingEngine: BillingSpecificationImplementation {
    private var plans: [String: Plan] = [:]
    private var subscriptions: [String: StoredSubscription] = [:]
    private var nextId = 1

    public init() {
        // Plans are seeded deterministically for the contract.
        for plan in [
            Plan(monthlyPrice: Money(currency: .usd, minorUnits: 1900), planId: "starter", trialDays: 14),
            Plan(monthlyPrice: Money(currency: .usd, minorUnits: 4900), planId: "pro", trialDays: 14),
        ] {
            plans[plan.planId] = plan
        }
    }

    public func billingSubscribe(_ input: SubscribeRequest) async throws -> SubscribeResult {
        guard let plan = plans[input.planId] else {
            return .error(.planNotFound(input.planId))
        }
        let id = "sub-\(nextId)"
        nextId += 1
        let sub = StoredSubscription(
            subscriptionId: id,
            planId: input.planId,
            status: .trialing,
            periodStart: input.atDay,
            periodEnd: input.atDay + plan.trialDays
        )
        subscriptions[id] = sub
        return .subscribed(Subscription(
            periodEnd: sub.periodEnd,
            periodStart: sub.periodStart,
            planId: sub.planId,
            status: sub.status,
            subscriptionId: sub.subscriptionId
        ))
    }

    public func billingActivate(_ input: ActivateRequest) async throws -> ActivateResult {
        guard var sub = subscriptions[input.subscriptionId] else {
            return .error(.subscriptionNotFound(input.subscriptionId))
        }
        guard sub.status == .trialing else {
            return .error(.invalidTransition(sub.status))
        }
        sub.status = .active
        sub.periodStart = input.atDay
        sub.periodEnd = input.atDay + 30
        subscriptions[input.subscriptionId] = sub
        let plan = plans[sub.planId]!
        return .activated(Invoice(
            lines: [InvoiceLine(amount: plan.monthlyPrice, description: "\(sub.planId.capitalized) monthly")],
            subscriptionId: sub.subscriptionId,
            total: plan.monthlyPrice
        ))
    }

    public func billingChangePlan(_ input: ChangePlanRequest) async throws -> ChangePlanResult {
        guard let newPlan = plans[input.newPlanId] else {
            return .error(.planNotFound(input.newPlanId))
        }
        guard var sub = subscriptions[input.subscriptionId] else {
            return .error(.subscriptionNotFound(input.subscriptionId))
        }
        guard sub.status == .active else {
            return .error(.invalidTransition(sub.status))
        }
        let oldPlan = plans[sub.planId]!
        let totalDays = sub.periodEnd - sub.periodStart
        let remaining = max(0, sub.periodEnd - input.atDay)
        // Integer proration: floor division, credit is negative.
        let credit = -(oldPlan.monthlyPrice.minorUnits * remaining / totalDays)
        let charge = newPlan.monthlyPrice.minorUnits * remaining / totalDays
        let net = charge + credit
        sub.planId = input.newPlanId
        subscriptions[input.subscriptionId] = sub
        var lines: [InvoiceLine] = []
        if credit != 0 {
            lines.append(InvoiceLine(
                amount: Money(currency: .usd, minorUnits: credit),
                description: "Credit: \(oldPlan.planId) unused (\(remaining) of \(totalDays) days)"
            ))
        } else {
            lines.append(InvoiceLine(
                amount: Money(currency: .usd, minorUnits: 0),
                description: "Credit: \(oldPlan.planId) unused (\(remaining) of \(totalDays) days)"
            ))
        }
        lines.append(InvoiceLine(
            amount: Money(currency: .usd, minorUnits: charge),
            description: "Charge: \(newPlan.planId) remaining (\(remaining) of \(totalDays) days)"
        ))
        return .changed(Invoice(
            lines: lines,
            subscriptionId: sub.subscriptionId,
            total: Money(currency: .usd, minorUnits: net)
        ))
    }

    public func billingCancel(_ input: CancelRequest) async throws -> CancelResult {
        guard var sub = subscriptions[input.subscriptionId] else {
            return .error(.subscriptionNotFound(input.subscriptionId))
        }
        guard sub.status != .cancelled else {
            return .error(.invalidTransition(sub.status))
        }
        sub.status = .cancelled
        subscriptions[input.subscriptionId] = sub
        return .cancelled(Subscription(
            periodEnd: sub.periodEnd,
            periodStart: sub.periodStart,
            planId: sub.planId,
            status: sub.status,
            subscriptionId: sub.subscriptionId
        ))
    }
}
