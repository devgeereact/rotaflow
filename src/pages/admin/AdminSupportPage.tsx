import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ExternalLink } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
} from '@/components/admin/AdminPage';
import { countMembershipsByOrg, listAllOrganisations } from '@/services/platformService';
import { reportError } from '@/lib/sentry';
import type { Organisation } from '@/types';

/**
 * `/admin/support` — NEW_STRUCTURE §34's support tools.
 *
 * ## What is deliberately missing
 *
 * §20 describes time-boxed "platform support access" with an expiry and an
 * access history, and docs/SCHEMA.md lists a `support_access_sessions` table
 * for it. **That table was never created** — it is in the schema document and
 * in no migration. So there is nothing to grant, expire or list, and this
 * screen does not pretend otherwise.
 *
 * What it does instead is the half that is real and useful today: find a
 * tenant, see its size, and open it. A platform admin already reads every
 * organisation through `is_platform_admin()` inside the RLS helpers, so
 * "impersonation" is not a feature that needs building — it is the access they
 * already have, and the honest thing is to make it visible rather than to
 * dress it up as a session that is being granted and audited when it is not.
 */
export function AdminSupportPage(): JSX.Element {
  const [organisations, setOrganisations] = useState<Organisation[] | null>(null);
  const [members, setMembers] = useState<Map<string, number>>(new Map());
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let active = true;
    setFailed(false);
    setOrganisations(null);
    void (async () => {
      try {
        const [orgs, counts] = await Promise.all([
          listAllOrganisations(),
          countMembershipsByOrg(),
        ]);
        if (!active) return;
        setOrganisations(orgs);
        setMembers(counts);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:support' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const visible = useMemo(() => {
    if (!organisations) return [];
    const q = search.trim().toLowerCase();
    if (!q) return organisations.slice(0, 20);
    return organisations.filter(
      (o) => o.name.toLowerCase().includes(q) || o.slug.toLowerCase().includes(q),
    );
  }, [organisations, search]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <AdminPage
      title="Support tools"
      description="Find a customer's organisation when you are helping them."
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !organisations ? (
        <AdminLoading />
      ) : (
        <div className="space-y-6">
          <Card className="border-warning/30 bg-warning/5">
            <h2 className="mb-1 font-semibold text-content dark:text-content-dark">
              Time-boxed support access is not built
            </h2>
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              The product spec describes support access that a customer grants with an
              expiry, plus an access history. That needs a
              <code className="mx-1 rounded bg-surface-subtle px-1 py-0.5 text-xs dark:bg-surface-subtle-dark">
                support_access_sessions
              </code>
              table, which is named in docs/SCHEMA.md but exists in no migration.
            </p>
            <p className="mt-2 text-sm text-content-muted dark:text-content-muted-dark">
              Until it does, your platform administrator flag already grants standing read
              access to every organisation through row-level security. Treat that access
              accordingly — it is not time-boxed and it is not recorded here.
            </p>
          </Card>

          <div>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search organisations…"
              aria-label="Search organisations"
              className="max-w-sm"
            />
            <p className="mt-2 text-xs text-content-muted dark:text-content-muted-dark">
              {search.trim()
                ? `${visible.length} match${visible.length === 1 ? '' : 'es'}.`
                : `Showing the ${visible.length} most recent of ${organisations.length}. Search to find others.`}
            </p>
          </div>

          {visible.length === 0 ? (
            <AdminEmpty message="No organisation matches that search." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {visible.map((org) => (
                <Card key={org.id}>
                  <p className="truncate font-medium text-content dark:text-content-dark">
                    {org.name}
                  </p>
                  <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                    {org.slug}
                  </p>
                  <p className="mt-3 text-sm text-content-muted dark:text-content-muted-dark">
                    {members.get(org.id) ?? 0} active member
                    {(members.get(org.id) ?? 0) === 1 ? '' : 's'} · created{' '}
                    {new Date(org.created_at).toLocaleDateString('en-GB')}
                  </p>
                  <Link
                    to="/admin/audit"
                    className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                  >
                    View its audit events
                    <ExternalLink size={13} aria-hidden="true" />
                  </Link>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}
    </AdminPage>
  );
}
