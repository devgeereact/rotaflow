import { describe, expect, it } from 'vitest';
import {
  billingContactEmail,
  isStripeInvoiceId,
  parseBillingAccountRequest,
} from './request';

const ORG = '7e001000-0000-0000-0000-0000000000a0';
const INVOICE = '7e005000-0000-0000-0000-0000000000a0';

describe('parseBillingAccountRequest', () => {
  it('accepts sync_contact with an organisation id', () => {
    expect(parseBillingAccountRequest({ action: 'sync_contact', orgId: ORG })).toEqual({
      ok: true,
      value: { action: 'sync_contact', orgId: ORG },
    });
  });

  it('accepts invoice_links with an invoice id', () => {
    expect(
      parseBillingAccountRequest({
        action: 'invoice_links',
        orgId: ORG,
        invoiceId: INVOICE,
      }),
    ).toEqual({
      ok: true,
      value: { action: 'invoice_links', orgId: ORG, invoiceId: INVOICE },
    });
  });

  it('refuses a Stripe id in place of a RotaFlow invoice id', () => {
    // The browser must never name a Stripe object: only the stored
    // provider_ref of a row RLS let the caller read reaches Stripe.
    const result = parseBillingAccountRequest({
      action: 'invoice_links',
      orgId: ORG,
      invoiceId: 'in_1Abc',
    });
    expect(result.ok).toBe(false);
  });

  it('refuses a missing or malformed organisation id', () => {
    expect(parseBillingAccountRequest({ action: 'sync_contact' }).ok).toBe(false);
    expect(parseBillingAccountRequest({ action: 'sync_contact', orgId: 'x' }).ok).toBe(
      false,
    );
  });

  it('refuses an unknown action and a body that is not an object', () => {
    expect(parseBillingAccountRequest({ action: 'delete', orgId: ORG }).ok).toBe(false);
    expect(parseBillingAccountRequest(null).ok).toBe(false);
    expect(parseBillingAccountRequest([ORG]).ok).toBe(false);
  });
});

describe('billingContactEmail', () => {
  it('prefers the contact_email column, trimmed', () => {
    expect(
      billingContactEmail({
        contact_email: '  accounts@example.com ',
        settings: { contact_email: 'legacy@example.com' },
      }),
    ).toBe('accounts@example.com');
  });

  it('falls back to the legacy settings value, as the browser does', () => {
    expect(
      billingContactEmail({
        contact_email: null,
        settings: { contact_email: 'legacy@example.com' },
      }),
    ).toBe('legacy@example.com');
  });

  it('returns null rather than sending Stripe a blank or an obvious mistake', () => {
    expect(billingContactEmail({ contact_email: '', settings: {} })).toBeNull();
    expect(billingContactEmail({ contact_email: 'not an email' })).toBeNull();
    expect(billingContactEmail({ contact_email: 'a@b' })).toBeNull();
    expect(billingContactEmail({ settings: ['x'] })).toBeNull();
  });
});

describe('isStripeInvoiceId', () => {
  it('accepts a Stripe invoice id and nothing else', () => {
    expect(isStripeInvoiceId('in_1PqRsT2u')).toBe(true);
    expect(isStripeInvoiceId('sub_1PqRsT2u')).toBe(false);
    expect(isStripeInvoiceId('in_')).toBe(false);
    expect(isStripeInvoiceId(null)).toBe(false);
  });
});
