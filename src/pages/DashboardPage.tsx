import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useInngestDispatch } from '@/hooks/useInngestDispatch';
import { getSettings, updateSettings } from '@/services/settingsService';
import { getProfile } from '@/services/profileService';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import type { AppSettings, Profile } from '@/types';

export function DashboardPage(): JSX.Element {
  const { user, signOut } = useSupabaseAuth();
  const { send } = useInngestDispatch();

  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    if (!user) return;
    try {
      const [p, s] = await Promise.all([getProfile(user.id), getSettings(user.id)]);
      setProfile(p);
      setSettings(s);
    } catch (error) {
      reportError(error, { area: 'dashboard:load' });
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void load();
  }, [load]);

  const toggleNotifications = useCallback(async (): Promise<void> => {
    if (!user || !settings) return;
    const next = !settings.notifications_enabled;
    setSettings({ ...settings, notifications_enabled: next }); // optimistic
    try {
      await updateSettings(user.id, { notifications_enabled: next });
      // Fire a background event (fire-and-forget).
      void send('settings/updated', { userId: user.id, notifications_enabled: next });
    } catch (error) {
      setSettings({ ...settings, notifications_enabled: !next }); // rollback
      reportError(error, { area: 'dashboard:toggle' });
    }
  }, [user, settings, send]);

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="font-display text-3xl text-content dark:text-content-dark">Dashboard</h1>
        <Button variant="ghost" size="sm" onClick={() => void signOut()}>
          Sign out
        </Button>
      </div>

      {loading ? (
        <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
      ) : (
        <div className="space-y-6">
          <Card>
            <h2 className="mb-2 text-lg font-semibold text-content dark:text-content-dark">Profile</h2>
            <p className="text-content-muted dark:text-content-muted-dark">
              {profile?.full_name ?? 'No name set'} · {profile?.email ?? user?.email}
            </p>
          </Card>

          <Card className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-content dark:text-content-dark">Notifications</h2>
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                {settings?.notifications_enabled ? 'Enabled' : 'Disabled'}
              </p>
            </div>
            <Button size="sm" onClick={() => void toggleNotifications()}>
              {settings?.notifications_enabled ? 'Turn off' : 'Turn on'}
            </Button>
          </Card>

          <Card className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-content dark:text-content-dark">AI rota assistant</h2>
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                Draft shifts from a plain-English staffing request.
              </p>
            </div>
            <Link to="/dashboard/ai-assistant">
              <Button size="sm" variant="secondary">
                Open
              </Button>
            </Link>
          </Card>
        </div>
      )}
    </main>
  );
}
