/**
 * Provider-independent decisions the Stripe webhook has to make, extracted so
 * they can be tested without `Deno.serve`, a signing secret or a Stripe
 * account.
 *
 * `supabase/functions/**` is excluded from typecheck and lint, and nothing
 * automated reads it — `ai-rota-assistant/grounding.ts` is the worked example
 * of taking the decision-making part out of a handler so vitest can run it
 * unchanged. RF-04 and RF-05 are both decision bugs, not transport bugs, so
 * this is where they belong.
 *
 * Nothing here touches the network or the database. Every function takes what
 * is already known and returns what should happen.
 */

export type StripeMode = 'test' | 'live';

/** What the database already holds for an invoice, as far as reconciliation cares. */
export interface KnownInvoice {
  status: string;
  /** Set when the invoice has been paid. */
  paid_at?: string | null;
  attempts?: number | null;
}

export interface FailureDecision {
  /** Whether to write `past_due` and the failure reason at all. */
  apply: boolean;
  /** The dunning attempt count to store. */
  attempts: number;
  /** Why, for the log and for the tests. */
  reason: 'first-failure' | 'further-failure' | 'already-paid' | 'duplicate-delivery';
}

/**
 * What a `invoice.payment_failed` event should do to an invoice we may
 * already know about.
 *
 * Three rules, each one a defect the audit reproduced.
 *
 * **A paid invoice does not regress.** Stripe does not promise ordered
 * delivery, so a failure from before the customer's successful retry can
 * arrive after the `invoice.paid` for the same invoice. The old handler wrote
 * `past_due` regardless, which suspended a customer who had already paid. If
 * the invoice we hold is already `paid`, the failure is stale news about a
 * resolved problem.
 *
 * **A redelivery is not another attempt.** `attempts` is meant to count
 * attempts on the CARD. The old code did `(existing.attempts ?? 0) + 1` on
 * every delivery, so Stripe retrying its own webhook — which it does, by
 * design, until it gets a 200 — inflated the dunning count and shortened the
 * grace period. Stripe's own `attempt_count` on the invoice is the authority,
 * and it is used when present.
 *
 * **An unchanged failure is idempotent.** Reapplying the same failure to an
 * invoice already sitting at that attempt count writes nothing new.
 */
export function decideInvoiceFailure(
  known: KnownInvoice | null,
  providerAttemptCount: number | null | undefined,
): FailureDecision {
  if (known && (known.status === 'paid' || known.paid_at)) {
    return { apply: false, attempts: known.attempts ?? 0, reason: 'already-paid' };
  }

  const held = known?.attempts ?? 0;

  // Stripe's count is authoritative when it sends one. Falling back to
  // "one more than we hold" keeps the old behaviour only where there is
  // nothing better, and it is bounded below by what we already recorded so a
  // late-arriving early event cannot count down.
  const attempts =
    typeof providerAttemptCount === 'number' && providerAttemptCount > 0
      ? Math.max(providerAttemptCount, held)
      : held + 1;

  if (known && attempts === held) {
    return { apply: false, attempts: held, reason: 'duplicate-delivery' };
  }

  return {
    apply: true,
    attempts,
    reason: known ? 'further-failure' : 'first-failure',
  };
}

/**
 * The filter every financial write must carry.
 *
 * RF-05: `handleInvoicePaymentFailed` updated `subscriptions` on `org_id`
 * alone. Both Stripe modes deliver to the same URL on purpose — flipping
 * `STRIPE_MODE` for a QA run must not start dropping live events — so an
 * org_id-only filter let a test fixture reach a live subscription, and an
 * invoice from a replaced subscription reach its replacement.
 *
 * Returned as data rather than applied inline so a test can assert the shape
 * of the filter without a database. A missing `provider_ref` yields `null`,
 * and the caller must then decline to write rather than widen the filter: an
 * event we cannot pin to one subscription is one we do not know the target of.
 */
export interface SubscriptionScope {
  org_id: string;
  provider_ref: string;
  stripe_mode: StripeMode;
}

