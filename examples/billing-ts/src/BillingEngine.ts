import type {
  ActivateRequest,
  ActivateResult,
  CancelRequest,
  CancelResult,
  ChangePlanRequest,
  ChangePlanResult,
  Invoice,
  InvoiceLine,
  Money,
  Plan,
  SubscribeRequest,
  SubscribeResult,
  Subscription,
  SubscriptionStatus,
} from "./BillingGenerated/ExecSpecTypes.js";
import type { BillingSpecificationImplementation } from "./BillingGenerated/ExecSpecImplementation.js";

interface Stored {
  subscriptionId: string;
  planId: string;
  status: SubscriptionStatus;
  periodStart: bigint;
  periodEnd: bigint;
}

const usd = (n: bigint): Money => ({ currency: "usd", minorUnits: n });

export class BillingEngine implements BillingSpecificationImplementation {
  private readonly plans = new Map<string, Plan>();
  private readonly subscriptions = new Map<string, Stored>();
  private nextId = 1;

  constructor() {
    for (const plan of [
      { planId: "starter", monthlyPrice: usd(1900n), trialDays: 14n },
      { planId: "pro", monthlyPrice: usd(4900n), trialDays: 14n },
    ]) {
      this.plans.set(plan.planId, plan);
    }
  }

  public billingSubscribe(input: SubscribeRequest): SubscribeResult {
    const plan = this.plans.get(input.planId);
    if (plan === undefined) {
      return { kind: "error", value: { kind: "planNotFound", value: input.planId } };
    }
    const id = `sub-${this.nextId}`;
    this.nextId += 1;
    const stored: Stored = {
      subscriptionId: id,
      planId: input.planId,
      status: "trialing",
      periodStart: input.atDay,
      periodEnd: input.atDay + plan.trialDays,
    };
    this.subscriptions.set(id, stored);
    return {
      kind: "subscribed",
      value: {
        subscriptionId: stored.subscriptionId,
        planId: stored.planId,
        status: stored.status,
        periodStart: stored.periodStart,
        periodEnd: stored.periodEnd,
      },
    };
  }

  public billingActivate(input: ActivateRequest): ActivateResult {
    const stored = this.subscriptions.get(input.subscriptionId);
    if (stored === undefined) {
      return { kind: "error", value: { kind: "subscriptionNotFound", value: input.subscriptionId } };
    }
    if (stored.status !== "trialing") {
      return { kind: "error", value: { kind: "invalidTransition", value: stored.status } };
    }
    stored.status = "active";
    stored.periodStart = input.atDay;
    stored.periodEnd = input.atDay + 30n;
    const plan = this.plans.get(stored.planId)!;
    const invoice: Invoice = {
      subscriptionId: stored.subscriptionId,
      lines: [{
        description: `${stored.planId.charAt(0).toUpperCase()}${stored.planId.slice(1)} monthly`,
        amount: plan.monthlyPrice,
      }],
      total: plan.monthlyPrice,
    };
    return { kind: "activated", value: invoice };
  }

  public billingChangePlan(input: ChangePlanRequest): ChangePlanResult {
    const newPlan = this.plans.get(input.newPlanId);
    if (newPlan === undefined) {
      return { kind: "error", value: { kind: "planNotFound", value: input.newPlanId } };
    }
    const stored = this.subscriptions.get(input.subscriptionId);
    if (stored === undefined) {
      return { kind: "error", value: { kind: "subscriptionNotFound", value: input.subscriptionId } };
    }
    if (stored.status !== "active") {
      return { kind: "error", value: { kind: "invalidTransition", value: stored.status } };
    }
    const oldPlan = this.plans.get(stored.planId)!;
    const totalDays = stored.periodEnd - stored.periodStart;
    const remaining = stored.periodEnd > input.atDay ? stored.periodEnd - input.atDay : 0n;
    const credit = -(oldPlan.monthlyPrice.minorUnits * remaining / totalDays);
    const charge = newPlan.monthlyPrice.minorUnits * remaining / totalDays;
    const net = charge + credit;
    stored.planId = input.newPlanId;
    const lines: InvoiceLine[] = [
      {
        description: `Credit: ${oldPlan.planId} unused (${remaining} of ${totalDays} days)`,
        amount: usd(credit),
      },
      {
        description: `Charge: ${newPlan.planId} remaining (${remaining} of ${totalDays} days)`,
        amount: usd(charge),
      },
    ];
    return {
      kind: "changed",
      value: { subscriptionId: stored.subscriptionId, lines, total: usd(net) },
    };
  }

  public billingCancel(input: CancelRequest): CancelResult {
    const stored = this.subscriptions.get(input.subscriptionId);
    if (stored === undefined) {
      return { kind: "error", value: { kind: "subscriptionNotFound", value: input.subscriptionId } };
    }
    if (stored.status === "cancelled") {
      return { kind: "error", value: { kind: "invalidTransition", value: stored.status } };
    }
    stored.status = "cancelled";
    return {
      kind: "cancelled",
      value: {
        subscriptionId: stored.subscriptionId,
        planId: stored.planId,
        status: stored.status,
        periodStart: stored.periodStart,
        periodEnd: stored.periodEnd,
      },
    };
  }
}
