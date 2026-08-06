import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card, Panel } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { PanelTabs } from '@/components/ui/PanelTabs';
import { Callout } from '@/components/ui/Callout';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { DEMO_USER_ACCOUNT } from '@/lib/adminOverviewDemo';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import {
  getProfileById,
  listUserAuditLogs,
  listUserMemberships,
  type UserMembershipRow,
} from '@/services/platformUserService';
import { listPlatformAdmins } from '@/services/platformRoleService';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { reportError } from '@/lib/sentry';
import { PLATFORM_ROLE_LABELS, PLATFORM_ROLE_SCOPES } from '@/lib/platformRoles';
import type { AuditLog, PlatformRole, Profile } from '@/types';

type Tab = 'overview' | 'organisations' | 'roles' | 'activity' | 'security';

const TABS = [
  { value: 'overview', label: 'Overview' },
  { value: 'organisations', label: 'Organisations' },
  { value: 'roles', label: 'Roles' },
  { value: 'activity', label: 'Activity' },
  { value: 'security', label: 'Security' },
] as const satisfies readonly { value: Tab; label: string }[];

interface Detail {
  profile: Profile;
  memberships: UserMembershipRow[];
  audit: AuditLog[];
  platformRole: PlatformRole | null;
}

/**
 * `/admin/users/:userId`, one account, across every tenant it touches.
 *
 * ## Tabs the spec names that are not here
 *
 * **Sessions** and **Security** need `auth.sessions` and the Auth Admin API,
 * which are reachable only from a service-role Edge Function, a static client
 * cannot hold that key. So there is no session list, no "sign out everywhere"
 * and no MFA state, and the Overview tab says so rather than showing an empty
 * panel that implies the data is merely missing. audit01 §4 already records
 * all three as absent.
 *
 * **Roles** is folded into Overview and Organisations: an account's roles are
 * its memberships plus its platform grant, and a third tab restating both would
 * be a tab for the sake of the spec's bullet list.
 */
