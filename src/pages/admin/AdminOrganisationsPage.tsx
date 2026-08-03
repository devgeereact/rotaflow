import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import {
  DataTable,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/ui/DataTable';
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
} from '@/components/admin/AdminPage';
import {
  countMembershipsByOrg,
  listAllOrganisations,
  listAllSubscriptions,
} from '@/services/platformService';
import { reportError } from '@/lib/sentry';
import type { Organisation, Subscription } from '@/types';

type OrgSortKey = 'organisation' | 'members' | 'plan' | 'created';

/** `/admin/organisations` — NEW_STRUCTURE §34's tenant management. */
export function AdminOrganisationsPage(): JSX.Element {
  const [organisations, setOrganisations] = useState<Organisation[] | null>(null);
  const [members, setMembers] = useState<Map<string, number>>(new Map());
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [sort, setSort] = useState<DataTableSort<OrgSortKey> | null>(null);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setOrganisations(null);
    void (async () => {
      try {
        const [orgs, counts, subs] = await Promise.all([
          listAllOrganisations(),
          countMembershipsByOrg(),
          listAllSubscriptions(),
        ]);
        if (!active) return;
        setOrganisations(orgs);
        setMembers(counts);
        setSubscriptions(subs);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:organisations' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const planByOrg = useMemo(() => {
    const map = new Map<string, Subscription>();
    for (const sub of subscriptions) map.set(sub.org_id, sub);
    return map;
  }, [subscriptions]);

  const visible = useMemo(() => {
    if (!organisations) return [];
    const q = search.trim().toLowerCase();
    const filtered = q
      ? organisations.filter(
          (o) => o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q),
        )
      : organisations;

    // `null` sort keeps the service's own order — newest tenant first — which
    // is the more useful default on this screen than any column.
    if (!sort) return filtered;

    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case 'members':
          return ((members.get(a.id) ?? 0) - (members.get(b.id) ?? 0)) * direction;
        case 'plan':
          return (
            (planByOrg.get(a.id)?.plan ?? '').localeCompare(
              planByOrg.get(b.id)?.plan ?? '',
            ) * direction
          );
        case 'created':
          return (
            (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) *
            direction
          );
        default:
          return a.name.localeCompare(b.name) * direction;
      }
    });
  }, [organisations, search, sort, members, planByOrg]);

  const columns = useMemo<DataTableColumn<Organisation, OrgSortKey>[]>(
    () => [
      {
        key: 'organisation',
        label: 'Organisation',
        width: 'w-[38%]',
        sortable: true,
        cell: (org) => (
          <>
            <p className="truncate font-medium text-content dark:text-content-dark">
              {org.name}
            </p>
            <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
              {org.slug}
            </p>
          </>
        ),
      },
      {
        key: 'members',
        label: 'Members',
        width: 'w-[16%]',
        sortable: true,
        cell: (org) => <span className="font-mono">{members.get(org.id) ?? 0}</span>,
      },
      {
        key: 'plan',
        label: 'Plan',
        width: 'w-[24%]',
        sortable: true,
        cell: (org) => {
          const sub = planByOrg.get(org.id);
          return sub ? (
            <Badge tone={sub.status === 'active' ? 'success' : 'warning'}>
              {sub.plan}
            </Badge>
          ) : (
            <span className="text-content-muted dark:text-content-muted-dark">
              No subscription
            </span>
          );
        },
      },
      {
        key: 'created',
        label: 'Created',
        width: 'w-[22%]',
        sortable: true,
        cell: (org) => (
          <span className="whitespace-nowrap text-content-muted dark:text-content-muted-dark">
            {new Date(org.created_at).toLocaleDateString('en-GB')}
          </span>
        ),
      },
    ],
    [members, planByOrg],
  );

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <AdminPage
      title="Organisations"
      description="Every tenant on this deployment, with its size and billing plan."
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !organisations ? (
        <AdminLoading />
      ) : organisations.length === 0 ? (
        <AdminEmpty message="No organisations have been created on this deployment yet." />
      ) : (
        <div className="space-y-4">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search organisations…"
            aria-label="Search organisations"
            className="max-w-sm"
          />

          {/* The table scrolls inside its own container so the page never
              does — the pattern §27 asks for on wide data. `DataTable` owns
              that, along with the sort affordance and the empty row. */}
          <Card className="overflow-hidden p-0">
            <DataTable
              caption="Organisations on this deployment"
              columns={columns}
              rows={visible}
              rowKey={(org) => org.id}
              sort={sort}
              onSortChange={setSort}
              emptyMessage="No organisation matches that search."
            />
          </Card>
        </div>
      )}
    </AdminPage>
  );
}
