import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
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

/** `/admin/organisations` — NEW_STRUCTURE §34's tenant management. */
export function AdminOrganisationsPage(): JSX.Element {
  const [organisations, setOrganisations] = useState<Organisation[] | null>(null);
  const [members, setMembers] = useState<Map<string, number>>(new Map());
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');

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
    if (!q) return organisations;
    return organisations.filter(
      (o) => o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q),
    );
  }, [organisations, search]);

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

          <Card className="p-0">
            {/* Table scrolls inside its own container so the page never does
                — the pattern §27 asks for on wide data. */}
            <div className="overflow-x-auto">
              <table className="w-full min-w-[44rem] text-sm">
                <thead>
                  <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
                    <th className="px-5 py-3 font-medium">Organisation</th>
                    <th className="px-5 py-3 font-medium">Members</th>
                    <th className="px-5 py-3 font-medium">Plan</th>
                    <th className="px-5 py-3 font-medium">Created</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((org) => {
                    const sub = planByOrg.get(org.id);
                    return (
                      <tr
                        key={org.id}
                        className="border-b border-surface-border last:border-0 dark:border-surface-border-dark"
                      >
                        <td className="px-5 py-3">
                          <p className="font-medium text-content dark:text-content-dark">
                            {org.name}
                          </p>
                          <p className="text-xs text-content-muted dark:text-content-muted-dark">
                            {org.slug}
                          </p>
                        </td>
                        <td className="px-5 py-3 text-content dark:text-content-dark">
                          {members.get(org.id) ?? 0}
                        </td>
                        <td className="px-5 py-3">
                          {sub ? (
                            <Badge tone={sub.status === 'active' ? 'success' : 'warning'}>
                              {sub.plan}
                            </Badge>
                          ) : (
                            <span className="text-content-muted dark:text-content-muted-dark">
                              No subscription
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-content-muted dark:text-content-muted-dark">
                          {new Date(org.created_at).toLocaleDateString('en-GB')}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {visible.length === 0 && (
            <AdminEmpty message="No organisation matches that search." />
          )}
        </div>
      )}
    </AdminPage>
  );
}
