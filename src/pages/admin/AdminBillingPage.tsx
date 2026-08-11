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
import { listAllOrganisations, listAllSubscriptions } from '@/services/platformService';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { needsAttention, renewalBreakdown } from '@/lib/platformBilling';
import { monthlyGrowth } from '@/lib/platformOverview';
import { listInvoices, listPlans, type Invoice } from '@/services/billingService';
import { formatMoney, formatMoneyExact, formatMoneyShort } from '@/lib/money';
import { downloadCsv } from '@/lib/csv';
import {
  annualRunRatePence,
  averageRevenuePerOrgPence,
  collectedByMonth,
  collectedInMonth,
  monthKey,
  monthlyRecurringPence,
  outstandingPence,
  pastDuePence,
  refundedInMonth,
  revenueByPlan,
} from '@/lib/revenue';
import { reportError } from '@/lib/sentry';
import type { Organisation, Subscription } from '@/types';

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
 * ## What is still not here
 *
 * A payment provider. `invoices.provider` and `provider_ref` exist and nothing
 * writes them, so Credit and Retry are disabled: the row can be marked
 * refunded in this database, but no money moves. Dunning is a described policy
 * rather than a scheduled job.
 */
export function AdminBillingPage(): JSX.Element {
  const [subscriptions, setSubscriptions] = useState<Subscription[] | null>(null);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [planPrices, setPlanPrices] = useState<Map<string, number>>(new Map());
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setSubscriptions(null);
    void (async () => {
      try {
        const [subs, orgs, invoiceRows, plans] = await Promise.all([
          listAllSubscriptions(),
          listAllOrganisations(),
          listInvoices(),
          listPlans(),
        ]);
        if (!active) return;
        setSubscriptions(subs);
        setOrganisations(orgs);
        setInvoices(invoiceRows);
        setPlanPrices(new Map(plans.map((p) => [p.code, p.monthly_price_pence])));
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

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  // By id, not by name: an invoice references `org_id`, and matching on a name
  // breaks the moment two tenants share one.
  const orgById = useMemo(
    () => new Map(organisations.map((o) => [o.id, o])),
    [organisations],
  );

  const exportReport = useCallback(() => {
    downloadCsv(`billing-invoices_${new Date().toISOString().slice(0, 10)}`, invoices, [
      { label: 'Invoice', value: (i) => i.number },
      { label: 'Organisation', value: (i) => orgById.get(i.org_id)?.name ?? '' },
      { label: 'Amount', value: (i) => formatMoneyExact(i.amount_pence, i.currency) },
      { label: 'Status', value: (i) => INVOICE_LABEL[i.status] ?? i.status },
      { label: 'Issued', value: (i) => i.issued_on },
      { label: 'Due', value: (i) => i.due_on },
      { label: 'Paid', value: (i) => i.paid_at ?? '' },
    ]);
  }, [invoices, orgById]);

  const derived = useMemo(() => {
    if (!subscriptions) return null;
    const now = new Date();
    const thisMonth = monthKey(now.toISOString());
    const mrr = monthlyRecurringPence(subscriptions, planPrices);
    const paying = subscriptions.filter(
      (s) => s.status === 'active' || s.status === 'past_due',
    ).length;
    const trend = collectedByMonth(invoices, 12, now);
    const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const collectedNow = collectedInMonth(invoices, thisMonth);
    const collectedBefore = collectedInMonth(invoices, monthKey(lastMonth.toISOString()));

    return {
      renewals: renewalBreakdown(subscriptions, now),
      flagged: needsAttention(subscriptions, now),
      active: subscriptions.filter((s) => s.status === 'active').length,
      withoutRecord: organisations.length - subscriptions.length,
      months: monthlyGrowth(organisations, now).map((g) => g.label),

      mrr,
      arr: annualRunRatePence(mrr),
      arpo: averageRevenuePerOrgPence(mrr, paying),
      collected: collectedNow,
      // Month over month on collections, not on MRR: MRR is a snapshot with no
      // history behind it, so a change figure on it would be invented.
      collectedChange:
        collectedBefore === 0
          ? null
          : Math.round(((collectedNow - collectedBefore) / collectedBefore) * 1000) / 10,
      outstanding: outstandingPence(invoices),
      pastDue: pastDuePence(invoices),
      pastDueCount: invoices.filter((i) => i.status === 'past_due').length,
      openCount: invoices.filter((i) => i.status === 'open' || i.status === 'past_due')
        .length,
      refunds: refundedInMonth(invoices, thisMonth),
      refundCount: invoices.filter(
        (i) => i.refunded_at !== null && monthKey(i.refunded_at) === thisMonth,
      ).length,
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
      recent: invoices.slice(0, 8),
      failing: invoices.filter((i) => i.status === 'past_due').slice(0, 6),
    };
  }, [subscriptions, organisations, invoices, planPrices]);

  return (
    <AdminPage
      title="Billing and finance"
      description="Platform-wide revenue, invoices and payment recovery."
      action={
        <Button
          variant="secondary"
          onClick={exportReport}
          disabled={invoices.length === 0}
        >
          Export report
        </Button>
      }
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !subscriptions || !derived ? (
        <AdminLoading variant="tiles" rows={4} />
      ) : (
        <div className="space-y-4">
          <TileGrid>
            <StatTile
              label="MRR"
              value={formatMoney(derived.mrr)}
              hint="Active and past due"
              chart={<Sparkline values={derived.trendValues} colour="#1EA06B" />}
            />
            <StatTile
              label="ARR"
              value={formatMoney(derived.arr)}
              hint="Twelve months at today's rate"
            />
            <StatTile
              label="Collected this month"
              value={formatMoney(derived.collected)}
              hint={
                derived.collectedChange === null ? (
                  'By payment date'
                ) : (
                  <>
                    <span
                      className={`font-semibold ${
                        derived.collectedChange >= 0 ? 'text-success' : 'text-danger'
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
              value={formatMoney(derived.outstanding)}
              hint={
                derived.pastDueCount > 0 ? (
                  <span className="font-semibold text-danger">
                    {formatMoney(derived.pastDue)} past due
                  </span>
                ) : (
                  `${derived.openCount} open`
                )
              }
            />
            <StatTile
              label="Refunds"
              value={formatMoney(derived.refunds)}
              hint={`${derived.refundCount} this month`}
            />
            <StatTile
              label="ARPO"
              value={derived.arpo === null ? '-' : formatMoney(derived.arpo)}
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
              <div className="overflow-x-auto">
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
                    {derived.recent.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark"
                        >
                          No invoice has been issued.
                        </td>
                      </tr>
                    ) : (
                      derived.recent.map((invoice) => {
                        const org = orgById.get(invoice.org_id);
                        return (
                          <tr
                            key={invoice.id}
                            className="border-b border-divider last:border-0 dark:border-divider-dark"
                          >
                            <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-content dark:text-content-dark">
                              {invoice.number}
                            </td>
                            <td className="px-4 py-2.5">
                              {org ? (
                                <Link
                                  to={`/admin/organisations/${org.id}`}
                                  className="text-primary hover:underline"
                                >
                                  {org.name}
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
                                {['View', 'Credit'].map((label) => (
                                  <span
                                    key={label}
                                    title="No payment provider is wired up, so nothing can be opened or credited from here"
                                    className="cursor-not-allowed rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-content-muted opacity-60 dark:border-surface-border-dark dark:text-content-muted-dark"
                                  >
                                    {label}
                                  </span>
                                ))}
                              </span>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
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
                    const org = orgById.get(invoice.org_id);
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
                        {org ? (
                          <Link
                            to={`/admin/organisations/${org.id}`}
                            className="text-sm font-medium text-primary hover:underline"
                          >
                            {org.name}
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
                increments its attempt count. Nothing retries a payment on a schedule.
                Dunning is a policy this console can describe and not yet a job it runs.
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
                No payment provider is connected. An invoice can be marked paid, past due
                or refunded in this database and no money moves, so View and Credit stay
                disabled and dunning is a described policy rather than a job that runs.
              </p>
            </Callout>
          </div>
        </div>
      )}
    </AdminPage>
  );
}
