import { api, ApiError, orgPath } from '@/lib/api';
import { listPlans as listPlansFromApi } from '@/services/billingCheckoutService';
import {
  clampPageSize,
  fetchAllPages,
  offsetFor,
  serverPage,
  type FetchAllResult,
  type ServerPage,
} from '@/lib/serverPage';
import type { Tables } from '@/types/database.types';
import { OWNER_INVOICE_LIMIT, type OwnerInvoiceRow } from '@/lib/billingState';

export type Invoice = Tables<'invoices'>;
export type Plan = Tables<'plans'>;

/**
 * Invoices and the price list (0023).
 *
 * Every money figure the console shows is a sum over these rows. Nothing is
 * cached and nothing is stored pre-aggregated, so Subscriptions and Billing
 * cannot report different revenue for the same month.
 *
 * Amounts are integer pence throughout. They are divided by 100 exactly once,
 * at the point of display, by `formatMoney` in `lib/money.ts`.
 */

export async function listPlans(): Promise<Plan[]> {
  return listPlansFromApi();
}

/** The platform invoice list, one page (platform owner, admin or finance). */
async function invoicePage(
  query: InvoiceQuery,
  limit: number,
  offset: number,
): Promise<{ rows: InvoiceDirectoryRow[]; total: number }> {
  const r = await api.get<{ invoices: Record<string, unknown>[]; total: number }>(
    '/platform/invoices',
    {
      q: query.search?.trim() || undefined,
      status: query.status?.length === 1 ? query.status[0] : undefined,
      currency: query.currency?.length === 1 ? query.currency[0] : undefined,
      org_id: query.orgIds?.length === 1 ? query.orgIds[0] : undefined,
      from: query.from ?? undefined,
      to: query.to ?? undefined,
      limit,
      offset,
    },
  );
  // The API filters on one status, currency and organisation at a time; several are narrowed here.
  const rows = r.invoices
    .map(toInvoiceRow)
    .filter(
      (row) =>
        (!query.status ||
          query.status.length <= 1 ||
          query.status.includes(row.status)) &&
        (!query.currency ||
          query.currency.length <= 1 ||
          query.currency.includes(row.currency)) &&
        (!query.orgIds || query.orgIds.length <= 1 || query.orgIds.includes(row.org_id)),
    );
  return { rows, total: r.total };
}

/**
 * Recent invoices across every tenant.
 *
 * Bounded, and the screen says what it loaded: an unbounded select on a table
 * that grows once per customer per month is a query that is fine for a year
 * and then is not.
 */
export async function listInvoices(limit = 300): Promise<Invoice[]> {
  const out: Invoice[] = [];
  for (let offset = 0; out.length < limit; offset += 200) {
    const page = await invoicePage({}, Math.min(200, limit - out.length), offset);
    out.push(...page.rows);
    if (page.rows.length === 0 || out.length >= page.total) break;
  }
  return out;
}

export async function listOrgInvoices(orgId: string, limit = 24): Promise<Invoice[]> {
  return (await invoicePage({ orgIds: [orgId] }, Math.min(200, limit), 0)).rows;
}

/**
 * The owner's own invoices for Settings, Billing (0156, plan F3): the most
 * recent twelve, newest first, with Stripe's hosted page and PDF links.
 *
 * RLS is the guard: `invoices_select` returns rows only to the organisation's
 * owners (and platform billing roles), so a manager calling this gets an empty
 * list, not an error. Drafts are left out because a draft is not yet a claim
 * on anybody and has no document. `created_at` breaks a tie between two
 * invoices issued on the same day.
 */
