/**
 * What `billing-account` accepts and decides, extracted so vitest can run it
 * without Deno, a JWT or Stripe. Same arrangement as
 * `create-checkout-session/guard.ts`.
 *
 * Two owner actions, each one small call to Stripe that the browser must not
 * make because it would need a Stripe key:
 *
 * - `sync_contact` (GAP-128): write the organisation's billing contact to the
 *   Stripe customer, so receipts and invoices go to the address the owner
 *   chose instead of whoever went through Checkout.
 * - `invoice_links` (GAP-129): retrieve one invoice and return its current
 *   hosted page and PDF links. Stripe expires a stored hosted link 30 to 120
 *   days after the invoice is due, and a fresh one comes only from retrieving
 *   the invoice.
 *
 * Nothing here touches the network or the database.
 */

export type BillingAccountRequest =
  | { action: 'sync_contact'; orgId: string }
  | { action: 'invoice_links'; orgId: string; invoiceId: string };

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The request body, checked before anything is read. The invoice is named by
 * RotaFlow's own row id, never by a Stripe id from the browser: the function
 * reads the row with the caller's JWT, so RLS decides whether the caller may
 * see it, and only the stored `provider_ref` ever reaches Stripe.
 */
export function parseBillingAccountRequest(body: unknown): Parsed<BillingAccountRequest> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { ok: false, error: 'A JSON body is required' };
  }
  const record = body as Record<string, unknown>;
  const orgId = record.orgId;
  if (typeof orgId !== 'string' || !UUID.test(orgId)) {
    return { ok: false, error: 'orgId must be an organisation id' };
  }
  if (record.action === 'sync_contact') {
    return { ok: true, value: { action: 'sync_contact', orgId } };
  }
  if (record.action === 'invoice_links') {
    const invoiceId = record.invoiceId;
    if (typeof invoiceId !== 'string' || !UUID.test(invoiceId)) {
      return { ok: false, error: 'invoiceId must be an invoice id' };
    }
    return { ok: true, value: { action: 'invoice_links', orgId, invoiceId } };
  }
  return { ok: false, error: 'action must be sync_contact or invoice_links' };
}

/**
 * A plausible address, not a full RFC 5322 parse: one `@`, something on each
 * side, a dot in the domain, no spaces, and within Stripe's length limit.
 * Stripe validates it again; this only stops an obvious mistake reaching it.
 */
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * The billing contact Settings, Billing shows, read the same way
 * `orgProfileFields` reads it in the browser: the `contact_email` column
 * first, then the legacy `settings.contact_email`. Null when neither holds a
 * usable address, so the caller can say so instead of sending Stripe a blank.
 */
export function billingContactEmail(org: {
  contact_email?: string | null;
  settings?: unknown;
}): string | null {
  const fromColumn =
    typeof org.contact_email === 'string' ? org.contact_email.trim() : '';
  let candidate = fromColumn;
  if (
    !candidate &&
    org.settings &&
    typeof org.settings === 'object' &&
    !Array.isArray(org.settings)
  ) {
    const legacy = (org.settings as Record<string, unknown>).contact_email;
    candidate = typeof legacy === 'string' ? legacy.trim() : '';
  }
  if (!candidate || candidate.length > 512 || !EMAIL.test(candidate)) return null;
  return candidate;
}

/** A Stripe invoice id, which is what `invoices.provider_ref` holds. */
export function isStripeInvoiceId(ref: string | null | undefined): ref is string {
  return typeof ref === 'string' && /^in_[A-Za-z0-9]+$/.test(ref);
}
