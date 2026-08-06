import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  DataTable,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/ui/DataTable';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import { listAllOrganisations, listAllSubscriptions } from '@/services/platformService';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { daysUntil, needsAttention } from '@/lib/platformBilling';
import { humaniseKey } from '@/lib/platformOverview';
import { downloadCsv } from '@/lib/csv';
import { demoSubscriptionFacts, type DemoPaymentState } from '@/lib/adminOverviewDemo';
import { listInvoices, listPlans, type Invoice } from '@/services/billingService';
import { formatMoney, formatMoneyShort } from '@/lib/money';
import {
  annualRunRatePence,
  collectedByMonth,
  monthlyRecurringPence,
} from '@/lib/revenue';
import { Sparkline } from '@/components/ui/TrendChart';
import { reportError } from '@/lib/sentry';
import type { Organisation, Subscription } from '@/types';

const PAYMENT_TONE: Record<
  DemoPaymentState,
  'success' | 'warning' | 'danger' | 'neutral'
> = {
  paid: 'success',
  pending: 'warning',
  failed: 'danger',
  refunded: 'neutral',
};

const STATUS_TONE = {
  active: 'success',
  trialing: 'info',
  past_due: 'warning',
  canceled: 'neutral',
} as const;

function toneFor(status: string): (typeof STATUS_TONE)[keyof typeof STATUS_TONE] {
  return STATUS_TONE[status as keyof typeof STATUS_TONE] ?? 'neutral';
}

type SubSortKey = 'organisation' | 'plan' | 'status' | 'value' | 'period' | 'usage';

interface Row {
  organisation: Organisation;
  subscription: Subscription | null;
}

/**
 * `/admin/subscriptions`. Plan state across every tenant.
 *
 * ## What this can and cannot say
 *
 * `subscriptions` records plan, status, provider and period end. It records no
 * amount, and **no payment provider is integrated**, so there is nothing here
 * that could be turned into revenue: no invoices, no payments, no MRR, no
 * churn rate. `docs/PRD.md` §7 already puts live charging out of scope for V1.
 *
 * What this screen therefore reports is *contracted plan state*, which
 * organisations are on which plan, which are trialing, which are past due. That
 * is real and it is useful, and the alternative (a revenue figure derived from
 * a price list nobody is billing against) would be a number nothing computed
 * presented as a number someone owes.
 *
 * The table is keyed on organisations rather than subscriptions on purpose: the
 * interesting row is a tenant with **no** subscription record, and a list of
 * subscriptions cannot show one. `/admin/billing` takes the other cut. The
 * renewal lifecycle across the records that do exist.
 */
