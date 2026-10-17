package com.execspec.generated;

import com.execspec.runtime.*;
import java.util.*;

public final class BillingEngine implements BillingSpecificationImplementation {
    private final Map<String, Plan> plans = new LinkedHashMap<>();
    private final Map<String, StoredSub> subscriptions = new LinkedHashMap<>();
    private int nextId = 1;

    private static final class StoredSub {
        final String subscriptionId;
        String planId;
        SubscriptionStatus status;
        long periodStart;
        long periodEnd;

        StoredSub(String id, String planId, SubscriptionStatus status, long start, long end) {
            this.subscriptionId = id;
            this.planId = planId;
            this.status = status;
            this.periodStart = start;
            this.periodEnd = end;
        }
    }

    public BillingEngine() {
        plans.put("starter", new Plan(new Money(Currency.usd, 1900L), "starter", 14L));
        plans.put("pro", new Plan(new Money(Currency.usd, 4900L), "pro", 14L));
    }

    @Override
    public SubscribeResult billingSubscribe(SubscribeRequest input) {
        Plan plan = plans.get(input.getPlanId());
        if (plan == null) {
            return new SubscribeResult.Error(new BillingError.PlanNotFound(input.getPlanId()));
        }
        String id = "sub-" + nextId;
        nextId++;
        StoredSub sub = new StoredSub(id, input.getPlanId(), SubscriptionStatus.trialing,
            input.getAtDay(), input.getAtDay() + plan.getTrialDays());
        subscriptions.put(id, sub);
        return new SubscribeResult.Subscribed(new Subscription(
            sub.periodEnd, sub.periodStart, sub.planId, sub.status, sub.subscriptionId));
    }

    @Override
    public ActivateResult billingActivate(ActivateRequest input) {
        StoredSub sub = subscriptions.get(input.getSubscriptionId());
        if (sub == null) {
            return new ActivateResult.Error(new BillingError.SubscriptionNotFound(input.getSubscriptionId()));
        }
        if (sub.status != SubscriptionStatus.trialing) {
            return new ActivateResult.Error(new BillingError.InvalidTransition(sub.status));
        }
        sub.status = SubscriptionStatus.active;
        sub.periodStart = input.getAtDay();
        sub.periodEnd = input.getAtDay() + 30L;
        Plan plan = plans.get(sub.planId);
        List<InvoiceLine> lines = List.of(new InvoiceLine(
            plan.getMonthlyPrice(), capitalize(sub.planId) + " monthly"));
        return new ActivateResult.Activated(new Invoice(
            lines, sub.subscriptionId, plan.getMonthlyPrice()));
    }

    @Override
    public ChangePlanResult billingChangePlan(ChangePlanRequest input) {
        Plan newPlan = plans.get(input.getNewPlanId());
        if (newPlan == null) {
            return new ChangePlanResult.Error(new BillingError.PlanNotFound(input.getNewPlanId()));
        }
        StoredSub sub = subscriptions.get(input.getSubscriptionId());
        if (sub == null) {
            return new ChangePlanResult.Error(new BillingError.SubscriptionNotFound(input.getSubscriptionId()));
        }
        if (sub.status != SubscriptionStatus.active) {
            return new ChangePlanResult.Error(new BillingError.InvalidTransition(sub.status));
        }
        Plan oldPlan = plans.get(sub.planId);
        long totalDays = sub.periodEnd - sub.periodStart;
        long remaining = Math.max(0, sub.periodEnd - input.getAtDay());
        // Integer proration: floor division
        long credit = -(oldPlan.getMonthlyPrice().getMinorUnits() * remaining / totalDays);
        long charge = newPlan.getMonthlyPrice().getMinorUnits() * remaining / totalDays;
        long net = charge + credit;
        sub.planId = input.getNewPlanId();
        List<InvoiceLine> lines = List.of(
            new InvoiceLine(new Money(Currency.usd, credit),
                "Credit: " + oldPlan.getPlanId() + " unused (" + remaining + " of " + totalDays + " days)"),
            new InvoiceLine(new Money(Currency.usd, charge),
                "Charge: " + newPlan.getPlanId() + " remaining (" + remaining + " of " + totalDays + " days)")
        );
        return new ChangePlanResult.Changed(new Invoice(
            lines, sub.subscriptionId, new Money(Currency.usd, net)));
    }

    @Override
    public CancelResult billingCancel(CancelRequest input) {
        StoredSub sub = subscriptions.get(input.getSubscriptionId());
        if (sub == null) {
            return new CancelResult.Error(new BillingError.SubscriptionNotFound(input.getSubscriptionId()));
        }
        if (sub.status == SubscriptionStatus.cancelled) {
            return new CancelResult.Error(new BillingError.InvalidTransition(sub.status));
        }
        sub.status = SubscriptionStatus.cancelled;
        return new CancelResult.Cancelled(new Subscription(
            sub.periodEnd, sub.periodStart, sub.planId, sub.status, sub.subscriptionId));
    }

    private static String capitalize(String s) {
        return s.isEmpty() ? s : Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }
}
