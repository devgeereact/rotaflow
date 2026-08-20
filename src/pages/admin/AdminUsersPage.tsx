import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import {
  DataTable,
  type DataTableColumn,
  type DataTableSort,
} from '@/components/ui/DataTable';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import { listAllProfiles, setPlatformAdmin } from '@/services/platformService';
import {
  summariseMembershipsByUser,
  type UserMembershipSummary,
} from '@/services/platformUserService';
import { listPlatformAdmins } from '@/services/platformRoleService';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { reportError } from '@/lib/sentry';
import { humaniseKey } from '@/lib/platformOverview';
import { downloadCsv } from '@/lib/csv';
import {
  getAuthFactsSummary,
  type AuthFactsSummary,
} from '@/services/platformFactsService';
import { PLATFORM_ROLE_LABELS } from '@/lib/platformRoles';
import type { PlatformRole, Profile } from '@/types';

type UserSortKey =
  'account' | 'organisations' | 'role' | 'access' | 'status' | 'login' | 'actions';

/**
 * `/admin/users`. NEW_STRUCTURE §34's platform users.
 *
 * ## This screen did not work before 0015
 *
 * `profiles` RLS was still 0001's own-row-only policy, so `listAllProfiles()`
 * returned exactly one row. The reader's own, and the toggle wrote to zero
 * rows and got back a 204 with no error. It rendered a one-account table and a
 * button that reported success and changed nothing. 0015 widens the read to
 * platform administrators and moves the write onto RPCs that enforce their
 * rules in the database.
 *
 * The one write here is still the most dangerous switch in the product: it
 * grants read access to every tenant's data. So it confirms, it says what it
 * grants in plain words, and it refuses to strand the platform, a rule now
 * held in `revoke_platform_role` as well as here, because a guard that lives
 * only in the browser is not a guard.
 */