/** One `dt`/`dd` pair in the profile panels. */
function Row({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): JSX.Element {
  return (
    <>
      <dt className="text-content-muted dark:text-content-muted-dark">{label}</dt>
      <dd className="font-medium text-content dark:text-content-dark">{children}</dd>
    </>
  );
}

export function AdminUserDetailPage(): JSX.Element {
  const { userId = '' } = useParams();

  const [detail, setDetail] = useState<Detail | null>(null);
  const [failed, setFailed] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // In the URL rather than in component state, so a link can point at a
  // particular tab, "see the audit tab on this tenant" is a message people
  // send, and it was unlinkable before.
  const [params, setParams] = useSearchParams();
  const requestedTab = params.get('tab');
  const tab: Tab = TABS.some((t) => t.value === requestedTab)
    ? (requestedTab as Tab)
    : 'overview';
  const setTab = useCallback(
    (next: Tab) => {
      setParams((prev) => {
        const copy = new URLSearchParams(prev);
        copy.set('tab', next);
        return copy;
      });
    },
    [setParams],
  );

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
  useRegisterConsoleRefresh(retry);

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
      avatar={
        <StaffAvatar
          firstName={(profile.full_name ?? profile.email ?? '?').split(' ')[0] ?? '?'}
          lastName={(profile.full_name ?? '').split(' ')[1] ?? ''}
          photoUrl={profile.avatar_url}
          size="xl"
        />
      }
      meta={
        <>
          <span className="font-mono text-xs">
            {profile.email ?? 'No email recorded'}
          </span>
          <span aria-hidden="true">·</span>
          <span>Joined {new Date(profile.created_at).toLocaleDateString('en-GB')}</span>
          {(detail.platformRole || profile.is_platform_admin) && (
            <Badge tone="info" dot>
              Platform staff
            </Badge>
          )}
        </>
      }
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
          <div className="grid gap-4 lg:grid-cols-2">
            <Panel title="Profile" bodyClassName="p-4">
              <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-3 text-sm">
                <Row label="Full name">{profile.full_name ?? 'Not recorded'}</Row>
                <Row label="Email">
                  <span className="font-mono text-xs">
                    {profile.email ?? 'Not recorded'}
                  </span>
                </Row>
                <Row label="Created">
                  {new Date(profile.created_at).toLocaleDateString('en-GB')}
                </Row>
                <Row label="User ID">
                  <span className="font-mono text-xs">{profile.id}</span>
                </Row>
                {/* Verified, last login and MFA all live in `auth.users`,
                    which this client cannot read. Chipped so nobody takes a
                    placeholder for a fact about a real person. */}
                {DEMO_USER_ACCOUNT.map((row) => (
                  <Row key={row.label} label={row.label}>
                    <span className="flex flex-wrap items-center gap-2">
                      {row.value}
                      <Badge tone="warning">Placeholder</Badge>
                    </span>
                  </Row>
                ))}
              </dl>
            </Panel>

            <Panel title="Access" bodyClassName="p-4">
              <dl className="grid grid-cols-[9rem_1fr] gap-x-4 gap-y-3 text-sm">
                <Row label="Organisations">
                  {detail.memberships.length === 0 ? (
                    'None'
                  ) : (
                    <span className="flex flex-col gap-1">
                      {detail.memberships.map((m) => (
                        <Link
                          key={m.orgId}
                          to={`/admin/organisations/${m.orgId}`}
                          className="text-primary hover:underline"
                        >
                          {m.orgName}
                        </Link>
                      ))}
                    </span>
                  )}
                </Row>
                <Row label="Organisation role">
                  {detail.memberships.length === 0 ? (
                    '-'
                  ) : (
                    <span className="flex flex-wrap gap-1">
                      {detail.memberships.map((m) => (
                        <Badge key={m.orgId} tone="neutral">
                          {m.role}
                        </Badge>
                      ))}
                    </span>
                  )}
                </Row>
                <Row label="Platform role">
                  {detail.platformRole
                    ? PLATFORM_ROLE_LABELS[detail.platformRole]
                    : profile.is_platform_admin
                      ? 'Administrator, no granular role'
                      : 'None. Customer account'}
                </Row>
                <Row label="Recorded actions">
                  {detail.audit.length}{' '}
                  <span className="font-normal">(most recent 100)</span>
                </Row>
              </dl>
            </Panel>
          </div>
        )}

        {tab === 'roles' && (
          <div className="space-y-4">
            <Panel title="Platform role" bodyClassName="p-4">
              <p className="text-sm text-content dark:text-content-dark">
                {detail.platformRole
                  ? `${PLATFORM_ROLE_LABELS[detail.platformRole]}, ${PLATFORM_ROLE_SCOPES[detail.platformRole]}`
                  : profile.is_platform_admin
                    ? 'This account holds the platform administrator flag but no granular role, so it reads every organisation and can change nothing that is role-gated.'
                    : 'This is a customer account. It holds no platform role and sees only its own organisations.'}
              </p>
              <p className="mt-3 text-sm text-content-muted dark:text-content-muted-dark">
                Platform roles are granted and revoked on{' '}
                <Link
                  to="/admin/settings?tab=administrators"
                  className="text-primary hover:underline"
                >
                  Platform settings
                </Link>
                , where the last-owner rule is enforced by the database as well as the
                screen.
              </p>
            </Panel>

            <Panel title="Organisation roles" flush>
              <DataTable
                caption="Roles this account holds inside each tenant"
                columns={membershipColumns}
                rows={detail.memberships}
                rowKey={(row) => row.orgId}
                emptyMessage="This account belongs to no organisation."
              />
            </Panel>
          </div>
        )}

        {tab === 'security' && (
          <Callout tone="warning" title="Sessions and security are not readable here">
            <p>
              Active sessions, sign-in history, &ldquo;sign out everywhere&rdquo; and
              two-factor state all live in Supabase&rsquo;s <code>auth</code> schema,
              reachable only through the Auth Admin API from a service-role Edge Function.
              A static client cannot hold that key.
            </p>
            <p>
              So this tab is empty on purpose rather than showing zeroes, which would read
              as &ldquo;this person has never signed in&rdquo;. Building it means an Edge
              Function that exposes exactly these fields and nothing else.
            </p>
          </Callout>
        )}

        {tab === 'organisations' && (
          <Panel title="Memberships" flush>
            <DataTable
              caption="Organisations this account belongs to"
              columns={membershipColumns}
              rows={detail.memberships}
              rowKey={(row) => row.orgId}
              emptyMessage="This account belongs to no organisation."
            />
          </Panel>
        )}

        {tab === 'activity' && (
          <Panel title="Actions across every tenant" flush>
            <ul>
              {detail.audit.length === 0 ? (
                <li className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
                  Nothing recorded for this account yet.
                </li>
              ) : (
                detail.audit.map((entry) => (
                  <li
                    key={entry.id}
                    className="border-b border-divider px-4 py-2.5 last:border-0 dark:border-divider-dark"
                  >
                    <p className="text-sm font-medium text-content dark:text-content-dark">
                      {entry.action}
                      {entry.entity_type ? ` · ${entry.entity_type}` : ''}
                    </p>
                    <p className="text-xs text-content-muted dark:text-content-muted-dark">
                      {entry.org_name ?? (entry.scope === 'platform' ? 'Platform' : '-')}{' '}
                      · {new Date(entry.created_at).toLocaleString('en-GB')}
                    </p>
                  </li>
                ))
              )}
            </ul>
          </Panel>
        )}
      </div>
    </AdminPage>
  );
}
