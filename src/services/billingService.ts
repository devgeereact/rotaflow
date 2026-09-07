import { supabase } from '@/lib/supabase';
import {
  clampPageSize,
  fetchAllPages,
  offsetFor,
  serverPage,
  type FetchAllResult,
  type ServerPage,
} from '@/lib/serverPage';
import type { Tables } from '@/types/database.types';

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
  const { data, error } = await supabase.from('plans').select('*').order('sort_order');
  if (error) throw error;
  return data ?? [];
}

/**
 * Recent invoices across every tenant.
 *
 * Bounded, and the screen says what it loaded: an unbounded select on a table
 * that grows once per customer per month is a query that is fine for a year
 * and then is not.
 */
export async function listInvoices(limit = 300): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .order('issued_on', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function listOrgInvoices(orgId: string, limit = 24): Promise<Invoice[]> {
  const { data, error } = await supabase
    .from('invoices')
    .select('*')
    .eq('org_id', orgId)
    .order('issued_on', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data ?? [];
}

export async function setInvoiceStatus(
  invoiceId: string,
  status: 'paid' | 'past_due' | 'refunded' | 'void',
  reason?: string,
): Promise<void> {
  const { error } = await supabase.rpc('set_invoice_status', {
    p_invoice: invoiceId,
    p_status: status,
    p_reason: reason ?? undefined,
  });
  if (error) throw error;
}

export async function issueInvoice(
  orgId: string,
  periodStart: string,
  periodEnd: string,
  amountPence?: number,
): Promise<string> {
  const { data, error } = await supabase.rpc('issue_invoice', {
    p_org: orgId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_amount_pence: amountPence ?? undefined,
  });
  if (error) throw error;
  return data;
}

/**
 * One organisation's MRR in pence, straight from `subscription_mrr_pence()` —
 * the same RPC the real-time Subscriptions MRR tile is backed by. Status-only
 * (active/past due), never `canceled_at`, so it agrees with that tile even
 * when a subscription has a scheduled-but-not-yet-effective cancellation.
 * Null when the org has no subscription row.
 */
export async function getOrgMrrPence(orgId: string): Promise<number | null> {
  const { data, error } = await supabase.rpc('subscription_mrr_pence', { p_org: orgId });
  if (error) throw error;
  return data;
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
  const { data, error } = await supabase.rpc('platform_billing_summary');
  if (error) throw error;
  return ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => ({
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

interface InvoiceRpcArgs {
  p_search?: string;
  p_status?: string[];
  p_org?: string[];
  p_currency?: string[];
  p_from?: string;
  p_to?: string;
  p_sort: string;
  p_direction: string;
  p_limit: number;
  p_offset: number;
}

function invoiceArgs(query: InvoiceQuery, limit: number, offset: number): InvoiceRpcArgs {
  const list = (values: readonly string[] | undefined): string[] | undefined =>
    values && values.length > 0 ? [...values] : undefined;
  return {
    p_search: query.search?.trim() ? query.search.trim() : undefined,
    p_status: list(query.status),
    p_org: list(query.orgIds),
    p_currency: list(query.currency),
    p_from: query.from ?? undefined,
    p_to: query.to ?? undefined,
    p_sort: query.sort ?? 'issued_on',
    p_direction: query.direction ?? 'desc',
    p_limit: limit,
    p_offset: offset,
  };
}

/** A PostgREST JSON value as a string, or null. Never `[object Object]`. */
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
  const { data, error } = await supabase.rpc(
    'platform_invoice_directory',
    invoiceArgs(query, pageSize, offsetFor(page, pageSize)),
  );
  if (error) throw error;
  const rows = (data ?? []) as unknown as Record<string, unknown>[];
  return serverPage({
    rows: rows.map(toInvoiceRow),
    total: rows.length === 0 ? 0 : Number(rows[0]?.total_count ?? 0),
    page,
    pageSize,
  });
}

/** Every matching invoice, for an export. Same predicates as the page. */
export async function listInvoiceDirectoryAll(
  query: InvoiceQuery = {},
): Promise<FetchAllResult<InvoiceDirectoryRow>> {
  return fetchAllPages<InvoiceDirectoryRow>(async (offset, limit) => {
    const { data, error } = await supabase.rpc(
      'platform_invoice_directory',
      invoiceArgs(query, limit, offset),
    );
    if (error) throw error;
    const rows = (data ?? []) as unknown as Record<string, unknown>[];
    return {
      rows: rows.map(toInvoiceRow),
      total: rows.length === 0 ? 0 : Number(rows[0]?.total_count ?? 0),
    };
  });
}
