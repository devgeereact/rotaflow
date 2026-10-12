import { differenceInCalendarDays, isValid, parseISO } from 'date-fns';
import { formatMoneyExact } from '@/lib/money';

/**
 * What `/app/settings/billing` says about an organisation's billing, derived
 * from the subscription row and the entitled plan.
 *
 * Pure and in `lib` so it can be tested without the Supabase client. The
 * screen used to fall back to `'trialing'` when there was no subscription at
 * all, telling an owner who had never paid that they were on a trial.
 */

/**
 * The code `create-checkout-session` returns with its 409 when the
 * organisation already has a subscription that is billing. The same string is
 * in `supabase/functions/create-checkout-session/guard.ts`, and its test
 * asserts the two agree.
 */
export const ALREADY_SUBSCRIBED = 'already_subscribed';

export type BillingTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export interface BillingStatus {
  /** Customer-facing, sentence case. */
  label: string;
  tone: BillingTone;
}

/** The subscription columns this module reads. */
export interface BillingSubscriptionRow {
  plan: string;
  status: string;
  trial_ends_at?: string | null;
}

export const PLAN_NAMES: Record<string, string> = {
  starter: 'Starter',
  professional: 'Professional',
  business: 'Business',
  enterprise: 'Enterprise',
};

export function planName(code: string): string {
  return PLAN_NAMES[code] ?? code;
}

function daysLeft(iso: string | null | undefined, now: Date): number | null {
  if (!iso) return null;
  const date = parseISO(iso);
  if (!isValid(date)) return null;
  return differenceInCalendarDays(date, now);
}

/**
 * The status badge. No subscription is its own state, "No plan yet", never a
 * trial: a trial is something Stripe or the database has recorded, not the
 * absence of a row.
 */
export function billingStatus(
  subscription: BillingSubscriptionRow | null,
  now: Date,
): BillingStatus {
  if (!subscription) return { label: 'No plan yet', tone: 'neutral' };

  switch (subscription.status) {
    case 'active':
      return { label: 'Active', tone: 'success' };
    case 'trialing': {
      const left = daysLeft(subscription.trial_ends_at, now);
      if (left === null || left < 0) return { label: 'Trial', tone: 'info' };
      if (left === 0) return { label: 'Trial, ends today', tone: 'info' };
      return {
        label: left === 1 ? 'Trial, 1 day left' : `Trial, ${left} days left`,
        tone: 'info',
      };
    }
    case 'past_due':
      return { label: 'Payment failed', tone: 'warning' };
    case 'canceled':
      return { label: 'Cancelled', tone: 'danger' };
    default:
      return { label: subscription.status.replace(/_/g, ' '), tone: 'neutral' };
  }
}

/**
 * The plan whose limits apply. `organisations.plan` is the entitlement column
 * (0120 derives it from the subscription), so it wins over the subscription's
 * own `plan`, which can differ once a payment has lapsed past its grace.
 */
export function entitledPlan(
  orgPlan: string | null | undefined,
  subscription: BillingSubscriptionRow | null,
): string | null {
  return orgPlan ?? subscription?.plan ?? null;
}

/** "£129.00 a month", in the plan's own currency. */
export function planPriceLabel(plan: {
  monthly_price_pence: number;
  currency: string;
}): string {
  return `${formatMoneyExact(plan.monthly_price_pence, plan.currency)} a month`;
}
