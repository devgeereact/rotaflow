import { FileText } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { CONTROL_MOTION } from '@/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { EmptyState } from '@/components/ui/EmptyState';
import {
  invoiceAmountLabel,
  invoiceDateLabel,
  invoiceStatus,
  OWNER_INVOICE_LIMIT,
  type OwnerInvoiceRow,
} from '@/lib/billingState';
import { cn } from '@/lib/utils';

/**
 * The owner's invoices on Settings, Billing (0156, plan F3).
 *
 * The rows come from `listOwnerInvoices`, so this component holds no data
 * access. Each invoice links to the two documents Stripe issued for it: the
 * hosted invoice page ("View") and the PDF ("Download PDF"). The links are
 * only ever the stored ones, which the database constrains to Stripe's own
 * hosts. Nothing here assembles a URL from a reference.
 *
 * A table from `sm` up and stacked rows below it: five columns do not fit a
 * phone, and a table that scrolls sideways hides the links, which are the
 * reason the list exists.
 */

const LINK =
  'inline-flex h-9 items-center rounded-lg px-2 text-sm font-medium text-primary-ink underline-offset-2 ' +
  'hover:bg-surface-subtle hover:underline focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-primary ' +
  'dark:text-primary-ink-dark dark:hover:bg-surface-subtle-dark';

function DocumentLinks({ invoice }: { invoice: OwnerInvoiceRow }): JSX.Element {
  if (!invoice.hosted_invoice_url && !invoice.invoice_pdf) {
    return (
      <span className="text-sm text-content-muted dark:text-content-muted-dark">
        No document
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      {invoice.hosted_invoice_url && (
        <a
          href={invoice.hosted_invoice_url}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(LINK, CONTROL_MOTION)}
          aria-label={`View invoice ${invoice.number} (opens in a new tab)`}
        >
          View
        </a>
      )}
      {invoice.invoice_pdf && (
        <a
          href={invoice.invoice_pdf}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(LINK, CONTROL_MOTION)}
          aria-label={`Download invoice ${invoice.number} as a PDF (opens in a new tab)`}
        >
          Download PDF
        </a>
      )}
    </span>
  );
}

function StatusBadge({ status }: { status: string }): JSX.Element {
  const { label, tone } = invoiceStatus(status);
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

type ColumnKey = 'date' | 'number' | 'amount' | 'status' | 'documents';

const COLUMNS: readonly DataTableColumn<OwnerInvoiceRow, ColumnKey>[] = [
  {
    key: 'date',
    label: 'Date',
    width: 'w-[20%]',
    cell: (row) => invoiceDateLabel(row.issued_on),
  },
  {
    key: 'number',
    label: 'Number',
    width: 'w-[20%]',
    cell: (row) => <span className="font-mono text-xs">{row.number}</span>,
  },
  {
    key: 'amount',
    label: 'Amount',
    width: 'w-[16%]',
    numeric: true,
    cell: (row) => invoiceAmountLabel(row),
  },
  {
    key: 'status',
    label: 'Status',
    width: 'w-[14%]',
    cell: (row) => <StatusBadge status={row.status} />,
  },
  {
    key: 'documents',
    label: 'Documents',
    align: 'right',
    cell: (row) => <DocumentLinks invoice={row} />,
  },
];

export function BillingInvoices({
  invoices,
  failed,
}: {
  invoices: readonly OwnerInvoiceRow[];
  /** The list could not be loaded. Said plainly rather than shown as empty. */
  failed: boolean;
}): JSX.Element {
  if (failed) {
    return (
      <p
        className="text-sm text-content-muted dark:text-content-muted-dark"
        role="status"
      >
        Your invoices could not be loaded. Refresh the page, or open the billing portal to
        see them in Stripe.
      </p>
    );
  }

  if (invoices.length === 0) {
    return (
      <EmptyState
        icon={FileText}
        title="No invoices yet"
        description="Your first invoice appears here once a payment is taken for your plan."
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="hidden sm:block">
        <DataTable
          caption={`Your last ${OWNER_INVOICE_LIMIT} invoices, newest first`}
          columns={COLUMNS}
          rows={invoices}
          rowKey={(row) => row.id}
          tableClassName="min-w-[40rem]"
        />
      </div>

      <ul
        className="divide-y divide-divider sm:hidden dark:divide-divider-dark"
        aria-label={`Your last ${OWNER_INVOICE_LIMIT} invoices, newest first`}
      >
        {invoices.map((invoice) => (
          <li key={invoice.id} className="space-y-2 py-3 first:pt-0 last:pb-0">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-content dark:text-content-dark">
                  {invoiceDateLabel(invoice.issued_on)}
                </p>
                <p className="truncate font-mono text-xs text-content-muted dark:text-content-muted-dark">
                  {invoice.number}
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                <span className="text-sm font-medium tabular-nums text-content dark:text-content-dark">
                  {invoiceAmountLabel(invoice)}
                </span>
                <StatusBadge status={invoice.status} />
              </div>
            </div>
            <div className="-ml-2">
              <DocumentLinks invoice={invoice} />
            </div>
          </li>
        ))}
      </ul>

      <p className="text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
        Stripe keeps these links working for about a month after each invoice is due, and
        never more than 120 days. For an older invoice, open the billing portal, which
        lists every one.
      </p>
    </div>
  );
}
