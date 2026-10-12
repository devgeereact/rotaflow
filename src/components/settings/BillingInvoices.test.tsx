/**
 * @vitest-environment jsdom
 */
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { BillingInvoices } from '@/components/settings/BillingInvoices';
import type { OwnerInvoiceRow } from '@/lib/billingState';

afterEach(cleanup);

const paid: OwnerInvoiceRow = {
  id: 'a',
  number: 'RF-0001',
  issued_on: '2026-10-01',
  amount_pence: 4900,
  currency: 'GBP',
  status: 'paid',
  hosted_invoice_url: 'https://invoice.stripe.com/i/acct_1/test_a?s=ap',
  invoice_pdf: 'https://pay.stripe.com/invoice/acct_1/test_a/pdf?s=ap',
};

const manual: OwnerInvoiceRow = {
  id: 'b',
  number: 'INV-1041',
  issued_on: '2026-09-01',
  amount_pence: 12000,
  currency: 'EUR',
  status: 'past_due',
  hosted_invoice_url: null,
  invoice_pdf: null,
};

describe('BillingInvoices', () => {
  it('lists each invoice with its date, number, amount and status in words', () => {
    render(<BillingInvoices invoices={[paid, manual]} failed={false} />);
    // Rendered twice, once as a table and once as stacked rows; CSS picks one.
    expect(screen.getAllByText('1 October 2026').length).toBeGreaterThan(0);
    expect(screen.getAllByText('RF-0001').length).toBeGreaterThan(0);
    expect(screen.getAllByText('£49.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('€120.00').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Paid').length).toBeGreaterThan(0);
    expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
  });

  it('links to the stored Stripe documents in a new tab without an opener', () => {
    render(<BillingInvoices invoices={[paid]} failed={false} />);
    const [view] = screen.getAllByRole('link', { name: /View invoice RF-0001/ });
    const [pdf] = screen.getAllByRole('link', { name: /Download invoice RF-0001/ });
    if (!view || !pdf) throw new Error('both links should render');
    expect(view.getAttribute('href')).toBe(paid.hosted_invoice_url);
    expect(pdf.getAttribute('href')).toBe(paid.invoice_pdf);
    for (const link of [view, pdf]) {
      expect(link.getAttribute('target')).toBe('_blank');
      expect(link.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('offers no link for an invoice with no document, rather than guessing one', () => {
    render(<BillingInvoices invoices={[manual]} failed={false} />);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
    expect(screen.getAllByText('No document').length).toBeGreaterThan(0);
  });

  it('says so when there are no invoices yet', () => {
    render(<BillingInvoices invoices={[]} failed={false} />);
    expect(screen.getByText('No invoices yet')).toBeTruthy();
  });

  it('says the list failed rather than showing it as empty', () => {
    render(<BillingInvoices invoices={[]} failed />);
    expect(screen.getByText(/could not be loaded/)).toBeTruthy();
    expect(screen.queryByText('No invoices yet')).toBeNull();
  });
});
