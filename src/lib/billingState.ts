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

/**
 * The organisation's billing state, as `my_org_billing_state` (0154) reports
 * it. Computed by the server from the clock on every call:
 *
 * - `active`: a paid subscription;
 * - `trialing`: a Stripe trial, after Checkout inside the free trial;
 * - `grace`: a failed payment, still inside its grace window (0098);
 * - `trial`: the organisation's own 30-day trial, no card;
 * - `read_only`: none of those. Managers cannot build rotas or invite.
 */
export type OrgBillingState = 'active' | 'trialing' | 'grace' | 'trial' | 'read_only';

export interface OrgBillingSnapshot {
  state: OrgBillingState;
  trialEndsAt: string | null;
  readOnly: boolean;
}

const ORG_BILLING_STATES: ReadonlySet<string> = new Set([
  'active',
  'trialing',
  'grace',
  'trial',
  'read_only',
]);

/**
 * Narrows the RPC's text column. An unknown state is shown as nothing special,
 * and `readOnly` is always the server's own flag, so a new state can never
 * hide a read-only organisation.
 */
export function toOrgBillingSnapshot(row: {
  state: string;
  trial_ends_at: string | null;
  read_only: boolean;
}): OrgBillingSnapshot {
  const state = ORG_BILLING_STATES.has(row.state)
    ? (row.state as OrgBillingState)
    : 'active';
  return { state, trialEndsAt: row.trial_ends_at, readOnly: row.read_only === true };
}

/** "Trial, 23 days left", from the server's trial end, or null outside a trial. */
export function trialDaysLabel(trialEndsAt: string | null, now: Date): string | null {
  const left = daysLeft(trialEndsAt, now);
  if (left === null || left < 0) return null;
  if (left === 0) return 'Trial, ends today';
  return left === 1 ? 'Trial, 1 day left' : `Trial, ${left} days left`;
}

/**
 * The badge on Settings, Billing when the organisation-level state says more
 * than the subscription row can: the free trial has no subscription row at
 * all, and read-only is the absence of everything. Null means "use
 * `billingStatus` on the subscription".
 */
export function orgStateBadge(
  snapshot: OrgBillingSnapshot | null,
  now: Date,
): BillingStatus | null {
  if (!snapshot) return null;
  if (snapshot.readOnly) {
    return { label: 'Read-only, choose a plan', tone: 'danger' };
  }
  if (snapshot.state === 'trial') {
    return { label: trialDaysLabel(snapshot.trialEndsAt, now) ?? 'Trial', tone: 'info' };
  }
  return null;
}

/** The app-wide banner a manager sees once the organisation is read-only. */
export const READ_ONLY_BANNER =
  'Your trial has ended. Choose a plan to keep building rotas.';

/**
 * SQLSTATE the database raises when a read-only organisation's manager tries
 * to build (0154, `enforce_org_not_read_only`). Its message is written to be
 * shown.
 */
export const ORG_READ_ONLY_CODE = 'BILL1';

/**
 * The server's own words when a write was refused because the organisation is
 * read-only, or null for any other failure, so the caller keeps its own
 * message for those. Same rule as `clockErrorMessage`: only a code this app
 * defines is trusted to reach a person.
 */
export function readOnlyErrorMessage(err: unknown): string | null {
  if (typeof err !== 'object' || err === null) return null;
  const { code, message } = err as { code?: unknown; message?: unknown };
  if (code !== ORG_READ_ONLY_CODE) return null;
  return typeof message === 'string' && message.length > 0 ? message : READ_ONLY_BANNER;
}

/**
 * One row of the owner's invoice list on Settings, Billing (0156, plan F3).
 * The columns `listOwnerInvoices` selects, nothing more.
 */
export interface OwnerInvoiceRow {
  id: string;
  number: string;
  issued_on: string;
  amount_pence: number;
  currency: string;
  status: string;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
}

/** How many invoices the owner's list shows: a year of monthly billing. */
export const OWNER_INVOICE_LIMIT = 12;

/**
 * The word an owner sees for an invoice's status.
 *
 * `past_due` is "Failed": to the customer it is a payment that did not go
 * through, and the screen already explains what happens next. `uncollectible`
 * is Stripe's word for an invoice it has given up on. The `invoices` status
 * CHECK (0023) does not admit it today, so no row carries it yet; it is mapped
 * so the day one does, the owner reads a word rather than a code. Anything
 * else unknown is shown as its own words, never hidden.
 */
export function invoiceStatus(status: string): BillingStatus {
  switch (status) {
    case 'paid':
      return { label: 'Paid', tone: 'success' };
    case 'open':
      return { label: 'Open', tone: 'info' };
    case 'past_due':
      return { label: 'Failed', tone: 'danger' };
    case 'uncollectible':
      return { label: 'Uncollectible', tone: 'danger' };
    case 'void':
      return { label: 'Void', tone: 'neutral' };
    case 'refunded':
      return { label: 'Refunded', tone: 'neutral' };
    default: {
      const words = status.replace(/_/g, ' ');
      return { label: words.charAt(0).toUpperCase() + words.slice(1), tone: 'neutral' };
    }
  }
}

/** "12 October 2026", from a `date` column, read as a calendar day. */
export function invoiceDateLabel(isoDate: string): string {
  // A bare `yyyy-mm-dd` given to `new Date` is UTC midnight, which is the
  // previous evening west of Greenwich. `parseISO` reads it as local midnight,
  // so the day printed is the day stored.
  const date = parseISO(isoDate);
  if (!isValid(date)) return isoDate;
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** "£49.00", in the invoice's own currency. */
export function invoiceAmountLabel(row: {
  amount_pence: number;
  currency: string;
}): string {
  return formatMoneyExact(row.amount_pence, row.currency);
}
