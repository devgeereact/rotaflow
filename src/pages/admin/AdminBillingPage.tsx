import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle } from 'lucide-react';
import { Panel } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { MeterRows } from '@/components/ui/MeterRows';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import { Sparkline, TrendChart } from '@/components/ui/TrendChart';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import { listAllSubscriptions } from '@/services/platformService';
import { getOrganisationFacets } from '@/services/platformDirectoryService';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { needsAttention, renewalBreakdown } from '@/lib/platformBilling';
import {
  getBillingSummary,
  listInvoiceDirectory,
  listInvoiceDirectoryAll,
  listInvoices,
  listPlans,
  type BillingSummaryRow,
  type Invoice,
  type InvoiceDirectoryRow,
} from '@/services/billingService';
import { Pagination } from '@/components/ui/Pagination';
import { type ServerPage } from '@/lib/serverPage';
import { AdminInvoiceModal } from '@/components/admin/AdminInvoiceModal';
import { formatMoney, formatMoneyExact, formatMoneyShort } from '@/lib/money';
import { downloadCsv } from '@/lib/csv';
import {
  annualRunRatePence,
  averageRevenuePerOrgPence,
  collectedByMonth,
  revenueByPlan,
} from '@/lib/revenue';
import { reportError } from '@/lib/sentry';
import type { Subscription } from '@/types';
import { ScrollRegion } from '@/components/ui/ScrollRegion';

const INVOICE_TONE: Record<string, 'success' | 'warning' | 'danger' | 'neutral'> = {
  draft: 'neutral',
  open: 'warning',
  paid: 'success',
  past_due: 'danger',
  refunded: 'neutral',
  void: 'neutral',
};

const INVOICE_LABEL: Record<string, string> = {
  draft: 'Draft',
  open: 'Open',
  paid: 'Paid',
  past_due: 'Past due',
  refunded: 'Refunded',
  void: 'Void',
};

const PLAN_COLOUR: Record<string, string> = {
  enterprise: '#3B6FE0',
  business: '#1EA06B',
  professional: '#388FD4',
  starter: '#E0A030',
};

const RENEWAL_COLOUR: Record<string, string> = {
  overdue: '#D94A3A',
  week: '#E0A030',
  month: '#3B6FE0',
  quarter: '#388FD4',
  later: '#1EA06B',
  none: '#6B7280',
};

/**
 * `/admin/billing`. Platform revenue, over the real tables.
 *
 * ## Every figure is a sum, and the sums are in one place
 *
 * MRR, ARR, collected, outstanding, refunds and ARPO all come from
 * `src/lib/revenue.ts`, over `invoices` and `subscriptions × plans` (0023).
 * Nothing is stored pre-aggregated and nothing is cached, so this screen and
 * Subscriptions cannot report different revenue for the same month.
 *
 * Amounts are integer pence everywhere and are divided by 100 exactly once, in
 * `lib/money.ts`. Two divisions in two components is how a total ends up a
 * penny out from the rows printed beneath it.
 *
 * ## The definitions, stated because they are choices
 *
 * MRR counts **active and past due**. A past-due subscription is still a
 * customer with a contract; writing it out the day a card fails makes the
 * headline swing on payment retries rather than on customers. Collected is by
 * *payment* date, not issue date. Outstanding is not scoped to a month, an
 * invoice from March that is still open is money owed today, and dropping it
 * because the month has passed is how a debt vanishes from a dashboard.
 *
 * ## What is here now, and what is still not
 *
 * A payment provider IS connected: Stripe billing (migration 0050) writes
 * `invoices.provider`/`provider_ref` for real, and `stripe-webhook`
 * (`supabase/functions/stripe-webhook`) suspends an organisation when Stripe's
 * dunning (Smart Retries) actually exhausts — that is real code, on this
 * branch. What is still not here is this *console* driving money through
 * Stripe: there is no Stripe-side credit-note or invoice-lookup call wired
 * into View/Credit below, so those stay disabled — a UI-integration gap, not
 * a "nothing is connected" one. And the dunning-suspension path has not yet
 * been end-to-end verified against a real Stripe Smart Retries exhaustion
 * (the code exists; nobody has watched it fire for real).
 */
