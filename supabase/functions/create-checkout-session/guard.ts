/**
 * Whether `create-checkout-session` may open a new Stripe Checkout for an
 * organisation, extracted so vitest can run it without Deno, a JWT or Stripe.
 * Same arrangement as `stripe-webhook/reconcile.ts`.
 *
 * The defect this closes: Checkout never looked at the organisation's existing
 * subscription. A second Checkout created a second Stripe subscription, and the
 * webhook's upsert on `org_id` then overwrote `provider_ref` with the new one,
 * orphaning the first. That first subscription kept charging the card, and
 * nothing in RotaFlow pointed at it any more.
 *
 * Nothing here touches the network or the database.
 */

export type StripeMode = 'test' | 'live';

/**
 * The error code the 409 carries. The browser matches on this exact string
 * (`src/lib/billingState.ts` holds the same value) and opens the Billing
 * Portal instead, where a plan change belongs.
 */
export const ALREADY_SUBSCRIBED = 'already_subscribed';

/** Statuses under which Stripe is, or may yet be, charging the customer. */
const LIVE_STATUSES: ReadonlySet<string> = new Set(['trialing', 'active', 'past_due']);

/** The subscription columns the decision needs. */
export interface ExistingSubscription {
  status: string | null;
  provider_ref: string | null;
  stripe_mode: string | null;
}

export type CheckoutDecision =
  { allow: true } | { allow: false; reason: typeof ALREADY_SUBSCRIBED };

/**
 * Refuse Checkout when the organisation already holds a Stripe subscription
 * that is still billing, in the same Stripe mode as this request.
 *
 * Each condition is there for a reason:
 *
 * - **A provider ref.** `admin_create_organisation_with_invite` (0084)
 *   inserts an `active` row with no Stripe subscription at all, and the
 *   column default for every row is `trialing`. Neither is a Stripe
 *   subscription that a second Checkout could duplicate, so status alone
 *   would block organisations that have never paid Stripe anything.
 * - **The same mode.** A test-mode subscription left behind by a QA run does
 *   not charge a real card, and the Billing Portal refuses a mode mismatch,
 *   so blocking a live Checkout because of it would leave the owner with no
 *   way forward.
 * - **A live status.** `canceled` is how an owner resubscribes.
 */
export function decideCheckout(
  existing: ExistingSubscription | null,
  mode: StripeMode,
): CheckoutDecision {
  if (
    existing &&
    existing.provider_ref &&
    existing.stripe_mode === mode &&
    existing.status !== null &&
    LIVE_STATUSES.has(existing.status)
  ) {
    return { allow: false, reason: ALREADY_SUBSCRIBED };
  }
  return { allow: true };
}
