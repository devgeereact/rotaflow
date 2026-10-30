import { api, orgPath, seg } from '@/lib/api';
import type { Tables } from '@/types/database.types';
import type { InvoiceLinks } from '@/lib/billingState';

export type Plan = Tables<'plans'>;

/**
 * The price list, in display order. RLS allows any signed-in user to read
 * it (0023) — an upgrade screen has to be able to say what the next plan
 * costs before the caller is confirmed as this org's owner.
 */
export async function listPlans(): Promise<Plan[]> {
  const r = await api.get<{
    plans: (Omit<
      Plan,
      | 'created_at'
      | 'updated_at'
      | 'sort_order'
      | 'stripe_price_id'
      | 'stripe_test_price_id'
    > & {
      purchasable: boolean;
    })[];
  }>('/plans');
  // The API names whether each plan can be bought in this deployment; the price ids stay on the server.
  return r.plans.map((p, i) => ({
    ...p,
    sort_order: i,
    created_at: '',
    updated_at: '',
    stripe_price_id: p.purchasable ? 'configured' : null,
    stripe_test_price_id: p.purchasable ? 'configured' : null,
  }));
}

/**
 * The API client raises an `ApiError`
 * on any non-2xx response, leaving `result.data` null — so the specific
 * message the Edge Function returned (e.g. "Professional is not available
 * for checkout yet") never reaches the caller by default. The real body is
 * still readable off `.context`, which is the raw `Response`.
 */

/**
 * Starts a Stripe Checkout for the given plan and redirects the whole page
 * to it — there is no in-app checkout UI, Stripe hosts it entirely.
 */
export async function startCheckout(orgId: string, planCode: string): Promise<void> {
  const r = await api.post<{ url: string }>(orgPath(orgId, '/billing/checkout'), {
    plan: planCode,
  });
  window.location.href = r.url;
}

/**
 * Opens Stripe's hosted Customer Portal for invoices, payment method
 * updates and cancellation. Redirects the whole page, same as checkout.
 */
export async function openBillingPortal(orgId: string): Promise<void> {
  const r = await api.post<{ url: string }>(orgPath(orgId, '/billing/portal'));
  window.location.href = r.url;
}

/**
 * Writes the organisation's billing contact (its contact email) to the Stripe
 * customer, so receipts and invoices go there (GAP-128). The server reads the
 * stored address; the browser sends only the organisation. Returns the
 * address Stripe now holds.
 */
export async function syncBillingContact(orgId: string): Promise<string> {
  const r = await api.post<{ email: string }>(orgPath(orgId, '/billing/sync-contact'));
  return r.email;
}

/**
 * Asks Stripe for an invoice's current links (GAP-129). A stored hosted link
 * expires 30 to 120 days after the invoice is due; retrieving the invoice is
 * the only way to get a working one. The invoice is named by RotaFlow's own
 * row id, never a Stripe id.
 */
export async function refreshInvoiceLinks(
  orgId: string,
  invoiceId: string,
): Promise<InvoiceLinks> {
  const r = await api.post<Partial<InvoiceLinks>>(
    orgPath(orgId, `/billing/invoices/${seg(invoiceId)}/links`),
  );
  return {
    hosted_invoice_url: r.hosted_invoice_url ?? null,
    invoice_pdf: r.invoice_pdf ?? null,
  };
}