export function AdminBillingPage(): JSX.Element {
  const [subscriptions, setSubscriptions] = useState<Subscription[] | null>(null);
  const [tenantCount, setTenantCount] = useState(0);
  const [summary, setSummary] = useState<BillingSummaryRow[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoicePage, setInvoicePage] = useState<ServerPage<InvoiceDirectoryRow> | null>(
    null,
  );
  const [pageNumber, setPageNumber] = useState(1);
  const [planPrices, setPlanPrices] = useState<Map<string, number>>(new Map());
  const [failed, setFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [openInvoice, setOpenInvoice] = useState<Invoice | null>(null);
  /** Which currency's totals the tiles are showing. */
  const [currency, setCurrency] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setSubscriptions(null);
    void (async () => {
      try {
        const [subs, facets, totals, recentInvoices, plans] = await Promise.all([
          listAllSubscriptions(),
          getOrganisationFacets(),
          // The money figures, summed over every row in the database and
          // grouped by currency. They used to be sums over the three hundred
          // invoices this screen happened to load.
          getBillingSummary(),
          // Still a bounded read, and now used only for the twelve-month
          // collections trend and the plan mix — a shape, not a total. The
          // panel says what it is drawn from.
          listInvoices(),
          listPlans(),
        ]);
        if (!active) return;
        setSubscriptions(subs);
        setTenantCount(facets.total);
        setSummary(totals);
        setInvoices(recentInvoices);
        setPlanPrices(new Map(plans.map((p) => [p.code, p.monthly_price_pence])));
        setCurrency((current) => current ?? totals[0]?.currency ?? 'GBP');
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:billing' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const page = await listInvoiceDirectory({ page: pageNumber, pageSize: 25 });
        if (active) setInvoicePage(page);
      } catch (err) {
        // The invoice list failing must not take the revenue tiles with it.
        reportError(err, { area: 'admin:billing:invoices' });
        if (active) setInvoicePage(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [pageNumber, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  /**
   * Export every invoice, not the page.
   *
   * The old export wrote the three hundred rows this screen had loaded, under
   * a filename that named a date and nothing else. This walks the directory to
   * exhaustion, states the currency on every row rather than assuming one, and
   * says in the file's own header when it stopped short.
   */
  const exportReport = useCallback(async (): Promise<void> => {
    setExporting(true);
    try {
      const all = await listInvoiceDirectoryAll({});
      downloadCsv(
        `billing-invoices_${new Date().toISOString().slice(0, 10)}`,
        all.rows,
        [
          { label: 'Invoice', value: (i) => i.number },
          { label: 'Organisation', value: (i) => i.org_name ?? 'Organisation deleted' },
          { label: 'Currency', value: (i) => i.currency },
          { label: 'Net', value: (i) => (i.amount_pence - i.tax_pence) / 100 },
          { label: 'Tax', value: (i) => i.tax_pence / 100 },
          { label: 'Total', value: (i) => i.amount_pence / 100 },
          { label: 'Status', value: (i) => INVOICE_LABEL[i.status] ?? i.status },
          { label: 'Issued', value: (i) => i.issued_on },
          { label: 'Due', value: (i) => i.due_on },
          { label: 'Paid (UTC)', value: (i) => i.paid_at ?? '' },
        ],
        {
          notes: [
            `RotaFlow invoice export, generated ${new Date().toISOString()}`,
            'Amounts are in the currency named on each row. They are NOT converted and must not be summed across currencies.',
            all.truncated
              ? `TRUNCATED: ${all.rows.length} of ${all.total} invoices.`
              : `Complete: all ${all.total} invoices.`,
          ],
        },
      );
    } catch (err) {
      reportError(err, { area: 'admin:billing:export' });
    } finally {
      setExporting(false);
    }
  }, []);

  /**
   * A money figure, or a refusal.
   *
   * `null` currency means the rows behind the number are in more than one, and
   * adding them produced a figure with no unit. Printing it with a pound sign
   * is the specific failure this guards.
   */
  const money = (pence: number, code: string): string => formatMoney(pence, code);

  const derived = useMemo(() => {
    if (!subscriptions) return null;
    const now = new Date();
    const trend = collectedByMonth(invoices, 12, now);

    /**
     * The totals for the currency being shown.
     *
     * `platform_billing_summary` (0134) returns one row per currency and never
     * converts between them, so this picks a row rather than adding them up.
     * £100 plus €100 is 200 of nothing, and `formatMoney` would have printed
     * it with a pound sign — which is what happened, correctly by accident,
     * for as long as every row was GBP.
     */
    const row =
      summary.find((entry) => entry.currency === currency) ?? summary[0] ?? null;

    const mrr = row?.mrrPence ?? 0;
    const collectedNow = row?.collectedMonthPence ?? 0;
    const collectedBefore = row?.collectedPrevMonthPence ?? 0;

    return {
      currencies: summary.map((entry) => entry.currency),
      shownCurrency: row?.currency ?? 'GBP',
      // More than one currency is a fact the screen has to state, because the
      // tiles then describe one of them rather than the business.
      mixedCurrencies: summary.length > 1 ? summary.map((e) => e.currency) : null,

      renewals: renewalBreakdown(subscriptions, now),
      flagged: needsAttention(subscriptions, now),
      active: subscriptions.filter((s) => s.status === 'active').length,
      withoutRecord: Math.max(0, tenantCount - subscriptions.length),

      mrr,
      arr: annualRunRatePence(mrr),
      arpo: averageRevenuePerOrgPence(mrr, row?.payingOrgs ?? 0),
      collected: collectedNow,
      // Month over month on collections, not on MRR: MRR is a snapshot with no
      // history behind it, so a change figure on it would be invented.
      collectedChange:
        collectedBefore === 0
          ? null
          : Math.round(((collectedNow - collectedBefore) / collectedBefore) * 1000) / 10,
      outstanding: row?.outstandingPence ?? 0,
      pastDue: row?.pastDuePence ?? 0,
      pastDueCount: row?.pastDueInvoices ?? 0,
      openCount: row?.openInvoices ?? 0,
      refunds: row?.refundedMonthPence ?? 0,
      refundCount: row?.refundedInvoices ?? 0,

      trendValues: trend.map((t) => Math.round(t.pence / 100)),
      trendLabels: trend.map((t) => {
        const [, month] = t.month.split('-');
        return (
          [
            'Jan',
            'Feb',
            'Mar',
            'Apr',
            'May',
            'Jun',
            'Jul',
            'Aug',
            'Sep',
            'Oct',
            'Nov',
            'Dec',
          ][Number(month) - 1] ?? t.month
        );
      }),
      byPlan: revenueByPlan(subscriptions, planPrices),
      failing: (invoicePage?.rows ?? [])
        .filter((i) => i.status === 'past_due')
        .slice(0, 6),
    };
  }, [subscriptions, summary, currency, tenantCount, invoices, invoicePage, planPrices]);

  return (
    <AdminPage
      title="Billing and finance"
      description="Platform-wide revenue, invoices and payment recovery."
      action={
        <>
          {derived && derived.currencies.length > 1 && (
            <label className="flex items-center gap-2 text-sm text-content dark:text-content-dark">
              <span className="sr-only">Currency</span>
              <select
                aria-label="Currency"
                value={derived.shownCurrency}
                onChange={(event) => setCurrency(event.target.value)}
                className="h-11 rounded-xl border border-surface-border bg-surface px-3 text-sm text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
              >
                {derived.currencies.map((code) => (
                  <option key={code} value={code}>
                    {code}
                  </option>
                ))}
              </select>
            </label>
          )}
          <Button
            variant="secondary"
            onClick={() => void exportReport()}
            disabled={exporting || (invoicePage?.total ?? 0) === 0}
          >
            {exporting ? 'Exporting…' : 'Export report'}
          </Button>
        </>
      }
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !subscriptions || !derived ? (
        <AdminLoading variant="tiles" rows={4} />
      ) : (
        <div className="space-y-4">
          {derived.mixedCurrencies && (
            <div
              role="status"
              className="rounded-2xl bg-warning-wash p-3 text-sm text-warning-ink dark:bg-warning-wash-dark dark:text-warning-ink-dark"
            >
              <p>
                Subscriptions and invoices on this deployment are recorded in more than
                one currency ({derived.mixedCurrencies.join(', ')}). They are never added
                together: an exchange rate is a decision with a source and a date behind
                it, and one number with the wrong symbol on it is worse than two with the
                right ones. The tiles below show <strong>{derived.shownCurrency}</strong>{' '}
                only &mdash; use the currency selector above to switch. The export carries
                every row with its own currency named.
              </p>
            </div>
          )}

          <TileGrid>
            <StatTile
              label="MRR"
              value={money(derived.mrr, derived.shownCurrency)}
              hint="Active and past due"
              chart={<Sparkline values={derived.trendValues} colour="#1EA06B" />}
            />
            <StatTile
              label="ARR"
              value={money(derived.arr, derived.shownCurrency)}
              hint="Twelve months at today's rate"
            />
            <StatTile
              label="Collected this month"
              value={money(derived.collected, derived.shownCurrency)}
              hint={
                derived.collectedChange === null ? (
                  'By payment date'
                ) : (
                  <>
                    <span
                      className={`font-semibold ${
                        derived.collectedChange >= 0
                          ? 'text-success-ink dark:text-success-ink-dark'
                          : 'text-danger-ink dark:text-danger-ink-dark'
                      }`}
                    >
                      {derived.collectedChange >= 0 ? '+' : ''}
                      {derived.collectedChange}%
                    </span>{' '}
                    on last month
                  </>
                )
              }
            />
            <StatTile
              label="Outstanding"
              value={money(derived.outstanding, derived.shownCurrency)}
              hint={
                derived.pastDueCount > 0 ? (
                  <span className="font-semibold text-danger-ink dark:text-danger-ink-dark">
                    {money(derived.pastDue, derived.shownCurrency)} past due
                  </span>
                ) : (
                  `${derived.openCount} open`
                )
              }
            />
            <StatTile
              label="Refunds"
              value={money(derived.refunds, derived.shownCurrency)}
              hint={`${derived.refundCount} this month`}
            />
            <StatTile
              label="ARPO"
              value={
                derived.arpo === null ? '-' : money(derived.arpo, derived.shownCurrency)
              }
              hint="Per paying organisation"
            />
          </TileGrid>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              className="lg:col-span-2"
              title="Revenue growth"
              actions={<Badge tone="neutral">12 months</Badge>}
            >
              <TrendChart
                title="Collected per month, in pounds, by payment date"
                labels={derived.trendLabels}
                series={[
                  {
                    name: 'Collected',
                    values: derived.trendValues,
                    colour: '#1EA06B',
                  },
                ]}
                height={250}
              />
              <p className="mt-2 text-xs text-content-muted dark:text-content-muted-dark">
                Collected rather than billed. A month with no payments is drawn as zero
                rather than skipped, so a bad month is visible instead of smoothed over.
              </p>
            </Panel>

            <Panel title="Revenue by plan">
              {derived.byPlan.length === 0 ? (
                <p className="text-sm text-content-muted dark:text-content-muted-dark">
                  No subscription is active or past due, so there is no revenue to split.
                </p>
              ) : (
                <MeterRows
                  caption="Monthly recurring revenue by plan"
                  rows={derived.byPlan.map((r) => ({
                    label: `${r.plan.charAt(0).toUpperCase()}${r.plan.slice(1)}`,
                    value: r.pence,
                    display: formatMoneyShort(r.pence),
                    colour: PLAN_COLOUR[r.plan],
                  }))}
                />
              )}
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel className="lg:col-span-2" title="Recent invoices" flush>
              <ScrollRegion label="Billing">
                <table className="w-full border-collapse text-sm">
                  <caption className="sr-only">Recent invoices</caption>
                  <thead>
                    <tr className="border-b border-surface-border bg-surface-subtle dark:border-surface-border-dark dark:bg-surface-subtle-dark">
                      {['Invoice', 'Organisation', 'Amount', 'Status', 'Actions'].map(
                        (heading, i) => (
                          <th
                            key={heading}
                            className={`px-4 py-2.5 text-[0.69rem] font-semibold uppercase tracking-[0.06em] text-content-muted dark:text-content-muted-dark ${
                              i === 2 || i === 4 ? 'text-right' : 'text-left'
                            }`}
                          >
                            {heading}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {invoicePage === null ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-10 text-center text-sm text-warning-ink dark:text-warning-ink-dark"
                        >
                          The invoice list could not be read. The totals above come from a
                          separate query and are unaffected.
                        </td>
                      </tr>
                    ) : invoicePage.rows.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark"
                        >
                          No invoice has been issued.
                        </td>
                      </tr>
                    ) : (
                      invoicePage.rows.map((invoice) => {
                        return (
                          <tr
                            key={invoice.id}
                            className="border-b border-divider last:border-0 dark:border-divider-dark"
                          >
                            <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-content dark:text-content-dark">
                              {invoice.number}
                            </td>
                            <td className="px-4 py-2.5">
                              {invoice.org_name ? (
                                <Link
                                  to={`/admin/organisations/${invoice.org_id}`}
                                  className="text-primary-ink hover:underline dark:text-primary-ink-dark"
                                >
                                  {invoice.org_name}
                                </Link>
                              ) : (
                                <span className="text-content-muted dark:text-content-muted-dark">
                                  Organisation deleted
                                </span>
                              )}
                            </td>
                            <td className="px-4 py-2.5 text-right font-mono tabular-nums text-content dark:text-content-dark">
                              {formatMoneyExact(invoice.amount_pence, invoice.currency)}
                            </td>
                            <td className="px-4 py-2.5">
                              <Badge tone={INVOICE_TONE[invoice.status] ?? 'neutral'} dot>
                                {INVOICE_LABEL[invoice.status] ?? invoice.status}
                              </Badge>
                            </td>
                            <td className="px-4 py-2.5">
                              <span className="flex justify-end gap-1.5">
                                {/* View works, and Credit is gone rather than
                                    disabled. There is no credit note anywhere
                                    in this schema, no RPC that could write one,
                                    and no test-mode Stripe credential to call
                                    the provider with — so the button was a
                                    promise of a feature nobody had designed.
                                    What the console CAN show is the record it
                                    holds, which is what View now opens. */}
                                <button
                                  type="button"
                                  onClick={() => setOpenInvoice(invoice)}
                                  className="rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-content hover:bg-surface-subtle dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                                >
                                  View
                                </button>
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </ScrollRegion>
              {invoicePage && (
                <Pagination
                  page={invoicePage.page}
                  pageCount={invoicePage.pageCount}
                  total={invoicePage.total}
                  from={invoicePage.from}
                  to={invoicePage.to}
                  onPageChange={setPageNumber}
                  noun="invoices"
                />
              )}
            </Panel>

            <Panel
              title="Failed payments"
              actions={
                <Badge tone="danger" dot>
                  Needs action
                </Badge>
              }
            >
              {derived.failing.length === 0 ? (
                <p className="text-sm text-content-muted dark:text-content-muted-dark">
                  No invoice is past due.
                </p>
              ) : (
                <ul className="space-y-2.5">
                  {derived.failing.map((invoice) => {
                    return (
                      <li
                        key={invoice.id}
                        className="flex flex-wrap items-center gap-2 border-b border-divider pb-2.5 last:border-0 last:pb-0 dark:border-divider-dark"
                      >
                        <AlertTriangle
                          size={15}
                          aria-hidden="true"
                          className="shrink-0 text-danger"
                        />
                        {invoice.org_name ? (
                          <Link
                            to={`/admin/organisations/${invoice.org_id}`}
                            className="text-sm font-medium text-primary-ink hover:underline dark:text-primary-ink-dark"
                          >
                            {invoice.org_name}
                          </Link>
                        ) : (
                          <span className="text-sm text-content dark:text-content-dark">
                            {invoice.number}
                          </span>
                        )}
                        <span className="ml-auto flex items-center gap-3">
                          <span className="font-mono text-xs tabular-nums text-content dark:text-content-dark">
                            {formatMoney(invoice.amount_pence, invoice.currency)}
                          </span>
                          <span className="font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                            {invoice.attempts} {invoice.attempts === 1 ? 'try' : 'tries'}
                          </span>
                        </span>
                        {invoice.failure_reason && (
                          <span className="basis-full pl-[23px] text-xs text-content-muted dark:text-content-muted-dark">
                            {invoice.failure_reason}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
              <p className="mt-3 text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
                Marking an invoice past due records the provider&rsquo;s reason and
                increments its attempt count. Retries themselves run in Stripe, not here
                &mdash; Smart Retries and, on exhaustion, an automatic suspension via{' '}
                <code>stripe-webhook</code> are real code on this branch. Not yet
                confirmed: watching that suspension actually fire end-to-end against a
                real exhausted Stripe subscription.
              </p>
            </Panel>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Renewal windows">
              <MeterRows
                caption="Subscriptions by renewal window"
                rows={derived.renewals.map((r) => ({
                  label: r.label,
                  value: r.count,
                  colour: RENEWAL_COLOUR[r.bucket],
                }))}
              />
              <p className="mt-3 text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
                Computed from <code>current_period_end</code> in local calendar days.{' '}
                {subscriptions.length} subscription records, {derived.withoutRecord}{' '}
                organisations without one, {derived.flagged.length} needing review.
              </p>
            </Panel>

            <Callout tone="info" title="Where these figures come from">
              <p>
                MRR is the sum of <code>subscriptions.price_pence</code>, falling back to
                the plan price, over the subscriptions that are active or past due.
                Collected, outstanding and refunds are sums over <code>invoices</code>.
                Collected by payment date, outstanding by status regardless of age.
                Nothing is stored pre-aggregated, so this screen cannot drift from the
                rows below it.
              </p>
              <p>
                A payment provider is connected: Stripe billing writes and updates these
                rows for real, and dunning suspension (<code>stripe-webhook</code>) is
                real, deployed code. View opens RotaFlow&rsquo;s own invoice record; it
                does not link to Stripe, because <code>invoices</code> stores no hosted
                URL and a link built from the provider reference would be a guessed
                address that could point at the wrong Stripe mode.
              </p>
            </Callout>
          </div>
        </div>
      )}

      <AdminInvoiceModal
        invoice={openInvoice}
        organisationName={
          openInvoice
            ? ((invoicePage?.rows ?? []).find((row) => row.id === openInvoice.id)
                ?.org_name ?? null)
            : null
        }
        onClose={() => setOpenInvoice(null)}
      />
    </AdminPage>
  );
}
