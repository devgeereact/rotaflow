import { useCallback, useEffect, useState } from 'react';
import { Moon, Sun } from 'lucide-react';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useTheme } from '@/context/ThemeContext';
import { useToast } from '@/hooks/useToast';
import { useWebPush } from '@/hooks/useWebPush';
import { getSettings, updateSettings } from '@/services/settingsService';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Toggle';
import { SettingsSection } from '@/components/settings/SettingsSection';

/**
 * `/app/account/preferences`. Design/profileprefrence.png.
 *
 * Everything here is a real stored preference: `app_settings.theme` and
 * `app_settings.notifications_enabled` per user, plus the browser's own push
 * subscription, which is device-scoped rather than account-scoped and so is
 * managed separately from the master switch.
 *
 * The reference also shows a language selector. It is not built: there is no
 * i18n layer in the app, every string is an English literal in a component,
 * and a dropdown that stores "Français" and changes nothing is a promise the
 * product cannot keep.
 */
export function PreferencesPage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const { theme, setTheme } = useTheme();
  const { showError, showSuccess } = useToast();
  const push = useWebPush();

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const settings = await getSettings(user.id);
        if (!active) return;
        setNotificationsEnabled(settings?.notifications_enabled ?? true);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'account-preferences:load' });
        showError('Could not load your preferences.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [user, showError]);

  const handleToggleNotifications = useCallback(
    async (next: boolean): Promise<void> => {
      if (!user) return;
      // Optimistic: a switch that waits on a round trip before moving feels
      // broken. Reverted below if the write fails.
      setNotificationsEnabled(next);
      setSaving(true);
      try {
        await updateSettings(user.id, { notifications_enabled: next });
      } catch (err) {
        setNotificationsEnabled(!next);
        reportError(err, { area: 'account-preferences:toggle-notifications' });
        showError('Could not update your notification preference.');
      } finally {
        setSaving(false);
      }
    },
    [user, showError],
  );

  const handleTheme = useCallback(
    (next: 'light' | 'dark'): void => {
      setTheme(next);
      showSuccess(`Switched to ${next} theme.`);
    },
    [setTheme, showSuccess],
  );

  if (loading) {
    return (
      <Card>
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Loading…
        </p>
      </Card>
    );
  }

  return (
    <div className="max-w-3xl space-y-6">
      <SettingsSection
        title="Appearance"
        description="RotaFlow remembers this on every device you sign in on."
      >
        <div className="flex flex-wrap gap-3">
          <Button
            variant={theme === 'light' ? 'primary' : 'secondary'}
            onClick={() => handleTheme('light')}
            aria-pressed={theme === 'light'}
          >
            <Sun size={16} aria-hidden="true" />
            Light
          </Button>
          <Button
            variant={theme === 'dark' ? 'primary' : 'secondary'}
            onClick={() => handleTheme('dark')}
            aria-pressed={theme === 'dark'}
          >
            <Moon size={16} aria-hidden="true" />
            Dark
          </Button>
        </div>
      </SettingsSection>

      <SettingsSection
        title="Notifications"
        description="Your personal override of the organisation's defaults."
      >
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-medium text-content dark:text-content-dark">
              Send me notifications
            </p>
            <p className="mt-1 text-sm text-content-muted dark:text-content-muted-dark">
              {notificationsEnabled
                ? 'You will be notified about rota changes, leave decisions, swaps and announcements.'
                : 'You will not receive any notifications. You can still see everything in the app.'}
            </p>
          </div>
          <Toggle
            label="Send me notifications"
            checked={notificationsEnabled}
            disabled={saving}
            onChange={(next) => void handleToggleNotifications(next)}
          />
        </div>
      </SettingsSection>

      <SettingsSection
        title="Push on this device"
        description="Push is granted per browser, so this covers the device you are using right now."
      >
        {push.status === 'unsupported' ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            This browser does not support push notifications.
          </p>
        ) : push.status === 'denied' ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Notifications are blocked for RotaFlow in this browser&rsquo;s settings.
            Unblock them there and reload this page.
          </p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-4">
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              {push.status === 'granted'
                ? 'This device is allowed to receive push notifications.'
                : 'This device has not been set up for push notifications yet.'}
            </p>
            <Button
              variant={push.status === 'granted' ? 'secondary' : 'primary'}
              disabled={push.subscribing || !user}
              onClick={() => {
                if (!user) return;
                void (push.status === 'granted'
                  ? push.unsubscribe()
                  : push.subscribe(user.id));
              }}
            >
              {push.subscribing
                ? 'Working…'
                : push.status === 'granted'
                  ? 'Turn off on this device'
                  : 'Turn on for this device'}
            </Button>
          </div>
        )}
      </SettingsSection>
    </div>
  );
}
