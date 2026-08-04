import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { StatTile } from '@/components/ui/StatTile';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import { listAllOrganisations, listAllSubscriptions } from '@/services/platformService';
import { reportError } from '@/lib/sentry';
import type { Organisation, Subscription } from '@/types';

const STATUS_TONE = {
  active: 'success',
  trialing: 'info',
  past_due: 'warning',
  canceled: 'neutral',
} as const;

function toneFor(status: string): (typeof STATUS_TONE)[keyof typeof STATUS_TONE] {
  return STATUS_TONE[status as keyof typeof STATUS_TONE] ?? 'neutral';
}

interface Row {
  organisation: Organisation;
  subscription: Subscription | null;
}

/**
 * `/admin/subscriptions` — plan state across every tenant.
 *
 * ## What this can and cannot say
 *
 * `subscriptions` records plan, status, provider and period end. It records no
 * amount, and **no payment provider is integrated**, so there is nothing here
 * that could be turned into revenue: no invoices, no payments, no MRR, no
 * churn rate. `docs/PRD.md` §7 already puts live charging out of scope for V1.
 *
 * What this screen therefore reports is *contracted plan state* — which
 * organisations are on which plan, which are trialing, which are past due. That
 * is real and it is useful, and the alternative (a revenue figure derived from
 * a price list nobody is billing against) would be a number nothing computed
 * presented as a number someone owes.
 *
 * The table is keyed on organisations rather than subscriptions on purpose: the
 * interesting row is a tenant with **no** subscription record, and a list of
 * subscriptions cannot show one.
 */
export function AdminSubscriptionsPage(): JSX.Element {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setRows(null);
    void (async () => {
      try {
        const [orgs, subs] = await Promise.all([
          listAllOrganisations(),
          listAllSubscriptions(),
        ]);
        if (!active) return;
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

  const stats = useMemo(() => {
    const all = rows ?? [];
    const withSub = all.filter((r) => r.subscription);
    return {
      tenants: all.length,
      withRecord: withSub.length,
      active: withSub.filter((r) => r.subscription?.status === 'active').length,
      trialing: withSub.filter((r) => r.subscription?.status === 'trialing').length,
      pastDue: withSub.filter((r) => r.subscription?.status === 'past_due').length,
    };
  }, [rows]);

  const columns = useMemo<DataTableColumn<Row>[]>(
    () => [
      {
        key: 'organisation',
        label: 'Organisation',
        width: 'w-[34%]',
        cell: ({ organisation }) => (
          <Link
            to={`/admin/organisations/${organisation.id}`}
            className="block min-w-0 hover:underline"
          >
            <p className="truncate font-medium text-content dark:text-content-dark">
              {organisation.name}
            </p>
            <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
              {organisation.slug}
            </p>
          </Link>
        ),
      },
      {
        key: 'plan',
        label: 'Plan',
        width: 'w-[18%]',
        cell: ({ organisation, subscription }) => (
          <span className="capitalize">{subscription?.plan ?? organisation.plan}</span>
        ),
      },
      {
        key: 'status',
        label: 'Subscription',
        width: 'w-[20%]',
        cell: ({ subscription }) =>
          subscription ? (
            <Badge tone={toneFor(subscription.status)}>{subscription.status}</Badge>
          ) : (
            <span className="text-content-muted dark:text-content-muted-dark">
              No record
            </span>
          ),
      },
      {
        key: 'account',
        label: 'Account',
        width: 'w-[14%]',
        cell: ({ organisation }) => (
          <Badge tone={organisation.status === 'active' ? 'success' : 'warning'}>
            {organisation.status}
          </Badge>
        ),
      },
      {
        key: 'renews',
        label: 'Period ends',
        width: 'w-[14%]',
        cell: ({ subscription }) => (
          <span className="whitespace-nowrap text-content-muted dark:text-content-muted-dark">
            {subscription?.current_period_end
              ? new Date(subscription.current_period_end).toLocaleDateString('en-GB')
              : '—'}
          </span>
        ),
      },
    ],
    [],
  );

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <AdminPage
      title="Subscriptions"
      description="Contracted plan state for every organisation on this deployment."
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !rows ? (
        <AdminLoading variant="tiles" rows={4} />
      ) : (
        <div className="space-y-5">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <StatTile
              label="Organisations"
              value={stats.tenants}
              hint={`${stats.withRecord} with a subscription record`}
            />
            <StatTile label="Active" value={stats.active} />
            <StatTile label="Trialing" value={stats.trialing} />
            <StatTile
              label="Past due"
              value={stats.pastDue}
              hint={stats.pastDue === 0 ? 'None' : 'Needs attention'}
            />
          </div>

          <Card className="border-warning/30 bg-warning/5">
            <h2 className="mb-1 font-semibold text-content dark:text-content-dark">
              Revenue reporting is not built
            </h2>
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              No payment provider is integrated, so there is no invoice, payment or amount
              anywhere in the schema — <code>subscriptions</code> carries plan state only,
              and no plan carries a price. Monthly recurring revenue, churn and
              outstanding balances are therefore not shown rather than estimated.
            </p>
            <p className="mt-2 text-sm text-content-muted dark:text-content-muted-dark">
              Most organisations below will show “no record”: nothing writes to{' '}
              <code>subscriptions</code> today either, so the plan shown falls back to{' '}
              <code>organisations.plan</code>, which is chosen at sign-up and is not a
              billing record.
            </p>
          </Card>

          <Card className="overflow-hidden p-0">
            <DataTable
              caption="Subscription state by organisation"
              columns={columns}
              rows={rows}
              rowKey={({ organisation }) => organisation.id}
              emptyMessage="No organisations on this deployment yet."
            />
          </Card>
        </div>
      )}
    </AdminPage>
  );
}
