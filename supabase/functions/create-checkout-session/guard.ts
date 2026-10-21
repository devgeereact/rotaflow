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

/**
 * Stripe refuses a Checkout `subscription_data.trial_end` less than 48 hours
 * ahead ("at least two days if using Checkout",
 * https://docs.stripe.com/billing/testing). One hour of margin on top, so a
 * request that takes a moment to reach Stripe is not refused at the boundary.
 */
export const MIN_CHECKOUT_TRIAL_MS = 49 * 60 * 60 * 1000;

/**
 * The `subscription_data.trial_end` to send, in Unix seconds, or null for
 * "charge now".
 *
 * Every organisation starts a 30-day trial that the database records
 * (`organisations.trial_ends_at`, migration 0154). An owner who chooses a plan
 * part-way through it should not lose the days left, so Checkout collects the
 * card now and Stripe first charges it when the trial the customer was already
 * promised ends. Stripe's parameter is `subscription_data.trial_end`, a Unix
 * timestamp (https://docs.stripe.com/api/checkout/sessions/create, and
 * https://docs.stripe.com/get-started/use-cases/saas-subscriptions "Add trial
 * periods"). `trial_period_days` would restart a fresh 30 days, which is not
 * the trial the organisation has.
 *
 * No trial is sent when the trial has ended, is unreadable, or is too close
 * for Stripe to accept: the customer pays from today, which is what they
 * chose.
 */
export function checkoutTrialEnd(
  orgTrialEndsAt: string | null | undefined,
  now: Date,
): number | null {
  if (!orgTrialEndsAt) return null;
  const end = Date.parse(orgTrialEndsAt);
  if (Number.isNaN(end)) return null;
  if (end - now.getTime() < MIN_CHECKOUT_TRIAL_MS) return null;
  return Math.floor(end / 1000);
}
