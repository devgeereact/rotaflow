/**
 * Revenue arithmetic over invoices and subscriptions.
 *
 * Pure, and in `lib` so the suite can run it without a Supabase client. Every
 * figure the Subscriptions and Billing screens print comes from here, so the
 * two screens cannot disagree about what a month was worth.
 *
 * All amounts are integer pence in and integer pence out. Rounding happens
 * once, at display.
 */

export interface InvoiceLike {
  amount_pence: number;
  status: string;
  issued_on: string;
  paid_at: string | null;
  refunded_at: string | null;
  org_id: string;
}

export interface SubscriptionLike {
  org_id: string;
  plan: string;
  status: string;
  price_pence: number | null;
  started_at: string;
  canceled_at: string | null;
}

/** `YYYY-MM` for a date-or-timestamp string, compared as text everywhere below. */
export function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

/**
 * Monthly recurring revenue, in pence.
 *
 * Active and past-due count; trialing and cancelled do not. A past-due
 * subscription is still a customer with a contract. Writing it out of MRR the
 * day a card fails makes the number swing on payment retries rather than on
 * customers.
 */
export function monthlyRecurringPence(
  subscriptions: readonly SubscriptionLike[],
  planPrices: ReadonlyMap<string, number>,
): number {
  return subscriptions
    .filter((s) => s.status === 'active' || s.status === 'past_due')
    .reduce((total, s) => total + (s.price_pence ?? planPrices.get(s.plan) ?? 0), 0);
}

/** Annual run rate. Twelve times MRR, stated as what it is rather than measured. */
export function annualRunRatePence(mrrPence: number): number {
  return mrrPence * 12;
}

/** Average revenue per paying organisation, or null when there are none. */
export function averageRevenuePerOrgPence(
  mrrPence: number,
  payingOrgs: number,
): number | null {
  if (payingOrgs <= 0) return null;
  return Math.round(mrrPence / payingOrgs);
}

/** Paid in the given month, by payment date rather than issue date. */
export function collectedInMonth(
  invoices: readonly InvoiceLike[],
  month: string,
): number {
  return invoices
    .filter((i) => i.paid_at !== null && monthKey(i.paid_at) === month)
    .reduce((t, i) => t + i.amount_pence, 0);
}

/**
 * Owed and unpaid, at this moment.
 *
 * Not scoped to a month: an invoice from March that is still open is
 * outstanding today, and dropping it because the month has passed is how a
 * debt disappears from a dashboard.
 */
export function outstandingPence(invoices: readonly InvoiceLike[]): number {
  return invoices
    .filter((i) => i.status === 'open' || i.status === 'past_due')
    .reduce((t, i) => t + i.amount_pence, 0);
}

export function pastDuePence(invoices: readonly InvoiceLike[]): number {
  return invoices
    .filter((i) => i.status === 'past_due')
    .reduce((t, i) => t + i.amount_pence, 0);
}

/** Refunded in the given month, by refund date. */
export function refundedInMonth(invoices: readonly InvoiceLike[], month: string): number {
  return invoices
    .filter((i) => i.refunded_at !== null && monthKey(i.refunded_at) === month)
    .reduce((t, i) => t + i.amount_pence, 0);
}

/**
 * Collected per month, oldest first, for the revenue trend.
 *
 * Months with no payments are included as zero rather than skipped: a line
 * chart that omits a bad month draws a straight line through it.
 */
export function collectedByMonth(
  invoices: readonly InvoiceLike[],
  months: number,
  now: Date,
): { month: string; pence: number }[] {
  const keys: string[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    keys.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
  }
  return keys.map((month) => ({ month, pence: collectedInMonth(invoices, month) }));
}

/**
 * How many distinct calendar months have at least one paid invoice.
 *
 * The gate for whether a trend chart has enough real history to draw, per
 * the design decision to never zero-pad pre-launch months into a fake
 * longer history — see `docs/superpowers/specs/2026-08-19-admin-billing-real-data-design.md`.
 */
export function monthsOfPaidHistory(invoices: readonly InvoiceLike[]): number {
  const months = new Set(
    invoices.filter((i) => i.paid_at !== null).map((i) => monthKey(i.paid_at!)),
  );
  return months.size;
}

/** MRR split by plan, largest first. The mix the Subscriptions screen charts. */
export function revenueByPlan(
  subscriptions: readonly SubscriptionLike[],
  planPrices: ReadonlyMap<string, number>,
): { plan: string; pence: number; count: number }[] {
  const totals = new Map<string, { pence: number; count: number }>();
  for (const s of subscriptions) {
    if (s.status !== 'active' && s.status !== 'past_due') continue;
    const price = s.price_pence ?? planPrices.get(s.plan) ?? 0;
    const current = totals.get(s.plan) ?? { pence: 0, count: 0 };
    totals.set(s.plan, { pence: current.pence + price, count: current.count + 1 });
  }
  return [...totals.entries()]
    .map(([plan, v]) => ({ plan, ...v }))
    .sort((a, b) => b.pence - a.pence);
}

