import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/Card';
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
  AdminStat,
} from '@/components/admin/AdminPage';
import {
  countMembershipsByOrg,
  listAllOrganisations,
  listAllProfiles,
  listAllSubscriptions,
  listPlatformAuditLogs,
} from '@/services/platformService';
import { reportError } from '@/lib/sentry';
import type { AuditLog, Organisation, Profile, Subscription } from '@/types';

interface Snapshot {
  organisations: Organisation[];
  profiles: Profile[];
  subscriptions: Subscription[];
  recentAudit: AuditLog[];
  members: Map<string, number>;
}

/** `/admin` — NEW_STRUCTURE §34's platform dashboard. */
export function AdminOverviewPage(): JSX.Element {
  const [data, setData] = useState<Snapshot | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setData(null);
    void (async () => {
      try {
        const [organisations, profiles, subscriptions, recentAudit, members] =
          await Promise.all([
            listAllOrganisations(),
            listAllProfiles(),
            listAllSubscriptions(),
            listPlatformAuditLogs(10),
            countMembershipsByOrg(),
          ]);
        if (!active) return;
        setData({ organisations, profiles, subscriptions, recentAudit, members });
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:overview' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <AdminPage
      title="Platform overview"
      description="Every organisation, account and subscription on this deployment."
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !data ? (
        <AdminLoading />
      ) : (
        <div className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <AdminStat
              label="Organisations"
              value={data.organisations.length}
              hint="Tenants on this deployment"
            />
            <AdminStat
              label="Accounts"
              value={data.profiles.length}
              hint={`${data.profiles.filter((p) => p.is_platform_admin).length} platform administrator(s)`}
            />
            <AdminStat
              label="Active memberships"
              value={[...data.members.values()].reduce((a, b) => a + b, 0)}
              hint="Across every organisation"
            />
            <AdminStat
              label="Subscriptions"
              value={data.subscriptions.length}
              hint={
                data.subscriptions.length === 0
                  ? 'No billing records yet'
                  : `${data.subscriptions.filter((s) => s.status === 'active').length} active`
              }
            />
          </div>

          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-content dark:text-content-dark">
                Largest organisations
              </h2>
              <Link
                to="/admin/organisations"
                className="text-sm font-medium text-primary hover:underline"
              >
                View all
              </Link>
            </div>
            {data.organisations.length === 0 ? (
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                No organisations yet.
              </p>
            ) : (
              <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
                {[...data.organisations]
                  .sort(
                    (a, b) =>
                      (data.members.get(b.id) ?? 0) - (data.members.get(a.id) ?? 0),
                  )
                  .slice(0, 5)
                  .map((org) => (
                    <li
                      key={org.id}
                      className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0"
                    >
                      <span className="truncate text-sm font-medium text-content dark:text-content-dark">
                        {org.name}
                      </span>
                      <span className="shrink-0 text-sm text-content-muted dark:text-content-muted-dark">
                        {data.members.get(org.id) ?? 0} member
                        {(data.members.get(org.id) ?? 0) === 1 ? '' : 's'}
                      </span>
                    </li>
                  ))}
              </ul>
            )}
          </Card>

          <Card>
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-semibold text-content dark:text-content-dark">
                Recent activity
              </h2>
              <Link
                to="/admin/audit"
                className="text-sm font-medium text-primary hover:underline"
              >
                View audit log
              </Link>
            </div>
            {data.recentAudit.length === 0 ? (
              <AdminEmpty message="No audit events recorded yet." />
            ) : (
              <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
                {data.recentAudit.map((entry) => (
                  <li key={entry.id} className="py-2.5 first:pt-0 last:pb-0">
                    <p className="text-sm text-content dark:text-content-dark">
                      {entry.action}
                      {entry.entity_type ? ` · ${entry.entity_type}` : ''}
                    </p>
                    <p className="text-xs text-content-muted dark:text-content-muted-dark">
                      {new Date(entry.created_at).toLocaleString('en-GB')}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      )}
    </AdminPage>
  );
}
