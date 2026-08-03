import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import { listAllProfiles, setPlatformAdmin } from '@/services/platformService';
import { listPlatformAdmins } from '@/services/platformRoleService';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { reportError } from '@/lib/sentry';
import { PLATFORM_ROLE_LABELS } from '@/lib/platformRoles';
import type { PlatformRole, Profile } from '@/types';

/**
 * `/admin/users` — NEW_STRUCTURE §34's platform users.
 *
 * ## This screen did not work before 0015
 *
 * `profiles` RLS was still 0001's own-row-only policy, so `listAllProfiles()`
 * returned exactly one row — the reader's own — and the toggle wrote to zero
 * rows and got back a 204 with no error. It rendered a one-account table and a
 * button that reported success and changed nothing. 0015 widens the read to
 * platform administrators and moves the write onto RPCs that enforce their
 * rules in the database.
 *
 * The one write here is still the most dangerous switch in the product: it
 * grants read access to every tenant's data. So it confirms, it says what it
 * grants in plain words, and it refuses to strand the platform — a rule now
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
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setProfiles(null);
    void (async () => {
      try {
        const [rows, admins] = await Promise.all([
          listAllProfiles(),
          // Cannot reject the screen: before 0015 is applied the table does
          // not exist, and the account list is still worth showing without
          // the granular role beside it.
          listPlatformAdmins().catch((err: unknown) => {
            reportError(err, { area: 'admin:users:roles' });
            return [];
          }),
        ]);
        if (!active) return;
        setProfiles(rows);
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

  const visible = useMemo(() => {
    if (!profiles) return [];
    const q = search.trim().toLowerCase();
    if (!q) return profiles;
    return profiles.filter(
      (p) =>
        (p.email ?? '').toLowerCase().includes(q) ||
        (p.full_name ?? '').toLowerCase().includes(q),
    );
  }, [profiles, search]);

  const adminCount = useMemo(
    () => (profiles ?? []).filter((p) => p.is_platform_admin).length,
    [profiles],
  );

  const handleToggle = useCallback(
    async (profile: Profile): Promise<void> => {
      const granting = !profile.is_platform_admin;
      const who = profile.full_name ?? profile.email ?? 'this account';

      const ok = await confirm({
        title: granting
          ? `Grant platform administrator to ${who}?`
          : `Remove platform administrator from ${who}?`,
        message: granting
          ? 'They will be able to read data belonging to every organisation on RotaFlow, including staff records and rotas. They are granted the Platform Support role — the most limited one — and can be promoted from the administrators roster. Grant this only to people who support the platform itself.'
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

  const columns = useMemo<DataTableColumn<Profile>[]>(
    () => [
      {
        key: 'account',
        label: 'Account',
        width: 'w-[34%]',
        cell: (profile) => (
          <>
            <p className="truncate font-medium text-content dark:text-content-dark">
              {profile.full_name ?? '—'}
              {profile.id === user?.id && (
                <span className="ml-2 text-xs font-normal text-content-muted dark:text-content-muted-dark">
                  (you)
                </span>
              )}
            </p>
            <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
              {profile.email ?? 'No email recorded'}
            </p>
          </>
        ),
      },
      {
        key: 'access',
        label: 'Platform access',
        width: 'w-[26%]',
        cell: (profile) => {
          if (!profile.is_platform_admin) {
            return (
              <span className="text-content-muted dark:text-content-muted-dark">
                Standard
              </span>
            );
          }
          const role = roleByUser.get(profile.id);
          return (
            <Badge tone="danger">
              {role ? PLATFORM_ROLE_LABELS[role] : 'Platform administrator'}
            </Badge>
          );
        },
      },
      {
        key: 'joined',
        label: 'Joined',
        width: 'w-[18%]',
        cell: (profile) => (
          <span className="whitespace-nowrap text-content-muted dark:text-content-muted-dark">
            {new Date(profile.created_at).toLocaleDateString('en-GB')}
          </span>
        ),
      },
      {
        key: 'actions',
        label: '',
        width: 'w-[22%]',
        align: 'right',
        cell: (profile) => {
          const isSelf = profile.id === user?.id;
          // Removing your own access, or the last admin's, cannot be undone
          // from inside the product.
          const wouldStrandPlatform =
            profile.is_platform_admin && (isSelf || adminCount <= 1);
          const disabled =
            busyId === profile.id || wouldStrandPlatform || !canManagePlatformAdmins;
          return (
            <Button
              variant="secondary"
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
            >
              {profile.is_platform_admin ? (
                <>
                  <ShieldOff size={14} aria-hidden="true" />
                  Remove
                </>
              ) : (
                <>
                  <ShieldCheck size={14} aria-hidden="true" />
                  Make admin
                </>
              )}
            </Button>
          );
        },
      },
    ],
    [user?.id, roleByUser, adminCount, busyId, canManagePlatformAdmins, handleToggle],
  );

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <AdminPage
      title="Platform users"
      description="Every account with a RotaFlow profile, and who holds platform administrator access."
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !profiles ? (
        <AdminLoading />
      ) : (
        <div className="space-y-4">
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or email…"
            aria-label="Search accounts"
            className="max-w-sm"
          />

          <Card className="overflow-hidden p-0">
            <DataTable
              caption="Accounts with a RotaFlow profile"
              columns={columns}
              rows={visible}
              rowKey={(profile) => profile.id}
              emptyMessage="No account matches that search."
            />
          </Card>
        </div>
      )}
    </AdminPage>
  );
}
