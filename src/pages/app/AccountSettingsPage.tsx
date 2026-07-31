import { useCallback, useEffect, useState, type ChangeEvent } from 'react';
import { Bell, Lock, User } from 'lucide-react';
import { supabase } from '@/lib/supabase';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { getProfile, updateProfile } from '@/services/profileService';
import { getSettings, updateSettings } from '@/services/settingsService';
import { evaluatePassword } from '@/lib/password';
import { PasswordRequirements } from '@/components/auth/PasswordRequirements';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import type { AppSettings, Profile } from '@/types';

/**
 * `/app/account` — the current user's own profile, password, and
 * notification preference. Distinct from `/app/settings` (org-level,
 * owner-only) — this is personal, every signed-in user has one regardless
 * of role. The notification toggle moves here from `DashboardPage.tsx`,
 * where it never belonged per `docs/SCREENS.md`.
 *
 * Deliberately out of scope: email change (needs Supabase's confirmation
 * round-trip on both the old and new address) and avatar upload (needs
 * ImageKit, not wired anywhere in this repo yet) — both flagged rather than
 * half-built.
 */
export function AccountSettingsPage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const { showError, showSuccess } = useToast();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [fullName, setFullName] = useState('');
  const [savingProfile, setSavingProfile] = useState(false);

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [savingPassword, setSavingPassword] = useState(false);

  const [savingNotifications, setSavingNotifications] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const [p, s] = await Promise.all([getProfile(user.id), getSettings(user.id)]);
        if (!active) return;
        setProfile(p);
        setFullName(p?.full_name ?? '');
        setSettings(s);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'account:load' });
        setLoadFailed(true);
        showError('Could not load your account.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user, reloadKey, showError]);

  const handleSaveProfile = useCallback(async (): Promise<void> => {
    if (!user || !fullName.trim()) return;
    setSavingProfile(true);
    try {
      const updated = await updateProfile(user.id, { full_name: fullName.trim() });
      setProfile(updated);
      showSuccess('Profile updated.');
    } catch (err) {
      reportError(err, { area: 'account:save-profile' });
      showError('Could not update your profile. Please try again.');
    } finally {
      setSavingProfile(false);
    }
  }, [user, fullName, showError, showSuccess]);

  const passwordRequirements = evaluatePassword(newPassword);
  const passwordValid = passwordRequirements.every((r) => r.met);

  const handleChangePassword = useCallback(async (): Promise<void> => {
    if (!passwordValid || newPassword !== confirmPassword) return;
    setSavingPassword(true);
    try {
      const { error } = await supabase.auth.updateUser({ password: newPassword });
      if (error) throw error;
      setNewPassword('');
      setConfirmPassword('');
      showSuccess('Password changed.');
    } catch (err) {
      reportError(err, { area: 'account:change-password' });
      showError('Could not change your password. Please try again.');
    } finally {
      setSavingPassword(false);
    }
  }, [passwordValid, newPassword, confirmPassword, showError, showSuccess]);

  const handleToggleNotifications = useCallback(async (): Promise<void> => {
    if (!user || !settings) return;
    const next = !settings.notifications_enabled;
    setSettings({ ...settings, notifications_enabled: next });
    setSavingNotifications(true);
    try {
      await updateSettings(user.id, { notifications_enabled: next });
    } catch (err) {
      setSettings({ ...settings, notifications_enabled: !next });
      reportError(err, { area: 'account:toggle-notifications' });
      showError('Could not update your notification preference.');
    } finally {
      setSavingNotifications(false);
    }
  }, [user, settings, showError]);

  if (loading) {
    return (
      <Card>
        <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
      </Card>
    );
  }

  if (loadFailed) {
    return (
      <Card>
        <p className="mb-4 text-content-muted dark:text-content-muted-dark">
          Could not load your account.
        </p>
        <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </Card>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <h1 className="flex items-center gap-2 font-display text-2xl text-content dark:text-content-dark">
        <User size={22} aria-hidden="true" />
        Account
      </h1>

      <Card>
        <h2 className="mb-4 font-medium text-content dark:text-content-dark">Profile</h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor="account-name">Full name</Label>
            <Input
              id="account-name"
              value={fullName}
              onChange={(e: ChangeEvent<HTMLInputElement>) => setFullName(e.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="account-email">Email</Label>
            <Input
              id="account-email"
              value={profile?.email ?? user?.email ?? ''}
              disabled
              readOnly
            />
          </div>
          <Button
            size="sm"
            onClick={() => void handleSaveProfile()}
            disabled={savingProfile || !fullName.trim()}
          >
            {savingProfile ? 'Saving…' : 'Save profile'}
          </Button>
        </div>
      </Card>

      <Card>
        <h2 className="mb-4 flex items-center gap-2 font-medium text-content dark:text-content-dark">
          <Lock size={16} aria-hidden="true" />
          Password
        </h2>
        <div className="space-y-4">
          <div>
            <Label htmlFor="account-new-password">New password</Label>
            <Input
              id="account-new-password"
              type="password"
              autoComplete="new-password"
              value={newPassword}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setNewPassword(e.target.value)
              }
            />
          </div>
          {newPassword && <PasswordRequirements requirements={passwordRequirements} />}
          <div>
            <Label htmlFor="account-confirm-password">Confirm new password</Label>
            <Input
              id="account-confirm-password"
              type="password"
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e: ChangeEvent<HTMLInputElement>) =>
                setConfirmPassword(e.target.value)
              }
            />
          </div>
          {confirmPassword && newPassword !== confirmPassword && (
            <p className="text-sm text-danger" role="alert">
              Those passwords do not match.
            </p>
          )}
          <Button
            size="sm"
            onClick={() => void handleChangePassword()}
            disabled={savingPassword || !passwordValid || newPassword !== confirmPassword}
          >
            {savingPassword ? 'Changing…' : 'Change password'}
          </Button>
        </div>
      </Card>

      <Card className="flex items-center justify-between gap-4">
        <div>
          <h2 className="flex items-center gap-2 font-medium text-content dark:text-content-dark">
            <Bell size={16} aria-hidden="true" />
            Notifications
          </h2>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            {settings?.notifications_enabled ? 'Enabled' : 'Disabled'} — push and email
            notifications for things like leave approvals and announcements.
          </p>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => void handleToggleNotifications()}
          disabled={savingNotifications}
        >
          {settings?.notifications_enabled ? 'Turn off' : 'Turn on'}
        </Button>
      </Card>
    </div>
  );
}
