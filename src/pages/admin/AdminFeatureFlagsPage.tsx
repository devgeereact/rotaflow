import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Card, Panel } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import { getPlatformSettings } from '@/services/platformSettingsService';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Toggle } from '@/components/ui/Toggle';
import { useToast } from '@/hooks/useToast';
import { usePermissions } from '@/hooks/usePermissions';
import {
  countFlagTargets,
  latestFlagChanges,
  listFeatureFlags,
  setFeatureFlag,
  type FeatureFlag,
  type FeatureFlagChange,
} from '@/services/featureFlagService';
import { env } from '@/lib/env';
import type { PlatformSettings } from '@/types';

interface Capability {
  name: string;
  /** The env var that decides it — a flag's real identifier. */
  key: string;
  enabled: boolean;
  detail: string;
}

/**
 * `/admin/feature-flags` — what is switched on, and what can be.
 *
 * ## The two real switches
 *
 * `platform_settings` is a single-row table holding, among the identity fields,
 * `registration_enabled` and `maintenance_mode`. Those are genuine feature
 * flags: persisted, platform-wide, and read by the app at runtime. They were
 * missing from this screen entirely, which is how a feature-flag page ended up
 * claiming nothing could be toggled while two toggles sat one table away.
 *
 * They are shown here and changed in Platform Settings. One field, one write
 * path: `maintenance_mode` and `maintenance_message` are meaningless apart —
 * turning the platform off without saying why is not a state worth offering —
 * so the pair is edited together where the message lives, and this screen
 * reports and links rather than growing a second writer.
 *
 * ## Why per-tenant flags still are not here
 *
 * Turning a feature on for one organisation and not another needs a
 * `feature_flags` table and a service to read it. Neither exists in any
 * migration, so there is no rollout percentage, no targeting and no schedule —
 * a toggle that persisted nowhere would be worse than none.
 *
 * ## What moved out
 *
 * This page used to list every configured service — Sentry, ImageKit, Inngest.
 * That is `/admin/integrations`, which now covers external wiring properly and
 * alongside the tenants' own. What stays here is narrower and answers a
 * different question: which *product features* are available to users, rather
 * than which services this deployment talks to.
 */