/**
 * MRR reconstructed as of a past date, using `started_at`/`canceled_at`.
 * Neither is immutable once set: `canceled_at` in particular can be
 * cleared back to `null` if a customer un-cancels through the Customer
 * Portal before their period end, and it can be set weeks before a
 * subscription actually stops — Stripe's Customer Portal defaults to
 * cancel-at-period-end, so `canceled_at` records when cancellation was
 * *requested*, not when revenue actually stopped. `status`, by contrast,
 * only flips to `canceled` when Stripe's `customer.subscription.deleted`
 * fires, i.e. when the subscription has actually, fully ended. So this
 * function's exclusion is gated on `status`, not on `canceled_at` alone: a
 * subscription counts as live MRR as of `asOf` unless its CURRENT status is
 * `canceled` AND its `canceled_at` falls at-or-before `asOf` — a
 * still-`active`/`past_due` subscription with a pending scheduled
 * cancellation keeps counting as live revenue no matter how far in the
 * future `asOf` is, matching `subscription_mrr_pence()` (the RPC backing
 * the Org Detail and real-time Subscriptions MRR tiles), which only checks
 * `status`, never `canceled_at`. Canceled exactly at `asOf` does not count,
 * matching the strict-`>` boundary `revenueChurnForMonth` relies on below.
 * Also excludes a subscription whose CURRENT status is `trialing` — a
 * trial still in progress today has never converted to paying, so it is
 * never counted as revenue. Deliberately not `status === 'active' ||
 * status === 'past_due'` like `monthlyRecurringPence` above: once a
 * subscription is canceled its status reads `canceled` regardless of
 * whether it was ever paying, so requiring `active`/`past_due` here would
 * silently exclude every real, once-paying subscription that has since
 * churned — the exact case this function exists to reconstruct. Uses each
 * subscription's current `price_pence`/plan price as a stand-in for its
 * historical value — this schema does not track price changes over time,
 * so that is the same simplification every other figure in this file
 * already makes. Known limitation of that simplification: a trial that is
 * canceled without ever converting to paying reads the same `canceled`
 * status as a real churned subscription, so it cannot be told apart from
 * genuine revenue churn by status alone.
 */
export function mrrAtDatePence(
  subscriptions: readonly SubscriptionLike[],
  planPrices: ReadonlyMap<string, number>,
  asOf: Date,
): number {
  return subscriptions
    .filter((s) => s.status !== 'trialing')
    .filter((s) => new Date(s.started_at) <= asOf)
    .filter(
      (s) =>
        !(
          s.status === 'canceled' &&
          s.canceled_at !== null &&
          new Date(s.canceled_at) <= asOf
        ),
    )
    .reduce((total, s) => total + (s.price_pence ?? planPrices.get(s.plan) ?? 0), 0);
}

/**
 * Revenue churn for one month: MRR lost to subscriptions that fully
 * terminated inside it, over MRR at the month's start. Null when starting
 * MRR was zero — a churn rate out of no revenue is a division by zero
 * dressed as 0%, same reasoning as the existing `churnRate` above.
 *
 * "Lost" means CURRENT `status === 'canceled'` (the subscription has
 * actually, fully ended — Stripe's `customer.subscription.deleted` fired)
 * AND its `canceled_at` falls inside the month. A subscription that is
 * merely scheduled to cancel — still `active`/`past_due` with a
 * future-effective `canceled_at` — has not yet stopped paying and must not
 * be counted as churn until it actually terminates, matching
 * `mrrAtDatePence`'s status-gated exclusion above. The date bounds mirror
 * `mrrAtDatePence`'s exactly — a cancellation exactly at `monthStart` was
 * never part of `startingMrr`, so it must not be counted as lost from it
 * either.
 */
export function revenueChurnForMonth(
  subscriptions: readonly SubscriptionLike[],
  planPrices: ReadonlyMap<string, number>,
  monthStart: Date,
  nextMonthStart: Date,
): number | null {
  const startingMrr = mrrAtDatePence(subscriptions, planPrices, monthStart);
  if (startingMrr <= 0) return null;
  const lost = subscriptions
    .filter((s) => s.status === 'canceled')
    .filter((s) => s.canceled_at !== null)
    .filter((s) => {
      const c = new Date(s.canceled_at!);
      return c > monthStart && c < nextMonthStart;
    })
    .reduce((total, s) => total + (s.price_pence ?? planPrices.get(s.plan) ?? 0), 0);
  return Math.round((lost / startingMrr) * 1000) / 10;
}

/**
 * Churn over a window: cancellations as a share of what was there at the start.
 *
 * Returns null when the starting population was zero, a churn rate out of no
 * customers is a division by zero dressed as 0%.
 */
export function churnRate(cancelled: number, startingCount: number): number | null {
  if (startingCount <= 0) return null;
  return Math.round((cancelled / startingCount) * 1000) / 10;
}
