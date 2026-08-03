import { useCallback, useEffect, useMemo, useState } from 'react';
import { ShieldCheck, ShieldOff } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
} from '@/components/admin/AdminPage';
import { listAllProfiles, setPlatformAdmin } from '@/services/platformService';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { reportError } from '@/lib/sentry';
import type { Profile } from '@/types';

/**
 * `/admin/users` — NEW_STRUCTURE §34's platform users.
 *
 * The one write on this screen is the platform-admin flag, and it is the most
 * dangerous switch in the product: it grants read access to every tenant's
 * data. So it confirms, it says what it grants in plain words, and it refuses
 * to let an administrator remove their own access — locking the last admin out
 * of the platform is unrecoverable without a database console.
 */
export function AdminUsersPage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const { showError, showSuccess } = useToast();
  const { confirm } = useConfirm();

  const [profiles, setProfiles] = useState<Profile[] | null>(null);
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
        const rows = await listAllProfiles();
        if (!active) return;
        setProfiles(rows);
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
          ? 'They will be able to read data belonging to every organisation on RotaFlow, including staff records and rotas. Grant this only to people who support the platform itself.'
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
        showSuccess(granting ? 'Platform access granted.' : 'Platform access removed.');
      } catch (err) {
        reportError(err, { area: 'admin:set-platform-admin' });
        showError('Could not change that. Please try again.');
      } finally {
        setBusyId(null);
      }
    },
    [confirm, showError, showSuccess],
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

          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[42rem] text-sm">
                <thead>
                  <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
                    <th className="px-5 py-3 font-medium">Account</th>
                    <th className="px-5 py-3 font-medium">Platform access</th>
                    <th className="px-5 py-3 font-medium">Joined</th>
                    <th className="px-5 py-3 font-medium" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((profile) => {
                    const isSelf = profile.id === user?.id;
                    // Removing your own access, or the last admin's, cannot be
                    // undone from inside the product.
                    const wouldStrandPlatform =
                      profile.is_platform_admin && (isSelf || adminCount <= 1);
                    return (
                      <tr
                        key={profile.id}
                        className="border-b border-surface-border last:border-0 dark:border-surface-border-dark"
                      >
                        <td className="px-5 py-3">
                          <p className="font-medium text-content dark:text-content-dark">
                            {profile.full_name ?? '—'}
                            {isSelf && (
                              <span className="ml-2 text-xs font-normal text-content-muted dark:text-content-muted-dark">
                                (you)
                              </span>
                            )}
                          </p>
                          <p className="text-xs text-content-muted dark:text-content-muted-dark">
                            {profile.email ?? 'No email recorded'}
                          </p>
                        </td>
                        <td className="px-5 py-3">
                          {profile.is_platform_admin ? (
                            <Badge tone="danger">Platform administrator</Badge>
                          ) : (
                            <span className="text-content-muted dark:text-content-muted-dark">
                              Standard
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-content-muted dark:text-content-muted-dark">
                          {new Date(profile.created_at).toLocaleDateString('en-GB')}
                        </td>
                        <td className="px-5 py-3 text-right">
                          <Button
                            variant="secondary"
                            disabled={busyId === profile.id || wouldStrandPlatform}
                            title={
                              wouldStrandPlatform
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Card>

          {visible.length === 0 && (
            <AdminEmpty message="No account matches that search." />
          )}
        </div>
      )}
    </AdminPage>
  );
}