export function subscriptionScope(
  orgId: string | null | undefined,
  subscriptionRef: string | null | undefined,
  mode: StripeMode,
): SubscriptionScope | null {
  if (!orgId || !subscriptionRef) return null;
  return { org_id: orgId, provider_ref: subscriptionRef, stripe_mode: mode };
}

/** The subscription id on an invoice, whether expanded or a bare string. */
export function subscriptionRefOf(invoice: {
  subscription?: string | { id?: string } | null;
}): string | null {
  const sub = invoice.subscription;
  if (typeof sub === 'string') return sub;
  return sub?.id ?? null;
}

/**
 * The part of a Stripe Subscription that `customer.subscription.updated`
 * writes. Timestamps are Unix seconds, as Stripe sends them.
 */
export interface SubscriptionSnapshot {
  id: string;
  status: string;
  current_period_end: number;
  canceled_at: number | null;
  /** When a Stripe trial ends. Absent or null when there is no trial. */
  trial_end?: number | null;
}

/**
 * Which copy of a subscription `customer.subscription.updated` should write:
 * the one in the event, or the one just retrieved from Stripe.
 *
 * The ordering defect. Stripe does not deliver events in order, so an older
 * `updated` (say, `past_due` from before the customer's card recovered) could
 * land after a newer one and overwrite the newer state. Comparing
 * `event.created` is not a safe fix: Stripe records it in whole seconds, so
 * distinct events share a timestamp, and its own documentation says not to
 * use it to order events
 * (https://docs.stripe.com/events/how-events-work#event-ordering). It
 * recommends retrieving the object instead, which `handleCheckoutCompleted`
 * already does.
 *
 * So the handler retrieves the subscription and writes what Stripe holds now.
 * Every delivery, stale or not, then writes current state, and the order they
 * arrive in stops mattering. No new column is needed.
 *
 * A retrieved object for a different id is a bug, not a newer state, and
 * returns null so the caller declines to write rather than crossing two
 * subscriptions. A failed retrieval also returns null; the caller throws, so
 * Stripe retries rather than the stale payload being written.
 */
export function freshestSubscription<T extends SubscriptionSnapshot>(
  fromEvent: T,
  retrieved: T | null,
): T | null {
  if (!retrieved) return null;
  if (retrieved.id !== fromEvent.id) return null;
  return retrieved;
}

// subscriptions.status has a check constraint of only
// ('trialing','active','past_due','canceled') — 0002_rotaflow.sql — but
// Stripe's real Subscription.Status enum is wider (incomplete,
// incomplete_expired, unpaid, paused). Map onto the 4 allowed values rather
// than widen the constraint; a schema change is a separate, controller-gated
// step, not something this webhook does on its own.
export function mapSubscriptionStatus(stripeStatus: string): string {
  switch (stripeStatus) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
    case 'incomplete_expired':
      return 'past_due';
    case 'canceled':
    case 'paused':
      return 'canceled';
    default:
      // Stripe's API can add statuses over time. Past due warns the owner
      // without cutting anything off.
      return 'past_due';
  }
}

/** The `subscriptions` columns a subscription update writes, plan aside. */
export function subscriptionUpdatePayload(sub: SubscriptionSnapshot): {
  status: string;
  current_period_end: string;
  canceled_at: string | null;
  trial_ends_at: string | null;
} {
  return {
    status: mapSubscriptionStatus(sub.status),
    current_period_end: new Date(sub.current_period_end * 1000).toISOString(),
    canceled_at: sub.canceled_at ? new Date(sub.canceled_at * 1000).toISOString() : null,
    trial_ends_at: trialEndsAtIso(sub.trial_end),
  };
}

/**
 * `subscriptions.trial_ends_at` from Stripe's `trial_end`. Since 0154 the
 * column means a STRIPE trial's end, and `org_billing_state` treats a
 * `trialing` row as entitled only while it is ahead.
 */