export async function listOwnerInvoices(
  orgId: string,
  limit = OWNER_INVOICE_LIMIT,
): Promise<OwnerInvoiceRow[]> {
  // Owner only. The document links are fetched fresh from Stripe on demand (refreshInvoiceLinks), so the list
  // says only whether there are any.
  const r = await api.get<{
    invoices: {
      id: string;
      number: string;
      issued_on: string;
      amount_pence: number | string;
      currency: string;
      status: string;
      has_links: boolean | number;
    }[];
  }>(orgPath(orgId, '/billing'));
  return r.invoices
    .filter((i) => i.status !== 'draft')
    .slice(0, limit)
    .map((i) => ({
      id: i.id,
      number: i.number,
      issued_on: i.issued_on,
      amount_pence: Number(i.amount_pence),
      currency: i.currency,
      status: i.status,
      hosted_invoice_url: i.has_links ? 'on-request' : null,
      invoice_pdf: i.has_links ? 'on-request' : null,
    }));
}

export async function setInvoiceStatus(
  _invoiceId: string,
  _status: 'paid' | 'past_due' | 'refunded' | 'void',
  _reason?: string,
): Promise<void> {
  // Invoices are created and updated by Stripe (the signed webhook); there is no manual path on the API.
  return Promise.reject(
    new ApiError(
      405,
      'not_available',
      'Invoices are issued and updated by Stripe, not by hand.',
    ),
  );
}

export async function issueInvoice(
  _orgId: string,
  _periodStart: string,
  _periodEnd: string,
  _amountPence?: number,
): Promise<string> {
  // Invoices are created and updated by Stripe (the signed webhook); there is no manual path on the API.
  return Promise.reject(
    new ApiError(
      405,
      'not_available',
      'Invoices are issued and updated by Stripe, not by hand.',
    ),
  );
}

/**
 * One organisation's MRR in pence, straight from `subscription_mrr_pence()` —
 * the same RPC the real-time Subscriptions MRR tile is backed by. Status-only
 * (active/past due), never `canceled_at`, so it agrees with that tile even
 * when a subscription has a scheduled-but-not-yet-effective cancellation.
 * Null when the org has no subscription row.
 */
export async function getOrgMrrPence(orgId: string): Promise<number | null> {
  // The plan's list price while the subscription is billing (active or past due), as the summary counts it.
  const r = await api.get<{ organisation: { plan: string; sub_status: string | null } }>(
    `/platform/orgs/${encodeURIComponent(orgId)}`,
  );
  const o = r.organisation;
  if (!o.sub_status || !['active', 'past_due'].includes(o.sub_status)) return null;
  const plan = (await listPlans()).find((p) => p.code === o.plan);
  return plan ? plan.monthly_price_pence : null;
}

/**
 * Revenue, collections, debt and refunds across every tenant, per currency.
 *
 * ## Why this is not a sum in the browser
 *
 * The billing console summed `listInvoices(300)`. That list is honestly
 * bounded and its comment says so; what nothing said is that Collected,
 * Outstanding, Past due and Refunds were sums over it, printed as platform
 * totals. `invoices` grows once per customer per month, so past three hundred
 * rows "outstanding" quietly means "outstanding among the recent three
 * hundred", which is not a debt figure.
 *
 * ## Why it is a list and not a number
 *
 * One row per currency, never converted. Adding £100 to €100 gives 200 of
 * nothing, and `formatMoney` would print it with a pound sign. Exchange rates
 * are a product decision with a rate source and a date behind them; grouping
 * needs neither and cannot be wrong.
 */
export interface BillingSummaryRow {
  currency: string;
  mrrPence: number;
  payingOrgs: number;
  collectedMonthPence: number;
  collectedPrevMonthPence: number;
  outstandingPence: number;
  pastDuePence: number;
  refundedMonthPence: number;
  openInvoices: number;
  pastDueInvoices: number;
  refundedInvoices: number;
}

