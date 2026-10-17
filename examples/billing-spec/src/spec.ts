/**
 * A subscription billing engine: plans with trials, plan changes with
 * proration, cancellation, and invoice generation. The proration math
 * (integer minor units, day-count rounding) is the kind of thing two
 * implementations get wrong independently. Every scenario pins it.
 *
 * Deterministic rules pinned by the scenarios:
 * - Days are int64 day numbers (no timestamps; day 0 = epoch).
 * - A new subscription starts in "trialing" for the plan's trialDays.
 * - Activating converts to "active" and invoices the first full period.
 * - Changing plan mid-cycle prorates: credit for unused old-plan days,
 *   debit for remaining new-plan days, rounded down to whole minor units.
 * - Cancelling from "trialing" or "active" is idempotent on the status.
 * - Invoice totals are the sum of line amounts.
 * - Proration uses integer division: credit = oldPrice * remaining / totalDays.
 */

import {
  specification, struct, union, enumeration,
  string, int64, unit, list, ref,
  operation, scenario, literal, binding,
  structValue, unionValue, enumValue, unitValue, stringValue, int64Value, listValue,
} from "@execspec/dsl";
import type { SemanticValue } from "@execspec/core";

const spec = specification({ name: "billing", version: "0.3.0" });

// --- Types ---

spec.type(enumeration("Currency", ["usd"]));
spec.type(struct("Money", { currency: ref("Currency"), minorUnits: int64() }));

spec.type(struct("Plan", {
  planId: string(),
  monthlyPrice: ref("Money"),
  trialDays: int64(),
}));

spec.type(enumeration("SubscriptionStatus", ["trialing", "active", "cancelled"]));

spec.type(struct("Subscription", {
  subscriptionId: string(),
  planId: string(),
  status: ref("SubscriptionStatus"),
  periodStart: int64(),
  periodEnd: int64(),
}));

spec.type(struct("InvoiceLine", {
  description: string(),
  amount: ref("Money"),
}));

spec.type(struct("Invoice", {
  subscriptionId: string(),
  lines: list(ref("InvoiceLine")),
  total: ref("Money"),
}));

spec.type(union("BillingError", {
  planNotFound: string(),
  subscriptionNotFound: string(),
  invalidTransition: ref("SubscriptionStatus"),
  notInTrial: unit(),
}));

spec.type(union("SubscribeResult", {
  subscribed: ref("Subscription"),
  error: ref("BillingError"),
}));

spec.type(union("ActivateResult", {
  activated: ref("Invoice"),
  error: ref("BillingError"),
}));

spec.type(union("ChangePlanResult", {
  changed: ref("Invoice"),
  error: ref("BillingError"),
}));

spec.type(union("CancelResult", {
  cancelled: ref("Subscription"),
  error: ref("BillingError"),
}));

spec.type(struct("SubscribeRequest", {
  planId: string(),
  atDay: int64(),
}));

spec.type(struct("ActivateRequest", {
  subscriptionId: string(),
  atDay: int64(),
}));

spec.type(struct("ChangePlanRequest", {
  subscriptionId: string(),
  newPlanId: string(),
  atDay: int64(),
}));

spec.type(struct("CancelRequest", {
  subscriptionId: string(),
  atDay: int64(),
}));

// --- Operations ---

spec.operation(operation("billing.subscribe", {
  input: ref("SubscribeRequest"),
  output: ref("SubscribeResult"),
}));

spec.operation(operation("billing.activate", {
  input: ref("ActivateRequest"),
  output: ref("ActivateResult"),
}));

spec.operation(operation("billing.change-plan", {
  input: ref("ChangePlanRequest"),
  output: ref("ChangePlanResult"),
}));

spec.operation(operation("billing.cancel", {
  input: ref("CancelRequest"),
  output: ref("CancelResult"),
}));

// --- Helper factories for scenario literals ---

const money = (n: bigint) => structValue("Money", { currency: enumValue("Currency", "usd"), minorUnits: n });

const starterPlan = structValue("Plan", {
  planId: stringValue("starter"),
  monthlyPrice: money(1900n),
  trialDays: int64Value(14n),
});

const proPlan = structValue("Plan", {
  planId: stringValue("pro"),
  monthlyPrice: money(4900n),
  trialDays: int64Value(14n),
});

const subscribeReq = (planId: string, atDay: bigint) =>
  structValue("SubscribeRequest", { planId: stringValue(planId), atDay });

const activateReq = (subId: string, atDay: bigint) =>
  structValue("ActivateRequest", { subscriptionId: stringValue(subId), atDay });

const changeReq = (subId: string, planId: string, atDay: bigint) =>
  structValue("ChangePlanRequest", { subscriptionId: stringValue(subId), newPlanId: stringValue(planId), atDay });

const cancelReq = (subId: string, atDay: bigint) =>
  structValue("CancelRequest", { subscriptionId: stringValue(subId), atDay });

const sub = (id: string, planId: string, status: string, start: bigint, end: bigint) =>
  unionValue("SubscribeResult", "subscribed", structValue("Subscription", {
    subscriptionId: stringValue(id),
    planId: stringValue(planId),
    status: enumValue("SubscriptionStatus", status),
    periodStart: start,
    periodEnd: end,
  }));

const invoice = (subId: string, lines: [string, bigint][], total: bigint) =>
  unionValue("ActivateResult", "activated", structValue("Invoice", {
    subscriptionId: stringValue(subId),
    lines: listValue(lines.map(([desc, amt]) =>
      structValue("InvoiceLine", { description: stringValue(desc), amount: money(amt) }),
    )),
    total: money(total),
  }));

