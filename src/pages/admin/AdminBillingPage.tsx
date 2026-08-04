import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
  AdminStat,
} from '@/components/admin/AdminPage';
import { listAllOrganisations, listAllSubscriptions } from '@/services/platformService';
import { reportError } from '@/lib/sentry';
import type { Organisation, Subscription } from '@/types';

/**
 * `/admin/billing` — NEW_STRUCTURE §34's platform billing.
 *
 * ## What this can and cannot show
 *
 * `subscriptions` is described in docs/SCHEMA.md as "the billing seam" — it
 * records which plan a tenant is on and when the period ends, and its
 * `provider` is deliberately pluggable because charging is built last. There
 * is no payment processor wired to this deployment.
 *
 * So this reports subscription *state*, which is real, and does not report
 * revenue, invoices or MRR, which would have to be invented. A number on a
 * billing screen that nothing computed is worse than an absent one.
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

  const orgById = useMemo(
    () => new Map(organisations.map((o) => [o.id, o])),
    [organisations],
  );

  const byPlan = useMemo(() => {
    const counts = new Map<string, number>();
    for (const sub of subscriptions ?? []) {
      counts.set(sub.plan, (counts.get(sub.plan) ?? 0) + 1);
    }
    return counts;
  }, [subscriptions]);

  const columns = useMemo<DataTableColumn<Subscription>[]>(
    () => [
      {
        key: 'organisation',
        label: 'Organisation',
        width: 'w-[28%]',
        cell: (sub) => (
          <span className="truncate font-medium text-content dark:text-content-dark">
            {orgById.get(sub.org_id)?.name ?? 'Unknown organisation'}
          </span>
        ),
      },
      {
        key: 'plan',
        label: 'Plan',
        width: 'w-[18%]',
        cell: (sub) => <span className="capitalize">{sub.plan}</span>,
      },
      {
        key: 'status',
        label: 'Status',
        width: 'w-[18%]',
        cell: (sub) => (
          <Badge tone={sub.status === 'active' ? 'success' : 'warning'}>
            {sub.status}
          </Badge>
        ),
      },
      {
        key: 'provider',
        label: 'Provider',
        width: 'w-[18%]',
        cell: (sub) => (
          <span className="text-content-muted dark:text-content-muted-dark">
            {sub.provider ?? 'Not set'}
          </span>
        ),
      },
      {
        key: 'periodEnd',
        label: 'Period ends',
        width: 'w-[18%]',
        cell: (sub) => (
          <span className="whitespace-nowrap text-content-muted dark:text-content-muted-dark">
            {sub.current_period_end
              ? new Date(sub.current_period_end).toLocaleDateString('en-GB')
              : '—'}
          </span>
        ),
      },
    ],
    [orgById],
  );

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <AdminPage
      title="Billing"
      description="Subscription state across every organisation."
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !subscriptions ? (
        <AdminLoading />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AdminStat label="Subscriptions" value={subscriptions.length} />
            <AdminStat
              label="Active"
              value={subscriptions.filter((s) => s.status === 'active').length}
            />
            <AdminStat
              label="Organisations without one"
              value={organisations.length - subscriptions.length}
              hint="Not yet on a paid plan"
            />
            <AdminStat
              label="Plans in use"
              value={byPlan.size}
              hint={[...byPlan.keys()].join(', ') || 'None'}
            />
          </div>

          <Card className="border-info/30 bg-info/5">
            <p className="text-sm text-content dark:text-content-dark">
              No payment provider is connected to this deployment.
            </p>
            <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
              `subscriptions` records which plan each organisation is on and when its
              period ends. Revenue, invoices and payment history are not shown because
              nothing here computes them — the provider field is pluggable by design and
              charging is built last (docs/SCHEMA.md).
            </p>
          </Card>

          {subscriptions.length === 0 ? (
            <AdminEmpty message="No organisation has a subscription record yet." />
          ) : (
            <Card className="overflow-hidden p-0">
              <DataTable
                caption="Subscription records by organisation"
                columns={columns}
                rows={subscriptions}
                rowKey={(sub) => sub.id}
              />
            </Card>
          )}
        </div>
      )}
    </AdminPage>
  );
}
