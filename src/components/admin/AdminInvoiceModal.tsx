import { Modal } from '@/components/ui/Modal';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { formatMoneyExact } from '@/lib/money';
import type { Invoice } from '@/services/billingService';

/**
 * One invoice, from what the database actually holds.
 *
 * ## Why this is a record and not a link to Stripe
 *
 * The View button was disabled with the title "This console has no
 * Stripe-side lookup or credit action wired in yet". That was true and it was
 * also not the only option: `invoices` (0023) persists the number, the
 * period, the amounts, the tax, the status, every date and the provider
 * reference. All of that is authorised, already loaded, and answers the
 * question somebody clicks View to ask.
 *
 * What it does NOT do is guess a provider URL. `invoices` has no
 * `hosted_invoice_url` or `invoice_pdf` column, so a link to Stripe could only
 * be assembled from `provider_ref` and a URL shape — which is a guessed
 * address that may 404, may point at the wrong Stripe mode, and would be
 * presented as if it were the customer's invoice. The panel says the hosted
 * copy is not stored, and names the reference so somebody can find it in
 * Stripe themselves.
 */

const STATUS_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  paid: 'success',
  open: 'warning',
  past_due: 'danger',
  refunded: 'neutral',
  void: 'neutral',
  draft: 'neutral',
};

function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-divider py-2 last:border-0 dark:border-divider-dark">
      <dt className="text-xs font-medium text-content-muted dark:text-content-muted-dark">
        {label}
      </dt>
      <dd className="text-sm text-content dark:text-content-dark">{children}</dd>
    </div>
  );
}

const date = (value: string | null): string =>
  value ? new Date(value).toLocaleDateString('en-GB') : 'Not recorded';

export function AdminInvoiceModal({
  invoice,
  organisationName,
  onClose,
}: {
  invoice: Invoice | null;
  organisationName: string | null;
  onClose: () => void;
}): JSX.Element {
  return (
    <Modal
      open={invoice !== null}
      onClose={onClose}
      title={invoice ? `Invoice ${invoice.number}` : 'Invoice'}
    >
      {invoice && (
        <div className="space-y-4">
          <dl>
            <Row label="Organisation">{organisationName ?? 'Organisation deleted'}</Row>
            <Row label="Status">
              <Badge tone={STATUS_TONE[invoice.status] ?? 'neutral'} dot>
                {invoice.status.replace('_', ' ')}
              </Badge>
            </Row>
            <Row label="Billing period">
              {new Date(invoice.period_start).toLocaleDateString('en-GB')} –{' '}
              {new Date(invoice.period_end).toLocaleDateString('en-GB')}
            </Row>
            {/* Net, tax and total spelled out rather than one figure. The
                table's Amount column is the total, and a reader checking a
                customer's query needs to know which of the three it is. */}
            <Row label="Net">
              {formatMoneyExact(
                invoice.amount_pence - invoice.tax_pence,
                invoice.currency,
              )}
            </Row>
            <Row label="Tax">{formatMoneyExact(invoice.tax_pence, invoice.currency)}</Row>
            <Row label="Total">
              <span className="font-semibold">
                {formatMoneyExact(invoice.amount_pence, invoice.currency)}
              </span>{' '}
              <span className="text-xs text-content-muted dark:text-content-muted-dark">
                {invoice.currency}
              </span>
            </Row>
            <Row label="Issued">{date(invoice.issued_on)}</Row>
            <Row label="Due">{date(invoice.due_on)}</Row>
            <Row label="Paid">{date(invoice.paid_at)}</Row>
            {invoice.refunded_at && (
              <Row label="Refunded">{date(invoice.refunded_at)}</Row>
            )}
            {invoice.failure_reason && (
              <Row label="Last failure">{invoice.failure_reason}</Row>
            )}
            <Row label="Payment attempts">{invoice.attempts}</Row>
            <Row label="Provider">
              {invoice.provider ? (
                <span className="font-mono text-xs">
                  {invoice.provider}
                  {invoice.provider_ref ? ` · ${invoice.provider_ref}` : ''}
                </span>
              ) : (
                'Not recorded'
              )}
            </Row>
          </dl>

          <p className="text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
            This is RotaFlow&rsquo;s own record. The provider&rsquo;s hosted invoice and
            PDF are not stored here, and this console does not construct a link to them: a
            URL assembled from the reference above would be a guess, and could point at
            the wrong Stripe mode. Use the reference to find it in Stripe.
          </p>

          <div className="flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}
