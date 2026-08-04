import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { PanelTabs } from '@/components/ui/PanelTabs';
import { StatTile } from '@/components/ui/StatTile';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import {
  getProfileById,
  listUserAuditLogs,
  listUserMemberships,
  type UserMembershipRow,
} from '@/services/platformUserService';
import { listPlatformAdmins } from '@/services/platformRoleService';
import { reportError } from '@/lib/sentry';
import { PLATFORM_ROLE_LABELS } from '@/lib/platformRoles';
import type { AuditLog, PlatformRole, Profile } from '@/types';

type Tab = 'overview' | 'organisations' | 'activity';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'organisations', label: 'Organisations' },
  { value: 'activity', label: 'Activity' },
] as const satisfies readonly { value: Tab; label: string }[];

interface Detail {
  profile: Profile;
  memberships: UserMembershipRow[];
  audit: AuditLog[];
  platformRole: PlatformRole | null;
}

/**
 * `/admin/users/:userId` — one account, across every tenant it touches.
 *
 * ## Tabs the spec names that are not here
 *
 * **Sessions** and **Security** need `auth.sessions` and the Auth Admin API,
 * which are reachable only from a service-role Edge Function — a static client
 * cannot hold that key. So there is no session list, no "sign out everywhere"
 * and no MFA state, and the Overview tab says so rather than showing an empty
 * panel that implies the data is merely missing. audit01 §4 already records
 * all three as absent.
 *
 * **Roles** is folded into Overview and Organisations: an account's roles are
 * its memberships plus its platform grant, and a third tab restating both would
 * be a tab for the sake of the spec's bullet list.
 */
export function AdminUserDetailPage(): JSX.Element {
  const { userId = '' } = useParams();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [tab, setTab] = useState<Tab>('overview');

  useEffect(() => {
    let active = true;
    setFailed(false);
    setNotFound(false);
    setDetail(null);
    void (async () => {
      try {
        const profile = await getProfileById(userId);
        if (!active) return;
        if (!profile) {
          setNotFound(true);
          return;
        }
        const [memberships, audit, admins] = await Promise.all([
          listUserMemberships(userId),
          listUserAuditLogs(userId),
          listPlatformAdmins().catch((err: unknown) => {
            reportError(err, { area: 'admin:user-detail:roles' });
            return [];
          }),
        ]);
        if (!active) return;
        const grant = admins.find((a) => a.user_id === userId && a.revoked_at === null);
        setDetail({
          profile,
          memberships,
          audit,
          platformRole: (grant?.role as PlatformRole | undefined) ?? null,
        });
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:user-detail' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [userId, reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  const membershipColumns = useMemo<DataTableColumn<UserMembershipRow>[]>(
    () => [
      {
        key: 'organisation',
        label: 'Organisation',
        width: 'w-[40%]',
        cell: (row) => (
          <Link
            to={`/admin/organisations/${row.orgId}`}
            className="truncate font-medium text-content hover:underline dark:text-content-dark"
          >
            {row.orgName}
          </Link>
        ),
      },
      {
        key: 'role',
        label: 'Role',
        width: 'w-[20%]',
        cell: (row) => <span className="capitalize">{row.role}</span>,
      },
      {
        key: 'status',
        label: 'Membership',
        width: 'w-[20%]',
        cell: (row) => (
          <Badge tone={row.status === 'active' ? 'success' : 'neutral'}>
            {row.status}
          </Badge>
        ),
      },
      {
        key: 'orgStatus',
        label: 'Account',
        width: 'w-[20%]',
        cell: (row) => (
          <Badge tone={row.orgStatus === 'active' ? 'success' : 'warning'}>
            {row.orgStatus}
          </Badge>
        ),
      },
    ],
    [],
  );

  if (notFound) {
    return (
      <AdminPage
        title="Account not found"
        description="No RotaFlow profile has that identifier."
      >
        <Card>
          <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
            The account may have been deleted, or the link may be from another deployment.
          </p>
          <Link to="/admin/users">
            <Button variant="secondary">
              <ArrowLeft size={18} aria-hidden="true" />
              Back to platform users
            </Button>
          </Link>
        </Card>
      </AdminPage>
    );
  }

  if (failed) {
    return (
      <AdminPage title="Account" description="One RotaFlow account.">
        <AdminError onRetry={retry} />
      </AdminPage>
    );
  }

  if (!detail) {
    return (
      <AdminPage title="Account" description="One RotaFlow account.">
        <AdminLoading variant="tiles" rows={3} />
      </AdminPage>
    );
  }

  const { profile } = detail;

  return (
    <AdminPage
      title={profile.full_name ?? profile.email ?? 'Account'}
      description={`${profile.email ?? 'No email recorded'} · joined ${new Date(
        profile.created_at,
      ).toLocaleDateString('en-GB')}`}
    >
      <div className="space-y-5">
        <Link
          to="/admin/users"
          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:underline"
        >
          <ArrowLeft size={15} aria-hidden="true" />
          All platform users
        </Link>

        <PanelTabs
          items={TABS.map((t) => ({ value: t.value, label: t.label }))}
          active={tab}
          onChange={setTab}
          label="Account sections"
        />

        {tab === 'overview' && (
          <div className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-3">
              <StatTile
                label="Organisations"
                value={detail.memberships.length}
                hint={`${detail.memberships.filter((m) => m.status === 'active').length} active`}
              />
              <StatTile
                label="Platform access"
                value={
                  detail.platformRole
                    ? PLATFORM_ROLE_LABELS[detail.platformRole]
                    : profile.is_platform_admin
                      ? 'Administrator'
                      : 'None'
                }
                hint={
                  profile.is_platform_admin
                    ? 'Reads every organisation'
                    : 'Standard account'
                }
              />
              <StatTile
                label="Recorded actions"
                value={detail.audit.length}
                hint="Most recent 100"
              />
            </div>

            <Card className="border-warning/30 bg-warning/5">
              <h2 className="mb-1 font-semibold text-content dark:text-content-dark">
                Sessions and security are not available here
              </h2>
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                Active sessions, sign-in history, “sign out everywhere” and two-factor
                state all live in Supabase’s <code>auth</code> schema, reachable only
                through the Auth Admin API from a service-role Edge Function. A static
                client cannot hold that key, so none of it is shown — rather than shown
                empty, which would read as “this person has never signed in”.
              </p>
            </Card>
          </div>
        )}

        {tab === 'organisations' && (
          <Card className="overflow-hidden p-0">
            <DataTable
              caption="Organisations this account belongs to"
              columns={membershipColumns}
              rows={detail.memberships}
              rowKey={(row) => row.orgId}
              emptyMessage="This account belongs to no organisation."
            />
          </Card>
        )}

        {tab === 'activity' && (
          <Card className="p-0">
            <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
              {detail.audit.length === 0 ? (
                <li className="px-5 py-4 text-sm text-content-muted dark:text-content-muted-dark">
                  Nothing recorded for this account yet.
                </li>
              ) : (
                detail.audit.map((entry) => (
                  <li key={entry.id} className="px-5 py-3">
                    <p className="text-sm font-medium text-content dark:text-content-dark">
                      {entry.action}
                      {entry.entity_type ? ` · ${entry.entity_type}` : ''}
                    </p>
                    <p className="text-xs text-content-muted dark:text-content-muted-dark">
                      {entry.org_name ?? (entry.scope === 'platform' ? 'Platform' : '—')}{' '}
                      · {new Date(entry.created_at).toLocaleString('en-GB')}
                    </p>
                  </li>
                ))
              )}
            </ul>
          </Card>
        )}
      </div>
    </AdminPage>
  );
}