const changeInvoice = (subId: string, lines: [string, bigint][], total: bigint) =>
  unionValue("ChangePlanResult", "changed", structValue("Invoice", {
    subscriptionId: stringValue(subId),
    lines: listValue(lines.map(([desc, amt]) =>
      structValue("InvoiceLine", { description: stringValue(desc), amount: money(amt) }),
    )),
    total: money(total),
  }));

const cancelled = (id: string, planId: string, start: bigint, end: bigint) =>
  unionValue("CancelResult", "cancelled", structValue("Subscription", {
    subscriptionId: stringValue(id),
    planId: stringValue(planId),
    status: enumValue("SubscriptionStatus", "cancelled"),
    periodStart: start,
    periodEnd: end,
  }));

const billingError = <T extends "planNotFound" | "subscriptionNotFound" | "invalidTransition" | "notInTrial">(
  resultKind: "subscribe" | "activate" | "change" | "cancel",
  errorCase: T,
  payload: SemanticValue,
) => {
  const error = unionValue("BillingError", errorCase, payload);
  switch (resultKind) {
    case "subscribe": return unionValue("SubscribeResult", "error", error);
    case "activate": return unionValue("ActivateResult", "error", error);
    case "change": return unionValue("ChangePlanResult", "error", error);
    case "cancel": return unionValue("CancelResult", "error", error);
  }
};

// --- Scenarios ---

spec.scenario(
  scenario("billing.subscribe.starts-trial", "a new subscription starts trialing for the plan's trial period")
    .call("s", "billing.subscribe", literal(subscribeReq("starter", 100n)))
    .expectEqual(binding("s"), literal(sub("sub-1", "starter", "trialing", 100n, 114n)))
    .build(),
);

spec.scenario(
  scenario("billing.subscribe.unknown-plan", "subscribing to a plan that does not exist is a domain error")
    .call("s", "billing.subscribe", literal(subscribeReq("enterprise", 0n)))
    .expectEqual(binding("s"), literal(billingError("subscribe", "planNotFound", stringValue("enterprise"))))
    .build(),
);

spec.scenario(
  scenario("billing.activate.charges-first-period", "activating after trial invoices one full month")
    .call("sub", "billing.subscribe", literal(subscribeReq("starter", 0n)))
    .call("act", "billing.activate", literal(activateReq("sub-1", 14n)))
    .expectEqual(binding("act"), literal(invoice("sub-1", [
      ["Starter monthly", 1900n],
    ], 1900n)))
    .build(),
);

spec.scenario(
  scenario("billing.activate.idempotent-rejection", "activating an already-active subscription is invalidTransition")
    .call("sub", "billing.subscribe", literal(subscribeReq("starter", 0n)))
    .call("act1", "billing.activate", literal(activateReq("sub-1", 14n)))
    .call("act2", "billing.activate", literal(activateReq("sub-1", 15n)))
    .expectEqual(binding("act2"), literal(billingError("activate", "invalidTransition", enumValue("SubscriptionStatus", "active"))))
    .build(),
);

spec.scenario(
  scenario("billing.change-plan.prorates-credit", "downgrading mid-cycle credits unused starter days and charges pro")
    .call("sub", "billing.subscribe", literal(subscribeReq("starter", 0n)))
    .call("act", "billing.activate", literal(activateReq("sub-1", 14n)))
    .call("chg", "billing.change-plan", literal(changeReq("sub-1", "pro", 29n)))
    .expectEqual(binding("chg"), literal(changeInvoice("sub-1", [
      ["Credit: starter unused (15 of 30 days)", -950n],
      ["Charge: pro remaining (15 of 30 days)", 2450n],
    ], 1500n)))
    .build(),
);

spec.scenario(
  scenario("billing.change-plan.at-period-start", "changing at period start credits the full old month and charges the full new month")
    .call("sub", "billing.subscribe", literal(subscribeReq("starter", 0n)))
    .call("act", "billing.activate", literal(activateReq("sub-1", 14n)))
    .call("chg", "billing.change-plan", literal(changeReq("sub-1", "pro", 14n)))
    .expectEqual(binding("chg"), literal(changeInvoice("sub-1", [
      ["Credit: starter unused (30 of 30 days)", -1900n],
      ["Charge: pro remaining (30 of 30 days)", 4900n],
    ], 3000n)))
    .build(),
);

spec.scenario(
  scenario("billing.cancel.from-trial", "cancelling during trial keeps the period bounds but marks cancelled")
    .call("sub", "billing.subscribe", literal(subscribeReq("starter", 100n)))
    .call("cx", "billing.cancel", literal(cancelReq("sub-1", 107n)))
    .expectEqual(binding("cx"), literal(cancelled("sub-1", "starter", 100n, 114n)))
    .build(),
);

spec.scenario(
  scenario("billing.cancel.from-active", "cancelling an active subscription marks it cancelled")
    .call("sub", "billing.subscribe", literal(subscribeReq("starter", 0n)))
    .call("act", "billing.activate", literal(activateReq("sub-1", 14n)))
    .call("cx", "billing.cancel", literal(cancelReq("sub-1", 20n)))
    .expectEqual(binding("cx"), literal(cancelled("sub-1", "starter", 14n, 44n)))
    .build(),
);

spec.scenario(
  scenario("billing.cancel.twice-is-invalid", "cancelling an already-cancelled subscription is invalidTransition")
    .call("sub", "billing.subscribe", literal(subscribeReq("starter", 0n)))
    .call("cx1", "billing.cancel", literal(cancelReq("sub-1", 5n)))
    .call("cx2", "billing.cancel", literal(cancelReq("sub-1", 10n)))
    .expectEqual(binding("cx2"), literal(billingError("cancel", "invalidTransition", enumValue("SubscriptionStatus", "cancelled"))))
    .build(),
);

export default spec.build();