export function trialEndsAtIso(trialEnd: number | null | undefined): string | null {
  return typeof trialEnd === 'number' && trialEnd > 0
    ? new Date(trialEnd * 1000).toISOString()
    : null;
}

/**
 * Whether `customer.subscription.deleted` may suspend the organisation.
 *
 * The cancellation itself is scoped to `(org_id, provider_ref)`, so a late
 * `deleted` for a subscription the organisation has since replaced matches no
 * row and changes nothing. The suspension was not scoped: it called
 * `set_org_status` on `org_id` alone, so an old subscription's exhausted
 * dunning, delivered after the owner had resubscribed, would suspend an
 * organisation that is paying. The rule: suspend only when the cancellation
 * write matched the row the organisation actually holds, and only for the
 * involuntary reason Stripe reports after dunning runs out.
 */
export function shouldSuspendOnDeleted(
  matchedStoredSubscription: boolean,
  cancellationReason: string | null | undefined,
): boolean {
  return matchedStoredSubscription && cancellationReason === 'payment_failed';
}

/**
 * A row for `notification_outbox` (0069). The payload is exactly the body
 * `send-notification` expects. `dedupe_key` is unique where present (0093),
 * so Stripe redelivering an event cannot tell an owner twice.
 */
export interface OutboxRow {
  org_id: string;
  event_name: string;
  payload: {
    orgId: string;
    userIds: string[];
    type: string;
    title: string;
    body: string;
  };
  dedupe_key: string;
}

/** "15 October 2026", in UK time, from Unix seconds. */
export function londonDate(unixSeconds: number): string {
  return new Intl.DateTimeFormat('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'Europe/London',
  }).format(new Date(unixSeconds * 1000));
}

/**
 * `customer.subscription.trial_will_end`: Stripe sends it three days before a
 * trial ends (https://docs.stripe.com/billing/subscriptions/trials). The
 * owners are told, because billing is theirs. Null when there is nobody to
 * tell, so the caller writes nothing rather than an outbox row
 * `send-notification` would refuse.
 */
export function trialEndingNotification(input: {
  orgId: string;
  ownerIds: string[];
  subscriptionId: string;
  trialEnd: number | null | undefined;
  mode: StripeMode;
}): OutboxRow | null {
  if (input.ownerIds.length === 0) return null;
  const when =
    typeof input.trialEnd === 'number' && input.trialEnd > 0
      ? `Your card will first be charged on ${londonDate(input.trialEnd)}.`
      : 'Your card will be charged when the trial ends.';
  return {
    org_id: input.orgId,
    event_name: 'billing/trial_will_end',
    payload: {
      orgId: input.orgId,
      userIds: input.ownerIds,
      type: 'billing',
      title: 'Your trial ends in 3 days',
      body: `${when} To change plan or cancel, open Settings, Billing.`,
    },
    dedupe_key: `stripe:trial_will_end:${input.mode}:${input.subscriptionId}:${input.trialEnd ?? 'none'}`,
  };
}

/**
 * `invoice.payment_failed`: one notice per invoice, not one per retry. Stripe
 * retries a card several times over a fortnight, and the owner needs to hear
 * it once with what to do, not on every attempt.
 */
export function paymentFailedNotification(input: {
  orgId: string;
  ownerIds: string[];
  invoiceId: string;
  mode: StripeMode;
}): OutboxRow | null {
  if (input.ownerIds.length === 0) return null;
  return {
    org_id: input.orgId,
    event_name: 'billing/payment_failed',
    payload: {
      orgId: input.orgId,
      userIds: input.ownerIds,
      type: 'billing',
      title: 'Payment failed',
      body: 'We could not take payment for your RotaFlow plan. Your card will be retried. Update it in Settings, Billing to keep your plan active.',
    },
    dedupe_key: `stripe:payment_failed:${input.mode}:${input.invoiceId}`,
  };
}

/** Postgres' unique violation: the outbox already holds this notification. */
export function isAlreadyQueued(error: { code?: string | null } | null): boolean {
  return error?.code === '23505';
}