export function AdminSubscriptionsPage(): JSX.Element {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [planPrices, setPlanPrices] = useState<Map<string, number>>(new Map());
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [plan, setPlan] = useState('');
  const [status, setStatus] = useState('');
  const [sort, setSort] = useState<DataTableSort<SubSortKey> | null>(null);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setRows(null);
    void (async () => {
      try {
        const [orgs, subs, planRows, invoiceRows] = await Promise.all([
          listAllOrganisations(),
          listAllSubscriptions(),
          listPlans(),
          listInvoices(),
        ]);
        if (!active) return;
        setSubscriptions(subs);
        setPlanPrices(new Map(planRows.map((p) => [p.code, p.monthly_price_pence])));
        setInvoices(invoiceRows);
        const byOrg = new Map(subs.map((s) => [s.org_id, s]));
        setRows(
          orgs.map((organisation) => ({
            organisation,
            subscription: byOrg.get(organisation.id) ?? null,
          })),
        );
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:subscriptions' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  /**
   * The money, from the same functions Billing uses.
   *
   * Recomputed on every render pass rather than cached: two screens quoting one
   * figure is only safe while they share the arithmetic, and a cache is where
   * they start to drift.
   */
  const money = useMemo(() => {
    const mrr = monthlyRecurringPence(subscriptions, planPrices);
    return {
      mrr,
      arr: annualRunRatePence(mrr),
      trend: collectedByMonth(invoices, 12, new Date()).map((t) =>
        Math.round(t.pence / 100),
      ),
      active: subscriptions.filter((s) => s.status === 'active').length,
      trialing: subscriptions.filter((s) => s.status === 'trialing').length,
      pastDue: subscriptions.filter((s) => s.status === 'past_due').length,
      cancelled: subscriptions.filter((s) => s.status === 'canceled').length,
    };
  }, [subscriptions, planPrices, invoices]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  // Placeholder value / cycle / payment / usage, no amount exists anywhere in
  // the schema. See `adminOverviewDemo`.
  const facts = useCallback(
    (row: Row) =>
      demoSubscriptionFacts(
        row.organisation.id,
        (rows ?? []).findIndex((r) => r.organisation.id === row.organisation.id),
        row.subscription?.status ?? 'none',
      ),
    [rows],
  );

  const planOf = useCallback(
    (row: Row): string => row.subscription?.plan ?? row.organisation.plan,
    [],
  );

  const stats = useMemo(() => {
    if (!rows) return null;
    // `flatMap` rather than `filter(...).map(...!)`: the filter does not narrow
    // `subscription` for TypeScript, and the assertion that silences it is the
    // one thing standing between a schema change and a runtime null.
    const present = rows.flatMap((r) => (r.subscription ? [r.subscription] : []));
    const withSub = rows.filter((r) => r.subscription);
    const flagged = needsAttention(present, new Date());
    return {
      tenants: rows.length,
      withRecord: withSub.length,
      active: withSub.filter((r) => r.subscription?.status === 'active').length,
      trialing: withSub.filter((r) => r.subscription?.status === 'trialing').length,
      pastDue: withSub.filter((r) => r.subscription?.status === 'past_due').length,
      flagged: flagged.length,
      plans: [...new Set(rows.map(planOf))].sort(),
      statuses: [...new Set(withSub.map((r) => r.subscription?.status ?? ''))]
        .filter(Boolean)
        .sort(),
    };
  }, [rows, planOf]);

  const visible = useMemo(() => {
    if (!rows) return [];
    const q = search.trim().toLowerCase();
    const filtered = rows.filter((row) => {
      if (plan && planOf(row) !== plan) return false;
      if (status) {
        if (status === 'none' ? row.subscription : row.subscription?.status !== status) {
          return false;
        }
      }
      if (!q) return true;
      return (
        row.organisation.name.toLowerCase().includes(q) ||
        row.organisation.slug.toLowerCase().includes(q)
      );
    });

    if (!sort) return filtered;
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case 'plan':
          return planOf(a).localeCompare(planOf(b)) * direction;
        case 'status':
          return (
            (a.subscription?.status ?? '').localeCompare(b.subscription?.status ?? '') *
            direction
          );
        case 'value':
          return ((facts(a).value ?? 0) - (facts(b).value ?? 0)) * direction;
        case 'usage':
          return (facts(a).usage - facts(b).usage) * direction;
        case 'period': {
          const av = a.subscription?.current_period_end ?? '';
          const bv = b.subscription?.current_period_end ?? '';
          return av.localeCompare(bv) * direction;
        }
        default:
          return a.organisation.name.localeCompare(b.organisation.name) * direction;
      }
    });
  }, [rows, search, plan, status, sort, facts, planOf]);

  const columns = useMemo<DataTableColumn<Row, SubSortKey>[]>(
    () => [
      {
        key: 'organisation',
        label: 'Organisation',
        width: 'w-[18%]',
        sortable: true,
        cell: ({ organisation }) => (
          <Link to={`/admin/organisations/${organisation.id}`} className="block min-w-0">
            <span className="block truncate font-medium text-primary hover:underline">
              {organisation.name}
            </span>
            <span className="block truncate font-mono text-xs text-content-muted dark:text-content-muted-dark">
              {organisation.slug}
            </span>
          </Link>
        ),
      },
      {
        key: 'plan',
        label: 'Plan',
        width: 'w-[10%]',
        sortable: true,
        cell: (row) => <Badge tone="neutral">{humaniseKey(planOf(row))}</Badge>,
      },
      {
        key: 'status',
        label: 'Status',
        width: 'w-[10%]',
        sortable: true,
        cell: ({ subscription }) =>
          subscription ? (
            <Badge tone={toneFor(subscription.status)} dot>
              {humaniseKey(subscription.status)}
            </Badge>
          ) : (
            <span className="text-content-muted dark:text-content-muted-dark">
              No record
            </span>
          ),
      },
      {
        key: 'plan',
        label: 'Cycle',
        width: 'w-[8%]',
        cell: (row) => facts(row).cycle,
      },
      {
        key: 'value',
        label: 'Value',
        width: 'w-[9%]',
        numeric: true,
        sortable: true,
        cell: (row) => {
          const { value } = facts(row);
          return value === null ? '-' : `£${value.toLocaleString('en-GB')}`;
        },
      },
      {
        key: 'period',
        label: 'Renews',
        width: 'w-[11%]',
        sortable: true,
        cell: ({ subscription }) => {
          const end = subscription?.current_period_end;
          if (!end) return <span className="text-content-muted">-</span>;
          const days = daysUntil(end, new Date());
          return (
            <span
              className={
                days !== null && days < 0
                  ? 'whitespace-nowrap text-warning'
                  : 'whitespace-nowrap text-content-muted dark:text-content-muted-dark'
              }
            >
              {new Date(end).toLocaleDateString('en-GB', {
                day: '2-digit',
                month: 'short',
                year: 'numeric',
              })}
            </span>
          );
        },
      },
      {
        key: 'status',
        label: 'Payment',
        width: 'w-[10%]',
        cell: (row) => {
          const { payment } = facts(row);
          return (
            <Badge tone={PAYMENT_TONE[payment]} dot>
              {humaniseKey(payment)}
            </Badge>
          );
        },
      },
      {
        key: 'usage',
        label: 'Usage',
        width: 'w-[7%]',
        numeric: true,
        sortable: true,
        cell: (row) => `${facts(row).usage}%`,
      },
      {
        key: 'organisation',
        label: 'Actions',
        width: 'w-[17%]',
        align: 'right',
        cell: ({ organisation }) => (
          <span className="flex justify-end gap-1.5">
            {/* Both lead to the organisation, where a plan change is a
                confirmed write with the consequences beside it. Nothing on this
                deployment can price a plan or apply a discount, so acting from
                the row would be a button that cannot finish. */}
            <Link
              to={`/admin/organisations/${organisation.id}`}
              className="whitespace-nowrap rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-content hover:bg-surface-subtle dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
            >
              Change plan
            </Link>
            <span
              title="No pricing exists to discount. See the note below the table"
              className="cursor-not-allowed whitespace-nowrap rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-content-muted opacity-60 dark:border-surface-border-dark dark:text-content-muted-dark"
            >
              Discount
            </span>
          </span>
        ),
      },
    ],
    [planOf, facts],
  );

  const exportCsv = useCallback(() => {
    downloadCsv(`subscriptions_${new Date().toISOString().slice(0, 10)}`, visible, [
      { label: 'Organisation', value: (r) => r.organisation.name },
      { label: 'Slug', value: (r) => r.organisation.slug },
      { label: 'Plan', value: (r) => planOf(r) },
      { label: 'Subscription status', value: (r) => r.subscription?.status ?? 'none' },
      { label: 'Account status', value: (r) => r.organisation.status },
      { label: 'Provider', value: (r) => r.subscription?.provider ?? '' },
      { label: 'Period ends', value: (r) => r.subscription?.current_period_end ?? '' },
    ]);
  }, [visible, planOf]);

  return (
    <AdminPage
      title="Subscriptions"
      description="Every customer subscription record, its plan, value and payment state."
      action={
        <Button variant="secondary" onClick={exportCsv} disabled={visible.length === 0}>
          <Download size={15} aria-hidden="true" />
          Export
        </Button>
      }
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !rows || !stats ? (
        <AdminLoading variant="tiles" rows={4} />
      ) : (
        <div className="space-y-4">
          <TileGrid>
            <StatTile
              label="MRR"
              value={formatMoney(money.mrr)}
              hint="Active and past due"
              to="/admin/billing"
              chart={<Sparkline values={money.trend} colour="#1EA06B" />}
            />
            <StatTile
              label="ARR"
              value={formatMoneyShort(money.arr)}
              hint="Run rate"
              to="/admin/billing"
            />
            <StatTile label="Active subscriptions" value={money.active} />
            <StatTile
              label="Trials"
              value={money.trialing}
              hint={money.trialing === 0 ? 'None running' : 'Not yet converted'}
            />
            <StatTile
              label="Past due"
              value={money.pastDue}
              hint={
                money.pastDue > 0 ? (
                  <span className="font-semibold text-danger">Payment failed</span>
                ) : (
                  'All payments current'
                )
              }
            />
            <StatTile
              label="Cancelled"
              value={money.cancelled}
              hint="Recorded as canceled"
            />
          </TileGrid>

          <Callout tone="info" title="What is measured here, and what is not">
            <p>
              MRR is the sum of each subscription&rsquo;s negotiated price, falling back
              to its plan price from <code>plans</code>, over the rows that are active or
              past due. The same arithmetic{' '}
              <Link to="/admin/billing" className="text-primary hover:underline">
                Billing
              </Link>{' '}
              uses, so the two screens cannot disagree.
            </p>
            <p>
              Churn is not shown: nothing records the month an organisation left, so a
              rate would be a guess. The Usage column is still a placeholder, no plan
              carries a seat or location cap anywhere in the schema, so there is no
              ceiling to measure against.
            </p>
          </Callout>

          <Card className="p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-divider p-3 dark:border-divider-dark">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search organisation…"
                aria-label="Search subscriptions"
                className="max-w-xs"
              />
              <Select
                value={plan}
                onChange={(e) => setPlan(e.target.value)}
                aria-label="Filter by plan"
                className="w-auto"
              >
                <option value="">All plans</option>
                {stats.plans.map((p) => (
                  <option key={p} value={p}>
                    {humaniseKey(p)}
                  </option>
                ))}
              </Select>
              <Select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                aria-label="Filter by subscription status"
                className="w-auto"
              >
                <option value="">Any subscription state</option>
                {stats.statuses.map((s) => (
                  <option key={s} value={s}>
                    {humaniseKey(s)}
                  </option>
                ))}
                <option value="none">No record</option>
              </Select>
              <span className="ml-auto font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                {visible.length} of {stats.tenants}
              </span>
            </div>

            <DataTable
              caption="Subscription state by organisation"
              columns={columns}
              rows={visible}
              rowKey={({ organisation }) => organisation.id}
              sort={sort}
              onSortChange={setSort}
              emptyMessage="No organisation matches these filters."
            />
          </Card>
        </div>
      )}
    </AdminPage>
  );
}
