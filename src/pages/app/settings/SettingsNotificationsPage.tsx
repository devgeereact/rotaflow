import { useCallback, useEffect, useState } from 'react';
import { Info, MessageSquare } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import { getOrganisation, mergeOrgSettings } from '@/services/orgService';
import {
  NOTIFICATION_CHANNELS,
  NOTIFICATION_EVENTS,
  defaultNotificationMatrix,
  notificationMatrix,
  type NotificationMatrix,
} from '@/lib/orgPreferences';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Toggle } from '@/components/ui/Toggle';
import { SettingsSection } from '@/components/settings/SettingsSection';

/**
 * `/app/settings/notifications` — design/SettingsNotifications.png.
 *
 * Organisation-wide defaults for which events notify staff, on which channel.
 * Individuals override these under My Profile → Preferences.
 *
 * ## What is deliberately missing, and why
 *
 * The reference shows an **SMS column** and a library of **28 editable
 * templates** with per-template delivery analytics. Neither ships:
 *
 * - **SMS** — there is no SMS provider anywhere in the stack, no table
 *   recording a send, and no Edge Function that could place one. A toggle that
 *   an owner can switch on and that then sends nothing is actively harmful:
 *   they would believe their staff had been texted about a rota change.
 * - **Templates and delivery analytics** — both need tables that do not exist
 *   (`notification_templates`, plus per-send delivery tracking). The
 *   notification path itself was only proven end to end at the infrastructure
 *   level; the application leg is still unverified (audit §P0-3).
 *
 * The three channels here are the three the product can actually deliver on:
 * an in-app `notifications` row, email via the org's SMTP settings, and web
 * push via the VAPID pair that has been verified as a genuine keypair.
 */
export function SettingsNotificationsPage(): JSX.Element {
  const { orgId, role, refresh } = useOrg();
  const { showError, showSuccess } = useToast();

  const [matrix, setMatrix] = useState<NotificationMatrix>(defaultNotificationMatrix);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const canEdit = role === 'owner' || role === 'manager';

  useEffect(() => {
    if (!orgId) return;
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const org = await getOrganisation(orgId);
        if (!active) return;
        setMatrix(notificationMatrix(org.settings));
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'settings-notifications:load' });
        showError('Could not load notification settings.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, showError]);

  const handleSave = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    setSaving(true);
    try {
      await mergeOrgSettings(orgId, { notification_defaults: matrix });
      await refresh();
      showSuccess('Notification defaults saved.');
    } catch (err) {
      reportError(err, { area: 'settings-notifications:save' });
      showError('Could not save notification defaults. Please try again.');
    } finally {
      setSaving(false);
    }
  }, [orgId, matrix, refresh, showError, showSuccess]);

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
    <div className="space-y-6">
      <SettingsSection
        title="Notification defaults"
        description="What your organisation notifies staff about, and how. Individuals can override these in their own preferences."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[34rem] text-sm">
            <thead>
              <tr className="border-b border-surface-border text-left dark:border-surface-border-dark">
                <th className="pb-3 font-medium text-content-muted dark:text-content-muted-dark">
                  Event
                </th>
                {NOTIFICATION_CHANNELS.map((channel) => (
                  <th
                    key={channel.key}
                    className="pb-3 text-center font-medium text-content-muted dark:text-content-muted-dark"
                  >
                    {channel.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {NOTIFICATION_EVENTS.map((event) => (
                <tr
                  key={event.key}
                  className="border-b border-divider last:border-0 dark:border-divider-dark"
                >
                  <td className="py-4 pr-6">
                    <p className="font-medium text-content dark:text-content-dark">
                      {event.label}
                    </p>
                    <p className="mt-0.5 text-xs text-content-muted dark:text-content-muted-dark">
                      {event.hint}
                    </p>
                  </td>
                  {NOTIFICATION_CHANNELS.map((channel) => (
                    <td key={channel.key} className="py-4 text-center">
                      <Toggle
                        label={`${channel.label} for ${event.label}`}
                        checked={matrix[event.key][channel.key]}
                        disabled={!canEdit}
                        onChange={(next) =>
                          setMatrix((prev) => ({
                            ...prev,
                            [event.key]: { ...prev[event.key], [channel.key]: next },
                          }))
                        }
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="mt-6 flex justify-end">
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving ? 'Saving…' : 'Save defaults'}
            </Button>
          </div>
        )}
      </SettingsSection>

      <SettingsSection
        title="Delivery"
        description="Where email notifications are sent from."
        action={
          <Link
            to="/app/settings/integrations"
            className="text-sm font-semibold text-primary hover:underline"
          >
            Configure SMTP
          </Link>
        }
      >
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          Email notifications use your organisation&rsquo;s SMTP settings. Push
          notifications are delivered to staff who have enabled them on their device.
        </p>
      </SettingsSection>

      <Card className="bg-info/5">
        <div className="flex gap-3">
          <MessageSquare
            size={18}
            className="mt-0.5 shrink-0 text-info"
            aria-hidden="true"
          />
          <div className="text-sm text-content-muted dark:text-content-muted-dark">
            <p className="font-medium text-content dark:text-content-dark">
              SMS is not available
            </p>
            <p className="mt-1">
              RotaFlow does not send SMS yet — there is no SMS provider connected. The
              channel is left out rather than shown switched off, so nobody enables it
              expecting texts to arrive.
            </p>
          </div>
        </div>
      </Card>

      <Card className="bg-info/5">
        <div className="flex gap-3">
          <Info size={18} className="mt-0.5 shrink-0 text-info" aria-hidden="true" />
          <div className="text-sm text-content-muted dark:text-content-muted-dark">
            <p className="font-medium text-content dark:text-content-dark">
              Editable templates are planned
            </p>
            <p className="mt-1">
              Notification wording is currently fixed per event. Custom templates and
              per-message delivery reporting need their own tables and are tracked
              separately.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
