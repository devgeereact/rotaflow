import { differenceInCalendarDays, isValid, parseISO } from 'date-fns';

/**
 * Subscription-period derivations for `/admin/subscriptions` and
 * `/admin/billing`.
 *
 * Pure and in `lib` for the usual reason. The service layer pulls in the
 * Supabase client, which reaches for a WebSocket Node does not have.
 *
 * Everything here is about *when a period ends*, because that is the only
 * billing-shaped fact this schema holds. There is no amount on a subscription
 * and no payment provider connected, so nothing in this file computes money.
 */

/** The subscription columns these functions need. */
export interface BillingSubscription {
  org_id: string;
  plan: string;
  status: string;
  provider: string | null;
  current_period_end: string | null;
}

export type RenewalBucket = 'overdue' | 'week' | 'month' | 'quarter' | 'later' | 'none';

export const RENEWAL_LABELS: Record<RenewalBucket, string> = {
  overdue: 'Period already ended',
  week: 'Within 7 days',
  month: 'Within 30 days',
  quarter: 'Within 90 days',
  later: 'More than 90 days',
  none: 'No period recorded',
};

/**
 * Whole days from `now` until a period ends. Negative once it has passed.
 *
 * Calendar days, not elapsed milliseconds: "renews in 1 day" should mean
 * tomorrow, whatever the clock time, and dividing a millisecond difference by
 * 86,400,000 makes that flip between 0 and 1 depending on the hour the page was
 * opened. It would also drift by an hour across the DST changes, in a suite
 * that runs in Europe/London and a CI that builds in UTC.
 */
export function daysUntil(iso: string | null, now: Date): number | null {
  if (!iso) return null;
  const parsed = parseISO(iso);
  if (!isValid(parsed)) return null;
  return differenceInCalendarDays(parsed, now);
}

/** Which renewal window a subscription's period end falls into. */
export function renewalBucket(iso: string | null, now: Date): RenewalBucket {
  const days = daysUntil(iso, now);
  if (days === null) return 'none';
  if (days < 0) return 'overdue';
  if (days <= 7) return 'week';
  if (days <= 30) return 'month';
  if (days <= 90) return 'quarter';
  return 'later';
}

/** Counts per renewal window, in the order they should be displayed. */
export function renewalBreakdown(
  subs: readonly BillingSubscription[],
  now: Date,
): { bucket: RenewalBucket; label: string; count: number }[] {
  const order: RenewalBucket[] = ['overdue', 'week', 'month', 'quarter', 'later', 'none'];
  const counts = new Map<RenewalBucket, number>();
  for (const sub of subs) {
    const bucket = renewalBucket(sub.current_period_end, now);
    counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
  }
  return order.map((bucket) => ({
    bucket,
    label: RENEWAL_LABELS[bucket],
    count: counts.get(bucket) ?? 0,
  }));
}

/**
 * Subscriptions that need a human: past due, or a period that has already ended
 * while the record still claims to be active.
 *
 * The second case is the one worth surfacing. Nothing advances
 * `current_period_end` on this deployment, so an "active" subscription whose
 * period ended three months ago is not a customer in arrears. It is a record
 * nobody is maintaining. Both look identical on a status badge alone.
 */
export function needsAttention(
  subs: readonly BillingSubscription[],
  now: Date,
): { sub: BillingSubscription; why: string }[] {
  const out: { sub: BillingSubscription; why: string }[] = [];
  for (const sub of subs) {
    if (sub.status === 'past_due') {
      out.push({ sub, why: 'Marked past due' });
      continue;
    }
    const days = daysUntil(sub.current_period_end, now);
    if (sub.status === 'active' && days !== null && days < 0) {
      out.push({
        sub,
        why: `Active, but the period ended ${Math.abs(days)} day${Math.abs(days) === 1 ? '' : 's'} ago`,
      });
    }
  }
  return out;
}