export function AdminFeatureFlagsPage(): JSX.Element {
  const { canManagePlatformConfig } = usePermissions();
  const { showError, showSuccess } = useToast();

  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [flags, setFlags] = useState<FeatureFlag[]>([]);
  const [targets, setTargets] = useState<Map<string, number>>(new Map());
  const [lastChanges, setLastChanges] = useState<Map<string, FeatureFlagChange>>(
    new Map(),
  );
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setLoaded(false);
    void (async () => {
      try {
        const [row, flagRows, targetCounts, changes] = await Promise.all([
          getPlatformSettings(),
          listFeatureFlags(),
          countFlagTargets(),
          latestFlagChanges(),
        ]);
        if (!active) return;
        setSettings(row);
        setFlags(flagRows);
        setTargets(targetCounts);
        setLastChanges(changes);
        setLoaded(true);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:feature-flags' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  /**
   * Flip a flag.
   *
   * Optimistic on purpose: a rollout switch that waits a round trip before
   * moving reads as broken, and the reload afterwards is what makes the card
   * agree with the database even if the write was refused.
   */
  const toggleFlag = useCallback(
    async (flag: FeatureFlag, enabled: boolean) => {
      setBusyKey(flag.key);
      setFlags((current) =>
        current.map((f) => (f.key === flag.key ? { ...f, enabled } : f)),
      );
      try {
        await setFeatureFlag(flag.key, { enabled });
        showSuccess(`${flag.name} ${enabled ? 'enabled' : 'disabled'}.`);
      } catch (err) {
        reportError(err, { area: 'admin:feature-flags:toggle' });
        showError(err instanceof Error ? err.message : 'Could not change that flag.');
      } finally {
        setBusyKey(null);
        retry();
      }
    },
    [retry, showError, showSuccess],
  );

  const changeRollout = useCallback(
    async (flag: FeatureFlag, rollout: number) => {
      setBusyKey(flag.key);
      try {
        await setFeatureFlag(flag.key, { rollout });
        showSuccess(`${flag.name} rolled out to ${rollout}%.`);
      } catch (err) {
        reportError(err, { area: 'admin:feature-flags:rollout' });
        showError(err instanceof Error ? err.message : 'Could not change that rollout.');
      } finally {
        setBusyKey(null);
        retry();
      }
    },
    [retry, showError, showSuccess],
  );

  // Product features, not service wiring — the services live on Integrations.
  const capabilities: Capability[] = [
    {
      name: 'Single sign-on',
      key: 'VITE_OAUTH_PROVIDERS',
      enabled: env.oauthProviders.length > 0,
      detail:
        env.oauthProviders.length > 0
          ? `Staff may sign in with: ${env.oauthProviders.join(', ')}`
          : 'No OAuth providers declared, so sign-in is email and password only',
    },
    {
      name: 'Web push notifications',
      key: 'VITE_VAPID_PUBLIC_KEY',
      enabled: Boolean(env.vapidPublicKey),
      detail: env.vapidPublicKey
        ? 'Staff can opt in to push on their device'
        : 'No VAPID key — push subscriptions cannot be created, so notifications stay in-app and by email',
    },
  ];

  return (
    <AdminPage
      title="Feature flags"
      description="Ship behind a flag, roll out by percentage, and turn it off without a deploy. Flags marked critical change live tenant behaviour and require re-authentication."
      action={
        <Button
          disabled
          title="Flags are declared in migration 0022, because code checks the key by name"
        >
          Create flag
        </Button>
      }
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !loaded ? (
        <AdminLoading variant="tiles" rows={3} />
      ) : (
        <div className="space-y-4">
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fit,minmax(19rem,1fr))]">
            {flags.map((flag) => {
              const change = lastChanges.get(flag.key);
              const targeted = targets.get(flag.key) ?? 0;
              return (
                <Card key={flag.key} className="flex flex-col gap-3 p-4">
                  <div className="flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-card-heading font-semibold text-content dark:text-content-dark">
                        {flag.name}
                      </h3>
                      <p className="mt-0.5 font-mono text-xs text-content-muted dark:text-content-muted-dark">
                        {flag.key}
                      </p>
                    </div>
                    <Toggle
                      checked={flag.enabled}
                      disabled={!canManagePlatformConfig || busyKey === flag.key}
                      label={`${flag.name} enabled`}
                      onChange={(checked) => void toggleFlag(flag, checked)}
                    />
                  </div>

                  <p className="text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
                    {flag.description}
                  </p>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={flag.enabled ? 'success' : 'neutral'} dot>
                      {flag.enabled ? 'Active' : 'Off'}
                    </Badge>
                    <Badge tone="neutral">{flag.environment}</Badge>
                    {flag.critical && (
                      <Badge tone="danger" dot>
                        Critical
                      </Badge>
                    )}
                  </div>

                  {/* A range input, not a slider component: it is the one
                      control here that has to land on an exact integer, and
                      the native one does that with a keyboard too. */}
                  <div className="flex items-center gap-2.5">
                    <label
                      htmlFor={`rollout-${flag.key}`}
                      className="text-sm text-content-muted dark:text-content-muted-dark"
                    >
                      Rollout
                    </label>
                    <input
                      id={`rollout-${flag.key}`}
                      type="range"
                      min={0}
                      max={100}
                      step={1}
                      defaultValue={flag.rollout}
                      disabled={!canManagePlatformConfig || busyKey === flag.key}
                      // On release, not on every pixel: `onChange` would write
                      // once per step and fill the history with noise.
                      onMouseUp={(e) =>
                        void changeRollout(flag, Number(e.currentTarget.value))
                      }
                      onKeyUp={(e) =>
                        void changeRollout(flag, Number(e.currentTarget.value))
                      }
                      className="h-2 flex-1 accent-primary"
                    />
                    <span className="w-10 text-right font-mono text-xs tabular-nums text-content dark:text-content-dark">
                      {flag.rollout}%
                    </span>
                  </div>

                  <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs">
                    <dt className="text-content-muted dark:text-content-muted-dark">
                      Targets
                    </dt>
                    <dd className="font-semibold text-content dark:text-content-dark">
                      {flag.target_plans.length > 0
                        ? flag.target_plans.join(', ')
                        : 'No plan targeted'}
                      {targeted > 0 &&
                        ` · ${targeted} organisation${targeted === 1 ? '' : 's'}`}
                    </dd>
                    <dt className="text-content-muted dark:text-content-muted-dark">
                      Updated
                    </dt>
                    <dd className="font-semibold text-content dark:text-content-dark">
                      {change
                        ? `${new Date(change.created_at).toLocaleDateString('en-GB')} · ${
                            change.actor_name ?? 'System'
                          }`
                        : 'Never changed'}
                    </dd>
                    {change?.before_value !== undefined &&
                      change?.before_value !== null && (
                        <>
                          <dt className="text-content-muted dark:text-content-muted-dark">
                            Last change
                          </dt>
                          <dd className="font-semibold text-content dark:text-content-dark">
                            {change.field}: {change.before_value} → {change.after_value}
                          </dd>
                        </>
                      )}
                  </dl>
                </Card>
              );
            })}
          </div>

          <Panel
            title="Platform switches"
            actions={
              <Link
                to="/admin/settings"
                className="text-xs font-medium text-primary hover:underline"
              >
                Change in settings
              </Link>
            }
            flush
          >
            {settings === null ? (
              <p className="px-4 py-10 text-center text-sm text-content-muted dark:text-content-muted-dark">
                No platform settings row exists yet, so both switches are at their
                database defaults.
              </p>
            ) : (
              <ul>
                <li className="flex flex-wrap items-center gap-3 border-b border-divider px-4 py-3 dark:border-divider-dark">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-content dark:text-content-dark">
                      Self-service registration
                    </p>
                    <p className="text-sm text-content-muted dark:text-content-muted-dark">
                      When closed, the sign-up route refuses new organisations. Existing
                      customers are unaffected.
                    </p>
                  </div>
                  <Badge tone={settings.registration_enabled ? 'success' : 'neutral'} dot>
                    {settings.registration_enabled ? 'Open' : 'Closed'}
                  </Badge>
                </li>
                <li className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-content dark:text-content-dark">
                      Maintenance mode
                    </p>
                    <p className="text-sm text-content-muted dark:text-content-muted-dark">
                      {settings.maintenance_message
                        ? `Message: “${settings.maintenance_message}”`
                        : 'No message set — turning this on with nothing to say leaves customers guessing.'}
                    </p>
                  </div>
                  <Badge tone={settings.maintenance_mode ? 'warning' : 'success'} dot>
                    {settings.maintenance_mode ? 'On' : 'Off'}
                  </Badge>
                </li>
              </ul>
            )}
            <p className="border-t border-divider px-4 py-2.5 text-xs text-content-muted dark:border-divider-dark dark:text-content-muted-dark">
              Read-only here on purpose. Maintenance mode and its message are only
              meaningful together, so the pair is edited in one place rather than through
              two writers that can disagree.
            </p>
          </Panel>

          <Panel title="Product features — real" flush>
            <ul>
              {capabilities.map((capability) => (
                <li
                  key={capability.key}
                  className="flex flex-wrap items-center gap-3 border-b border-divider px-4 py-3 last:border-0 dark:border-divider-dark"
                >
                  <div className="min-w-0 flex-1">
                    <p className="font-medium text-content dark:text-content-dark">
                      {capability.name}{' '}
                      <span className="font-mono text-xs text-content-muted dark:text-content-muted-dark">
                        {capability.key}
                      </span>
                    </p>
                    <p className="text-sm text-content-muted dark:text-content-muted-dark">
                      {capability.detail}
                    </p>
                  </div>
                  <Badge tone={capability.enabled ? 'success' : 'neutral'} dot>
                    {capability.enabled ? 'Available' : 'Off'}
                  </Badge>
                  <Badge tone="neutral">{env.mode}</Badge>
                  <Badge tone="neutral">Build-time</Badge>
                </li>
              ))}
            </ul>
            <p className="border-t border-divider px-4 py-2.5 text-xs text-content-muted dark:border-divider-dark dark:text-content-muted-dark">
              Set by build configuration, so changing one is a deploy rather than a
              toggle. The services behind them are listed on{' '}
              <Link to="/admin/integrations" className="text-primary hover:underline">
                Integrations
              </Link>
              .
            </p>
          </Panel>

          <Callout
            tone="info"
            title="A flag is created in a migration, not on this screen"
          >
            <p>
              Every switch and slider above writes to <code>feature_flags</code> and
              records what changed in <code>feature_flag_changes</code>. What this screen
              cannot do is add a flag: code checks a key by name, so a row created here
              would be a flag nothing consults. New flags land in a migration alongside
              the code that reads them.
            </p>
            <p>
              A rollout below 100% is stable per organisation —{' '}
              <code>flag_enabled_for_org</code> hashes the key with the tenant id, so
              raising a percentage only ever adds organisations and nobody sees a feature
              appear and vanish between page loads.
            </p>
          </Callout>
        </div>
      )}
    </AdminPage>
  );
}
