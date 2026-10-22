/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

  it('offers no refresh when the page supplies no way to refresh', () => {
    render(<BillingInvoices invoices={[paid]} failed={false} />);
    expect(screen.queryAllByRole('button', { name: /Refresh the links/ })).toHaveLength(
      0,
    );
  });

  it('replaces an expired link with the one Stripe returns', async () => {
    const fresh = 'https://invoice.stripe.com/i/acct_1/test_a?s=fresh';
    const onRefreshLinks = vi.fn().mockResolvedValue({
      hosted_invoice_url: fresh,
      invoice_pdf: paid.invoice_pdf,
    });
    render(
      <BillingInvoices
        invoices={[paid]}
        failed={false}
        onRefreshLinks={onRefreshLinks}
      />,
    );
    const [button] = screen.getAllByRole('button', {
      name: /Refresh the links for invoice RF-0001/,
    });
    if (!button) throw new Error('a refresh button should render');
    fireEvent.click(button);
    expect(onRefreshLinks).toHaveBeenCalledWith('a');
    await waitFor(() => {
      const [view] = screen.getAllByRole('link', { name: /View invoice RF-0001/ });
      expect(view?.getAttribute('href')).toBe(fresh);
    });
  });

  it('keeps the stored link when the refreshed one is not on a Stripe host', async () => {
    const onRefreshLinks = vi.fn().mockResolvedValue({
      hosted_invoice_url: 'https://evil.example/i/1',
      invoice_pdf: null,
    });
    render(
      <BillingInvoices
        invoices={[paid]}
        failed={false}
        onRefreshLinks={onRefreshLinks}
      />,
    );
    const [button] = screen.getAllByRole('button', { name: /Refresh the links/ });
    if (!button) throw new Error('a refresh button should render');
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText(/Stripe returned no link/)).toBeTruthy());
    const [view] = screen.getAllByRole('link', { name: /View invoice RF-0001/ });
    expect(view?.getAttribute('href')).toBe(paid.hosted_invoice_url);
  });

  it('offers no refresh on an invoice that was never issued through Stripe', () => {
    render(
      <BillingInvoices invoices={[manual]} failed={false} onRefreshLinks={vi.fn()} />,
    );
    expect(screen.queryAllByRole('button', { name: /Refresh the links/ })).toHaveLength(
      0,
    );
  });
});