export async function getBillingSummary(): Promise<BillingSummaryRow[]> {
  const r = await api.get<{ summary: Record<string, unknown>[] }>(
    '/platform/billing/summary',
  );
  return r.summary.map((row) => ({
    currency: text(row.currency) ?? 'GBP',
    mrrPence: Number(row.mrr_pence ?? 0),
    payingOrgs: Number(row.paying_orgs ?? 0),
    collectedMonthPence: Number(row.collected_month_pence ?? 0),
    collectedPrevMonthPence: Number(row.collected_prev_month_pence ?? 0),
    outstandingPence: Number(row.outstanding_pence ?? 0),
    pastDuePence: Number(row.past_due_pence ?? 0),
    refundedMonthPence: Number(row.refunded_month_pence ?? 0),
    openInvoices: Number(row.open_invoices ?? 0),
    pastDueInvoices: Number(row.past_due_invoices ?? 0),
    refundedInvoices: Number(row.refunded_invoices ?? 0),
  }));
}

export interface InvoiceDirectoryRow extends Invoice {
  /** Resolved server-side, so the list does not need every organisation. */
  org_name: string | null;
}

export interface InvoiceQuery {
  search?: string;
  status?: readonly string[];
  orgIds?: readonly string[];
  currency?: readonly string[];
  /** `YYYY-MM-DD`. `to` is exclusive. */
  from?: string | null;
  to?: string | null;
  sort?: string;
  direction?: 'asc' | 'desc';
  page?: number;
  pageSize?: number;
}

function text(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : null;
}

function toInvoiceRow(row: Record<string, unknown>): InvoiceDirectoryRow {
  return {
    id: text(row.id) ?? '',
    org_id: text(row.org_id) ?? '',
    org_name: text(row.org_name),
    number: text(row.number) ?? '',
    period_start: text(row.period_start) ?? '',
    period_end: text(row.period_end) ?? '',
    amount_pence: Number(row.amount_pence ?? 0),
    tax_pence: Number(row.tax_pence ?? 0),
    currency: text(row.currency) ?? 'GBP',
    status: text(row.status) ?? '',
    issued_on: text(row.issued_on) ?? '',
    due_on: text(row.due_on) ?? '',
    paid_at: text(row.paid_at),
    refunded_at: text(row.refunded_at),
    failure_reason: text(row.failure_reason),
    attempts: Number(row.attempts ?? 0),
    provider: text(row.provider),
    provider_ref: text(row.provider_ref),
    // `platform_invoice_directory` does not return the 0156 document links;
    // the console does not show them (AdminInvoiceModal says why).
    hosted_invoice_url: null,
    invoice_pdf: null,
    created_at: text(row.created_at) ?? text(row.issued_on) ?? '',
    updated_at: text(row.updated_at) ?? text(row.issued_on) ?? '',
  };
}

/** One page of invoices, with the count for the whole matching set. */
export async function listInvoiceDirectory(
  query: InvoiceQuery = {},
): Promise<ServerPage<InvoiceDirectoryRow>> {
  const pageSize = clampPageSize(query.pageSize);
  const page = Math.max(1, Math.trunc(query.page ?? 1));
  const r = await invoicePage(query, pageSize, offsetFor(page, pageSize));
  return serverPage({ rows: sortRows(r.rows, query), total: r.total, page, pageSize });
}

/** The API orders by issue date, newest first; any other order the console asks for is applied to the page. */
function sortRows(
  rows: InvoiceDirectoryRow[],
  query: InvoiceQuery,
): InvoiceDirectoryRow[] {
  const key = (query.sort ?? 'issued_on') as keyof InvoiceDirectoryRow;
  const dir = query.direction === 'asc' ? 1 : -1;
  return [...rows].sort((a, b) => {
    const x = a[key];
    const y = b[key];
    if (typeof x === 'number' && typeof y === 'number') return (x - y) * dir;
    return String(x ?? '').localeCompare(String(y ?? '')) * dir;
  });
}

/** Every matching invoice, for an export. Same predicates as the page. */
export async function listInvoiceDirectoryAll(
  query: InvoiceQuery = {},
): Promise<FetchAllResult<InvoiceDirectoryRow>> {
  return fetchAllPages<InvoiceDirectoryRow>((offset, limit) =>
    invoicePage(query, limit, offset),
  );
}
