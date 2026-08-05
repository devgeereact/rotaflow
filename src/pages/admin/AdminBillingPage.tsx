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
import {
  DEMO_ARPO,
  DEMO_ARR_FULL,
  DEMO_COLLECTED,
  DEMO_COLLECTED_HINT,
  DEMO_DUNNING_NOTE,
  DEMO_FAILED_PAYMENTS,
  DEMO_INVOICES,
  DEMO_MRR,
  DEMO_MRR_CHANGE,
  DEMO_OUTSTANDING,
  DEMO_OUTSTANDING_HINT,
  DEMO_REFUNDS,
  DEMO_REFUNDS_HINT,
  DEMO_REVENUE_BY_PLAN,
  DEMO_REVENUE_TREND,
  type DemoPaymentState,
} from '@/lib/adminOverviewDemo';
import { reportError } from '@/lib/sentry';
import type { Organisation, Subscription } from '@/types';

const INVOICE_TONE: Record<
  DemoPaymentState | 'past_due',
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  paid: 'success',
  pending: 'warning',
  past_due: 'warning',
  failed: 'danger',
  refunded: 'neutral',
};

const INVOICE_LABEL: Record<DemoPaymentState | 'past_due', string> = {
  paid: 'Paid',
  pending: 'Pending',
  past_due: 'Past due',
  failed: 'Failed',
  refunded: 'Refunded',
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
 * `/admin/billing` — built to the shape of `docs/PLATFORM_CONSOLE.html`.
 *
 * ## Everything with a currency symbol on it is invented
 *
 * `subscriptions` is described in docs/SCHEMA.md as "the billing seam": it
 * records which plan a tenant is on and when the period ends, and its
 * `provider` is pluggable because charging is built last. There is no amount
 * anywhere in the schema, and no invoice, payment, credit, refund or dunning
 * table at all — so MRR, ARR, collections, outstanding balances, refunds, ARPO,
 * the revenue chart, the invoice list and the failed-payment queue are all
 * placeholder values from `src/lib/adminOverviewDemo.ts`.
 *
 * Their buttons are disabled rather than wired, because there is nothing behind
 * them to open, credit or retry. A control that looks live and does nothing is
 * the failure this console has spent eleven phases avoiding.
 *
 * ## What is real
 *
 * The subscription records themselves — how many exist, how many are active,
 * how many organisations have none — and the renewal windows computed from
 * `current_period_end`. Kept on the screen and labelled as real, because they
 * are the only part someone can act on today.
 */
export function AdminBillingPage(): JSX.Element {
  const [subscriptions, setSubscriptions] = useState<Subscription[] | null>(null);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setSubscriptions(null);
    void (async () => {
      try {
        const [subs, orgs] = await Promise.all([
          listAllSubscriptions(),
          listAllOrganisations(),
        ]);
        if (!active) return;
        setSubscriptions(subs);
        setOrganisations(orgs);
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

  const orgByName = useMemo(
    () => new Map(organisations.map((o) => [o.name, o])),
    [organisations],
  );

  const derived = useMemo(() => {
    if (!subscriptions) return null;
    const now = new Date();
    return {
      renewals: renewalBreakdown(subscriptions, now),
      flagged: needsAttention(subscriptions, now),
      active: subscriptions.filter((s) => s.status === 'active').length,
      withoutRecord: organisations.length - subscriptions.length,
      months: monthlyGrowth(organisations, now).map((g) => g.label),
    };
  }, [subscriptions, organisations]);

  return (
    <AdminPage
      title="Billing and finance"
      description="Platform-wide revenue, invoices and payment recovery."
      action={<Button variant="secondary">Export report</Button>}
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
              value={DEMO_MRR}
              hint={
                <>
                  <span className="font-semibold text-success">{DEMO_MRR_CHANGE}</span>{' '}
                  MoM
                </>
              }
              chart={<Sparkline values={DEMO_REVENUE_TREND} colour="#1EA06B" />}
            />
            <StatTile label="ARR" value={DEMO_ARR_FULL} />
            <StatTile
              label="Collected this month"
              value={DEMO_COLLECTED}
              hint={DEMO_COLLECTED_HINT}
            />
            <StatTile
              label="Outstanding"
              value={DEMO_OUTSTANDING}
              hint={
                <span className="font-semibold text-danger">{DEMO_OUTSTANDING_HINT}</span>
              }
            />
            <StatTile label="Refunds" value={DEMO_REFUNDS} hint={DEMO_REFUNDS_HINT} />
            <StatTile label="ARPO" value={DEMO_ARPO} hint="per organisation" />
          </TileGrid>

          <div className="grid gap-4 lg:grid-cols-3">
            <Panel
              className="lg:col-span-2"
              title="Revenue growth"
              actions={<Badge tone="neutral">12 months</Badge>}
            >
              <TrendChart
                title="Monthly recurring revenue by month — placeholder figures"
                labels={derived.months}
                series={[
                  {
                    name: 'Monthly recurring revenue',
                    values: DEMO_REVENUE_TREND,
                    colour: '#1EA06B',
                  },
                ]}
                height={250}
              />
            </Panel>

            <Panel title="Revenue by plan">
              <MeterRows
                caption="Revenue by plan"
                rows={DEMO_REVENUE_BY_PLAN.map((r) => ({ ...r }))}
              />
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
                    {DEMO_INVOICES.map((invoice) => {
                      const org = orgByName.get(invoice.organisation);
                      return (
                        <tr
                          key={invoice.id}
                          className="border-b border-divider last:border-0 dark:border-divider-dark"
                        >
                          <td className="px-4 py-2.5 font-mono text-xs tabular-nums text-content dark:text-content-dark">
                            {invoice.id}
                          </td>
                          <td className="px-4 py-2.5">
                            {org ? (
                              <Link
                                to={`/admin/organisations/${org.id}`}
                                className="text-primary hover:underline"
                              >
                                {invoice.organisation}
                              </Link>
                            ) : (
                              <span className="text-content dark:text-content-dark">
                                {invoice.organisation}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-right font-mono tabular-nums text-content dark:text-content-dark">
                            {invoice.amount}
                          </td>
                          <td className="px-4 py-2.5">
                            <Badge tone={INVOICE_TONE[invoice.status]} dot>
                              {INVOICE_LABEL[invoice.status]}
                            </Badge>
                          </td>
                          <td className="px-4 py-2.5">
                            <span className="flex justify-end gap-1.5">
                              {['View', 'Credit'].map((label) => (
                                <span
                                  key={label}
                                  title="There is no invoice record to open or credit"
                                  className="cursor-not-allowed rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-content-muted opacity-60 dark:border-surface-border-dark dark:text-content-muted-dark"
                                >
                                  {label}
                                </span>
                              ))}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
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
              <ul className="space-y-2.5">
                {DEMO_FAILED_PAYMENTS.map((payment) => {
                  const org = orgByName.get(payment.organisation);
                  return (
                    <li
                      key={payment.organisation}
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
                          {payment.organisation}
                        </Link>
                      ) : (
                        <span className="text-sm text-content dark:text-content-dark">
                          {payment.organisation}
                        </span>
                      )}
                      <span className="ml-auto flex items-center gap-3">
                        <span className="font-mono text-xs tabular-nums text-content dark:text-content-dark">
                          {payment.amount}
                        </span>
                        <span className="font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                          {payment.attempts} tries
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <p className="mt-3 text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
                {DEMO_DUNNING_NOTE}
              </p>
            </Panel>
          </div>

          {/* The measured part, kept on the screen rather than moved away — a
              billing page with nothing real on it is a page nobody can act
              from. */}
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Renewal windows — real">
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

            <Callout tone="warning" title="Every figure with a £ on it is placeholder">
              <p>
                <code>subscriptions</code> carries a plan, a status and a period end — no
                amount, no currency, no interval — and there is no invoice, payment,
                credit, refund or dunning table. No provider is connected, so nothing has
                ever been charged or collected.
              </p>
              <p>
                MRR, ARR, collections, outstanding, refunds, ARPO, the revenue chart, the
                invoice list and the failed-payment queue come from{' '}
                <code>src/lib/adminOverviewDemo.ts</code>. Their buttons are disabled
                rather than wired, because there is nothing behind them to open, credit or
                retry.
              </p>
            </Callout>
          </div>
        </div>
      )}
    </AdminPage>
  );
}
