import { useCallback, useEffect, useState, type ChangeEvent, type JSX } from 'react';
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
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import { rememberPersonalPreferences } from '@/hooks/usePersonalPreferences';
import {
  DEFAULT_PREFERENCES,
  toPersonalPreferences,
  type PersonalPreferences,
} from '@/lib/personalPreferences';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { useConsent } from '@/context/ConsentContext';

/**
 * `/app/account/preferences`. Design/profileprefrence.png.
 *
 * Everything here is a real stored preference: `app_settings.theme` and
 * `app_settings.notifications_enabled` per user, plus the browser's own push
 * subscription, which is device-scoped rather than account-scoped and so is
 * managed separately from the master switch. 0163 added the clock format,
 * the first day of the person's own week and an email summary frequency. The
 * summary is stored and labelled as not sent yet: no digest job exists.
 *
 * The reference also shows a language selector. It is not built: there is no
 * i18n layer in the app, every string is an English literal in a component,
 * and a dropdown that stores "Français" and changes nothing is a promise the
 * product cannot keep.
 */
export function PreferencesPage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const { theme, setTheme } = useTheme();
  const { allows, record, reopen } = useConsent();
  const { showError, showSuccess } = useToast();
  const push = useWebPush();

  const [notificationsEnabled, setNotificationsEnabled] = useState(true);
  const [personal, setPersonal] = useState<PersonalPreferences>(DEFAULT_PREFERENCES);
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
        setPersonal(toPersonalPreferences(settings));
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

  const handlePersonal = useCallback(
    async (patch: Partial<PersonalPreferences>): Promise<void> => {
      if (!user) return;
      const previous = personal;
      const next = { ...personal, ...patch };
      setPersonal(next);
      setSaving(true);
      try {
        await updateSettings(user.id, {
          time_format: next.timeFormat,
          week_start: next.weekStart,
          digest_frequency: next.digestFrequency,
        });
        rememberPersonalPreferences(user.id, next);
        showSuccess('Preference saved.');
      } catch (err) {
        setPersonal(previous);
        reportError(err, { area: 'account-preferences:personal' });
        showError('Could not save that preference.');
      } finally {
        setSaving(false);
      }
    },
    [user, personal, showError, showSuccess],
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
        description={
          allows('preferences')
            ? 'Remembered on this device.'
            : 'Applied now, but not remembered: you declined preference storage.'
        }
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
        title="Time and week"
        description="How times and your own week are shown to you. Rota weeks stay Monday to Sunday for everyone."
      >
        <div className="grid gap-5 sm:grid-cols-2">
          <div>
            <Label htmlFor="pref-time-format">Clock</Label>
            <Select
              id="pref-time-format"
              value={personal.timeFormat}
              disabled={saving}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                void handlePersonal({
                  timeFormat: event.target.value === '12h' ? '12h' : '24h',
                })
              }
            >
              <option value="24h">24-hour (14:30)</option>
              <option value="12h">12-hour (2:30 pm)</option>
            </Select>
          </div>
          <div>
            <Label htmlFor="pref-week-start">My week starts on</Label>
            <Select
              id="pref-week-start"
              value={personal.weekStart}
              disabled={saving}
              onChange={(event: ChangeEvent<HTMLSelectElement>) =>
                void handlePersonal({
                  weekStart: event.target.value === 'sunday' ? 'sunday' : 'monday',
                })
              }
            >
              <option value="monday">Monday</option>
              <option value="sunday">Sunday</option>
            </Select>
          </div>
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
        <div className="mt-5 max-w-xs">
          <Label htmlFor="pref-digest">Email summary</Label>
          <Select
            id="pref-digest"
            value={personal.digestFrequency}
            disabled={saving || !notificationsEnabled}
            onChange={(event: ChangeEvent<HTMLSelectElement>) => {
              const value = event.target.value;
              void handlePersonal({
                digestFrequency:
                  value === 'daily' || value === 'weekly' ? value : 'immediate',
              });
            }}
          >
            <option value="immediate">Each notification as it happens</option>
            <option value="daily">Daily summary</option>
            <option value="weekly">Weekly summary</option>
          </Select>
          {personal.digestFrequency !== 'immediate' && (
            <p className="mt-2 text-sm text-content-muted dark:text-content-muted-dark">
              Saved. Summaries are not sent yet, so you will keep receiving each
              notification as it happens until they are.
            </p>
          )}
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

      {/* The reopen route that is not in the marketing footer. Somebody signed
          in and working a shift has no reason to visit /legal/cookies to
          change their mind, and consent that can only be withdrawn somewhere
          you would not think to look is not really withdrawable. */}
      <SettingsSection
        title="Privacy on this device"
        description="What this browser is allowed to keep, and what it may send."
      >
        <div className="flex flex-wrap items-center justify-between gap-4">
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            {record === null
              ? 'You have not answered yet, so nothing optional is stored or sent.'
              : `Interface preferences are ${
                  record.preferences ? 'remembered' : 'not remembered'
                } and crash reports are ${record.diagnostics ? 'sent' : 'not sent'}. Signing in and working offline need storage that cannot be switched off.`}
          </p>
          <Button variant="secondary" onClick={reopen}>
            Change what is kept
          </Button>
        </div>
      </SettingsSection>
    </div>
  );
}
