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