export function AdminUsersPage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const { canManagePlatformAdmins } = usePermissions();
  const { showError, showSuccess } = useToast();
  const { confirm } = useConfirm();

  const [profiles, setProfiles] = useState<Profile[] | null>(null);
  const [roleByUser, setRoleByUser] = useState<Map<string, PlatformRole>>(new Map());
  const [authFacts, setAuthFacts] = useState<AuthFactsSummary | null>(null);
  const [memberships, setMemberships] = useState<Map<string, UserMembershipSummary>>(
    new Map(),
  );
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [access, setAccess] = useState('');
  const [orgRole, setOrgRole] = useState('');
  const [sort, setSort] = useState<DataTableSort<UserSortKey> | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setProfiles(null);
    void (async () => {
      try {
        const [rows, admins, summaries, authFacts] = await Promise.all([
          listAllProfiles(),
          // Cannot reject the screen: before 0015 is applied the table does
          // not exist, and the account list is still worth showing without
          // the granular role beside it.
          listPlatformAdmins().catch((err: unknown) => {
            reportError(err, { area: 'admin:users:roles' });
            return [];
          }),
          summariseMembershipsByUser(),
          // Email confirmation, last sign-in and MFA live in `auth.users`,
          // which no client may select from. 0027's definer function is the
          // narrow window onto exactly those three columns.
          getAuthFactsSummary().catch((err: unknown) => {
            reportError(err, { area: 'admin:users:auth-facts' });
            return null;
          }),
        ]);
        if (!active) return;
        setProfiles(rows);
        setMemberships(summaries);
        setAuthFacts(authFacts);
        setRoleByUser(
          new Map(
            admins
              .filter((a) => a.revoked_at === null)
              .map((a) => [a.user_id, a.role as PlatformRole]),
          ),
        );
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:users' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  /**
   * Per-account status, MFA and last sign-in.
   *
   * Deliberately not fetched per row. `platform_user_auth_facts` is one round
   * trip per account, and a table of two hundred users would make two hundred
   * of them to fill a column nobody sorts by. The totals come from the summary
   * function instead, and a single account's facts are shown on its own detail
   * screen where one call is proportionate.
   */

  const visible = useMemo(() => {
    if (!profiles) return [];
    const q = search.trim().toLowerCase();
    const filtered = profiles.filter((p) => {
      if (access === 'platform' && !p.is_platform_admin) return false;
      if (access === 'standard' && p.is_platform_admin) return false;
      if (orgRole && !(memberships.get(p.id)?.roles ?? []).includes(orgRole)) {
        return false;
      }
      if (!q) return true;
      return (
        (p.email ?? '').toLowerCase().includes(q) ||
        (p.full_name ?? '').toLowerCase().includes(q) ||
        (memberships.get(p.id)?.soleOrgName ?? '').toLowerCase().includes(q)
      );
    });

    if (!sort) return filtered;
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...filtered].sort((a, b) => {
      switch (sort.key) {
        case 'organisations':
          return (
            ((memberships.get(a.id)?.organisations ?? 0) -
              (memberships.get(b.id)?.organisations ?? 0)) *
            direction
          );
        case 'access':
          return (Number(a.is_platform_admin) - Number(b.is_platform_admin)) * direction;
        case 'role':
          return (
            (memberships.get(a.id)?.roles[0] ?? '').localeCompare(
              memberships.get(b.id)?.roles[0] ?? '',
            ) * direction
          );
        case 'status': {
          // Mirror the cell's own definition of "suspended" (a membership
          // with zero roles), not name — this used to sort alphabetically
          // under a "Status" header.
          const suspendedOf = (p: Profile): boolean => {
            const m = memberships.get(p.id);
            return m !== undefined && m.organisations > 0 && m.roles.length === 0;
          };
          return (Number(suspendedOf(a)) - Number(suspendedOf(b))) * direction;
        }
        case 'login':
          return (
            (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) *
            direction
          );
        default:
          return (
            (a.full_name ?? a.email ?? '').localeCompare(b.full_name ?? b.email ?? '') *
            direction
          );
      }
    });
  }, [profiles, search, access, orgRole, sort, memberships]);

  const adminCount = useMemo(
    () => (profiles ?? []).filter((p) => p.is_platform_admin).length,
    [profiles],
  );

  const summary = useMemo(() => {
    if (!profiles) return null;
    const withMembership = profiles.filter(
      (p) => (memberships.get(p.id)?.organisations ?? 0) > 0,
    ).length;
    return {
      total: profiles.length,
      withMembership,
      unattached: profiles.length - withMembership,
      admins: adminCount,
      multiOrg: profiles.filter((p) => (memberships.get(p.id)?.organisations ?? 0) > 1)
        .length,
      roles: [...new Set([...memberships.values()].flatMap((m) => m.roles))].sort(),
    };
  }, [profiles, memberships, adminCount]);

  const handleToggle = useCallback(
    async (profile: Profile): Promise<void> => {
      const granting = !profile.is_platform_admin;
      const who = profile.full_name ?? profile.email ?? 'this account';

      const ok = await confirm({
        title: granting
          ? `Grant platform administrator to ${who}?`
          : `Remove platform administrator from ${who}?`,
        message: granting
          ? 'They will be able to read data belonging to every organisation on RotaFlow, including staff records and rotas. They are granted the Platform Support role. The most limited one, and can be promoted from the administrators roster. Grant this only to people who support the platform itself.'
          : 'They will lose access to the platform administration area and to other organisations’ data. Their own organisation membership is unchanged.',
        confirmLabel: granting ? 'Grant access' : 'Remove access',
        tone: 'danger',
      });
      if (!ok) return;

      setBusyId(profile.id);
      try {
        await setPlatformAdmin(profile.id, granting);
        setProfiles(
          (prev) =>
            prev?.map((p) =>
              p.id === profile.id ? { ...p, is_platform_admin: granting } : p,
            ) ?? null,
        );
        setRoleByUser((prev) => {
          const next = new Map(prev);
          if (granting) next.set(profile.id, 'platform_support');
          else next.delete(profile.id);
          return next;
        });
        showSuccess(granting ? 'Platform access granted.' : 'Platform access removed.');
      } catch (err) {
        reportError(err, { area: 'admin:set-platform-admin' });
        // Surface the database's own refusal rather than a generic failure:
        // "Only a platform owner can grant platform roles" and "Cannot revoke
        // the last platform owner" both tell the reader what to do next, and
        // "Please try again" tells them to repeat something that cannot work.
        showError(
          err instanceof Error && err.message
            ? err.message
            : 'Could not change that. Please try again.',
        );
      } finally {
        setBusyId(null);
      }
    },
    [confirm, showError, showSuccess],
  );

  const columns = useMemo<DataTableColumn<Profile, UserSortKey>[]>(
    () => [
      {
        key: 'account',
        label: 'User',
        width: 'w-[22%]',
        sortable: true,
        cell: (profile) => (
          <span className="flex min-w-0 items-center gap-2.5">
            <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-primary/20 bg-primary-wash text-[0.65rem] font-semibold text-primary dark:bg-primary-wash-dark">
              {(profile.full_name ?? profile.email ?? '?')
                .split(/[\s@.]+/)
                .slice(0, 2)
                .map((w) => w[0])
                .join('')
                .toUpperCase()}
            </span>
            <span className="min-w-0">
              <Link
                to={`/admin/users/${profile.id}`}
                className="block truncate font-medium text-content hover:text-primary dark:text-content-dark"
              >
                {profile.full_name ?? '-'}
                {profile.id === user?.id && (
                  <span className="ml-1.5 text-xs font-normal text-content-muted dark:text-content-muted-dark">
                    (you)
                  </span>
                )}
              </Link>
              <span className="block truncate text-xs text-content-muted dark:text-content-muted-dark">
                {profile.email ?? 'No email recorded'}
              </span>
            </span>
          </span>
        ),
      },
      {
        key: 'organisations',
        label: 'Organisation',
        width: 'w-[16%]',
        sortable: true,
        cell: (profile) => {
          const m = memberships.get(profile.id);
          if (!m || m.organisations === 0) {
            return (
              <span className="text-content-muted dark:text-content-muted-dark">
                No membership
              </span>
            );
          }
          return (
            <span className="block truncate text-primary">
              {m.soleOrgName ?? `${m.organisations} organisations`}
            </span>
          );
        },
      },
      {
        key: 'role',
        label: 'Org role',
        width: 'w-[9%]',
        sortable: true,
        cell: (profile) => {
          const roles = memberships.get(profile.id)?.roles ?? [];
          return roles.length ? (
            <Badge tone="neutral">{roles[0]}</Badge>
          ) : (
            <span className="text-content-muted dark:text-content-muted-dark">-</span>
          );
        },
      },
      {
        key: 'access',
        label: 'Platform role',
        width: 'w-[14%]',
        sortable: true,
        cell: (profile) => {
          if (!profile.is_platform_admin) {
            return (
              <span className="text-content-muted dark:text-content-muted-dark">-</span>
            );
          }
          const role = roleByUser.get(profile.id);
          return (
            <Badge tone="info" dot>
              {role ? PLATFORM_ROLE_LABELS[role] : 'Platform administrator'}
            </Badge>
          );
        },
      },
      {
        key: 'status',
        label: 'Status',
        width: 'w-[11%]',
        sortable: true,
        cell: (profile) => {
          // Per-account verification and MFA live in `auth.users` and cost one
          // round trip each, so they are shown on the account's own screen
          // rather than in a column. What is free here is the membership
          // state this table already loaded.
          const membership = memberships.get(profile.id);
          const suspended =
            membership !== undefined &&
            membership.organisations > 0 &&
            membership.roles.length === 0;
          return (
            <span className="flex flex-col items-start gap-1">
              <Badge tone={suspended ? 'warning' : 'success'} dot>
                {suspended ? 'No active membership' : 'Active'}
              </Badge>
              {profile.is_platform_admin && (
                <Badge tone="info" dot>
                  Platform staff
                </Badge>
              )}
            </span>
          );
        },
      },
      {
        key: 'actions',
        label: 'Actions',
        width: 'w-[11%]',
        align: 'right',
        cell: (profile) => {
          const isSelf = profile.id === user?.id;
          const wouldStrandPlatform =
            profile.is_platform_admin && (isSelf || adminCount <= 1);
          const disabled =
            busyId === profile.id || wouldStrandPlatform || !canManagePlatformAdmins;
          return (
            <span className="flex justify-end gap-1.5">
              <Link
                to={`/admin/users/${profile.id}`}
                className="rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-content hover:bg-surface-subtle dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
              >
                View
              </Link>
              {/* The reference's second action is "Reset". Granting or removing
                  platform access is the dangerous switch this screen actually
                  owns, so that is what sits here, a password reset would need
                  the Auth Admin API, which a static client cannot call. */}
              <button
                type="button"
                disabled={disabled}
                title={
                  !canManagePlatformAdmins
                    ? 'Only a platform owner can change platform roles'
                    : wouldStrandPlatform
                      ? isSelf
                        ? 'You cannot remove your own platform access'
                        : 'This is the only platform administrator'
                      : undefined
                }
                onClick={() => void handleToggle(profile)}
                className="rounded-lg border border-surface-border px-2 py-1 text-xs font-medium text-content hover:bg-surface-subtle disabled:opacity-50 dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
              >
                {profile.is_platform_admin ? 'Revoke' : 'Grant'}
              </button>
            </span>
          );
        },
      },
    ],
    [
      user?.id,
      roleByUser,
      memberships,
      adminCount,
      busyId,
      canManagePlatformAdmins,
      handleToggle,
    ],
  );

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  const exportCsv = useCallback(() => {
    downloadCsv(`platform-users_${new Date().toISOString().slice(0, 10)}`, visible, [
      { label: 'Name', value: (p) => p.full_name ?? '' },
      { label: 'Email', value: (p) => p.email ?? '' },
      {
        label: 'Organisations',
        value: (p) => memberships.get(p.id)?.organisations ?? 0,
      },
      {
        label: 'Org roles',
        value: (p) => (memberships.get(p.id)?.roles ?? []).join(' '),
      },
      {
        label: 'Platform role',
        value: (p) => {
          if (!p.is_platform_admin) return 'standard';
          const role = roleByUser.get(p.id);
          return role ? PLATFORM_ROLE_LABELS[role] : 'platform administrator';
        },
      },
      { label: 'Joined', value: (p) => p.created_at },
    ]);
  }, [visible, memberships, roleByUser]);

  return (
    <AdminPage
      title="Users"
      description="Every account across every organisation. Platform roles are separate from organisation membership and are shown in their own column."
      action={
        <Button variant="secondary" onClick={exportCsv} disabled={visible.length === 0}>
          <Download size={15} aria-hidden="true" />
          Export
        </Button>
      }
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !profiles || !summary ? (
        <AdminLoading />
      ) : (
        <div className="space-y-4">
          <TileGrid>
            <StatTile label="Total users" value={summary.total.toLocaleString('en-GB')} />
            {/* From `platform_auth_facts_summary`, which reads auth.users
                through a definer function. Null when the call was refused or
                failed, and the tiles then say so rather than showing a zero
                that reads as "nobody has signed in". */}
            <StatTile
              label="Active, 30 days"
              value={authFacts ? authFacts.active30d.toLocaleString('en-GB') : '-'}
              hint={
                authFacts && authFacts.totalAccounts > 0
                  ? `${Math.round((authFacts.active30d / authFacts.totalAccounts) * 100)}% of all accounts`
                  : 'Signed in at least once in the last 30 days'
              }
            />
            <StatTile
              label="Inactive 90 days"
              value={authFacts ? authFacts.inactive90d.toLocaleString('en-GB') : '-'}
              hint="Includes accounts that have never signed in"
            />
            <StatTile
              label="Unverified"
              value={authFacts ? authFacts.unverified.toLocaleString('en-GB') : '-'}
              hint={
                authFacts && authFacts.unverified > 0 ? (
                  <span className="font-semibold text-danger">Email never confirmed</span>
                ) : (
                  'Every address confirmed'
                )
              }
            />
            <StatTile
              label="MFA enrolled"
              value={authFacts ? authFacts.mfaEnrolled.toLocaleString('en-GB') : '-'}
              hint={
                authFacts && authFacts.mfaEnrolled === 0 ? (
                  <span className="font-semibold text-warning">
                    Nobody, including staff
                  </span>
                ) : (
                  'Verified factor on the account'
                )
              }
            />
            <StatTile
              label="Platform admins"
              value={summary.admins}
              hint="Can read every tenant"
            />
          </TileGrid>

          <Card className="p-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-divider p-3 dark:border-divider-dark">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search name, email or organisation…"
                aria-label="Search accounts"
                className="max-w-xs"
              />
              <Select
                value={access}
                onChange={(e) => setAccess(e.target.value)}
                aria-label="Filter by platform access"
                className="w-auto"
              >
                <option value="">All accounts</option>
                <option value="platform">Platform administrators</option>
                <option value="standard">Standard accounts</option>
              </Select>
              <Select
                value={orgRole}
                onChange={(e) => setOrgRole(e.target.value)}
                aria-label="Filter by organisation role"
                className="w-auto"
              >
                <option value="">Any organisation role</option>
                {summary.roles.map((role) => (
                  <option key={role} value={role}>
                    {humaniseKey(role)}
                  </option>
                ))}
              </Select>
              <span className="ml-auto font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                {visible.length} of {summary.total}
              </span>
            </div>

            <DataTable
              caption="Accounts with a RotaFlow profile"
              columns={columns}
              rows={visible}
              rowKey={(profile) => profile.id}
              sort={sort}
              onSortChange={setSort}
              emptyMessage="No account matches these filters."
            />
          </Card>

          <p className="text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
            Active, inactive, unverified and MFA come from <code>auth.users</code> through
            a definer function that returns those three facts and nothing else. They are
            totals rather than a column, because reading them per account is one round
            trip each and a table of two hundred users would make two hundred of them. One
            account&rsquo;s own facts are on its detail screen.
          </p>
        </div>
      )}
    </AdminPage>
  );
}
