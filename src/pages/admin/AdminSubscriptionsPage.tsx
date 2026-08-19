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
import {
  countMembershipsByOrg,
  listAllOrganisations,
  listAllSubscriptions,
} from '@/services/platformService';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { daysUntil, needsAttention } from '@/lib/platformBilling';
import { humaniseKey } from '@/lib/platformOverview';
import { downloadCsv } from '@/lib/csv';
import { listInvoices, listPlans, type Invoice, type Plan } from '@/services/billingService';
import { formatMoney } from '@/lib/money';
import {
  annualRunRatePence,
  collectedByMonth,
  monthlyRecurringPence,
} from '@/lib/revenue';
import { Sparkline } from '@/components/ui/TrendChart';
import { reportError } from '@/lib/sentry';
import type { Organisation, Subscription } from '@/types';

type PaymentState = 'paid' | 'pending' | 'failed';

const PAYMENT_TONE: Record<PaymentState, 'success' | 'warning' | 'danger' | 'neutral'> = {
  paid: 'success',
  pending: 'warning',
  failed: 'danger',
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

type SubSortKey =
  | 'organisation'
  | 'plan'
  | 'status'
  | 'value'
  | 'period'
  | 'usage'
  | 'cycle'
  | 'payment'
  | 'actions';

interface Row {
  organisation: Organisation;
  subscription: Subscription | null;
}

/**
 * `/admin/subscriptions`. Plan state and billing facts across every tenant.
 *
 * ## What this can and cannot say
 *
 * A payment provider is integrated (`0023`, this session's Stripe work), so
 * MRR, ARR and subscription state (active / trialing / past due / cancelled)
 * are real, computed by the same functions Billing uses. Per-row Value comes
 * from the subscription's negotiated price, falling back to its plan's list
 * price; Payment from the subscription's status; Usage from real membership
 * headcount over the plan's seat limit.
 *
 * What this screen does not duplicate: Collected, Outstanding, Refunds, ARPO
 * and invoice-level detail live on `/admin/billing` instead of being repeated
 * here.
 *
 * The table is keyed on organisations rather than subscriptions on purpose: the
 * interesting row is a tenant with **no** subscription record, and a list of
 * subscriptions cannot show one. `/admin/billing` takes the other cut. The
 * renewal lifecycle across the records that do exist.
 */
export function AdminSubscriptionsPage(): JSX.Element {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [planPrices, setPlanPrices] = useState<Map<string, number>>(new Map());
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [memberCounts, setMemberCounts] = useState<Map<string, number>>(new Map());
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
        const [orgs, subs, planRows, invoiceRows, counts] = await Promise.all([
          listAllOrganisations(),
          listAllSubscriptions(),
          listPlans(),
          listInvoices(),
          countMembershipsByOrg(),
        ]);
        if (!active) return;
        setSubscriptions(subs);
        setPlans(planRows);
        setPlanPrices(new Map(planRows.map((p) => [p.code, p.monthly_price_pence])));
        setInvoices(invoiceRows);
        setMemberCounts(counts);
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

  // Value from the subscription's negotiated price, falling back to the plan
  // price; payment state from subscription status; usage from real
  // membership headcount over the plan's seat limit.
  const facts = useCallback(
    (row: Row): { value: number | null; cycle: string; payment: PaymentState; usage: number } => {
      const sub = row.subscription;
      const plan = plans.find((p) => p.code === (sub?.plan ?? row.organisation.plan));
      const seatLimit = plan?.seat_limit ?? null;
      const memberCount = memberCounts.get(row.organisation.id) ?? 0;
      const usage = seatLimit ? Math.round((memberCount / seatLimit) * 100) : 0;

      if (!sub) return { value: null, cycle: 'Monthly', payment: 'pending', usage };

      const value =
        sub.status === 'trialing' ? null : (sub.price_pence ?? plan?.monthly_price_pence ?? null);
      const payment: PaymentState =
        sub.status === 'past_due' ? 'failed' : sub.status === 'trialing' ? 'pending' : 'paid';
      return { value, cycle: 'Monthly', payment, usage };
    },
    [plans, memberCounts],
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
        key: 'cycle',
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
          // `value` is pence, same as everywhere else on this page — the old
          // placeholder values were pounds, so this used to format correctly
          // by accident.
          return value === null ? '-' : formatMoney(value);
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
        key: 'payment',
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
        key: 'actions',
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
              // Same figure as Billing's own ARR tile, and to the same
              // precision — `formatMoneyShort`'s rounding is only sound when
              // the exact number is elsewhere on this screen, and it isn't.
              value={formatMoney(money.arr)}
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
              rate would be a guess. In the table, <strong>Value</strong> is the
              subscription&rsquo;s negotiated price or its plan&rsquo;s list price;{' '}
              <strong>Payment</strong> reflects the subscription&rsquo;s status; and{' '}
              <strong>Usage</strong> is real membership headcount over the plan&rsquo;s
              seat limit. <strong>Cycle</strong> reads &ldquo;Monthly&rdquo; for every
              row because no other billing interval exists anywhere in{' '}
              <code>plans</code>.
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
