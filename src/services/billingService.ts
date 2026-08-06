import { supabase } from '@/lib/supabase';
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
