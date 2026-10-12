import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { PanelTabs } from '@/components/ui/PanelTabs';
import { Panel } from '@/components/ui/Card';
import { Callout } from '@/components/ui/Callout';
import { SettingRow } from '@/components/ui/SettingRow';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import { getPlatformSettings } from '@/services/platformSettingsService';
import {
  grantPlatformRole,
  listPlatformAdmins,
  revokePlatformRole,
} from '@/services/platformRoleService';
import { listAllProfiles } from '@/services/platformService';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { usePermissions } from '@/hooks/usePermissions';
import { useConfirm } from '@/hooks/useConfirm';
import { useToast } from '@/hooks/useToast';
import { reportError } from '@/lib/sentry';
import { env } from '@/lib/env';
import { PLATFORM_ROLE_LABELS, PLATFORM_ROLE_SCOPES } from '@/lib/platformRoles';
import {
  listRetentionPolicies,
  type RetentionPolicy,
} from '@/services/platformFactsService';
import {
  getMyMfaStatus,
  setPlatformMfaRequired,
} from '@/services/platformSettingsService';
import type { PlatformAdmin, PlatformRole, PlatformSettings, Profile } from '@/types';

type Tab = 'authentication' | 'retention' | 'administrators';

/**
 * The tabs that configure something.
 *
 * Branding, Security, Email, Storage and API were here and are gone. Each
 * rendered controls for settings this deployment does not store and could not
 * enforce: a colour compiled into the bundle by Tailwind, an MFA requirement
 * nothing checked, upload limits for a file store that is not wired up.
 * A switch that persists a value nothing reads is worse than an absent tab,
 * because somebody eventually believes it. The columns 0027 added for them
 * stay in the database, so the tabs can come back the day something enforces
 * them.
 *
 * **One has**: `require_mfa` is enforced by `is_platform_admin()` since
 * `0102`, so its control is back — on the Authentication tab, beside the
 * facts, rather than in a Security tab of its own.
 *
 * General and Maintenance went the same way later. Of the 28 columns in
 * `platform_settings`, `require_mfa` is the only one anything outside this
 * console reads. The platform name, support email, URL and default timezone
 * were saved and read back and drove nothing (the interface name is
 * `VITE_APP_NAME`, the support address is `src/lib/marketing.ts`), and
 * `maintenance_mode` and its message are rendered by no screen. The columns
 * and their values stay; the controls return when a consumer exists.
 */
const TABS = [
  { value: 'authentication', label: 'Authentication' },
  { value: 'retention', label: 'Data Retention' },
  { value: 'administrators', label: 'Administrators' },
] as const satisfies readonly { value: Tab; label: string }[];

const ROLES: readonly PlatformRole[] = [
  'platform_owner',
  'platform_admin',
  'platform_support',
  'platform_finance',
];

interface AdminRow {
  grant: PlatformAdmin;
  profile: Profile | undefined;
}

/**
 * `/admin/settings`. Deployment configuration and the administrator roster.
 *
 * ## Which settings are real
 *
 * Only the second-factor switch writes anything, through
 * `set_platform_mfa_required` (0145). The rest of the Authentication tab is
 * **read-only and says so**: password policy,
 * magic links, OAuth providers and session length all belong to Supabase Auth,
 * which this table cannot override. A "require email verification" switch here
 * would persist a boolean nothing consults. The same defect the console
 * already shipped once, where a toggle reported success and changed nothing.
 * So that tab reports the real build-time configuration and names where each
 * setting actually lives.
 */

export function AdminSettingsPage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const { canManagePlatformAdmins } = usePermissions();
  const { confirm } = useConfirm();
  const { showError, showSuccess } = useToast();

  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const [retention, setRetention] = useState<RetentionPolicy[]>([]);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // The open tab lives in the URL so a link can point at one, "the API tab
  // says there is no API" is a thing people send each other, and it was
  // unlinkable while this was component state.
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: Tab = TABS.some((t) => t.value === requested)
    ? (requested as Tab)
    : 'authentication';
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
  const [busyUser, setBusyUser] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setSettings(null);
    setAdmins(null);
    void (async () => {
      try {
        const [row, grants, profiles, retentionRows] = await Promise.all([
          getPlatformSettings(),
          listPlatformAdmins(),
          listAllProfiles(),
          listRetentionPolicies(),
        ]);
        setRetention(retentionRows);
        if (!active) return;
        const byId = new Map(profiles.map((p) => [p.id, p]));
        setSettings(row);
        setAdmins(
          grants
            .filter((g) => g.revoked_at === null)
            .map((grant) => ({ grant, profile: byId.get(grant.user_id) })),
        );
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:settings' });
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
   * The caller's own second-factor state (`0102`).
   *
   * Read server-side rather than from the token in this tab, so what the
   * screen offers matches what the database would allow. Turning the
   * requirement on from a session that has not done MFA is refused there, and
   * a button that fails is worse than one that explains.
   */
  const [mfa, setMfa] = useState<{
    hasVerifiedFactor: boolean;
    sessionIsAal2: boolean;
  } | null>(null);

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const status = await getMyMfaStatus();
        if (active) setMfa(status);
      } catch (err) {
        reportError(err, { area: 'admin:settings:mfa-status' });
        if (active) setMfa(null);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const toggleMfaRequired = useCallback(
    async (required: boolean): Promise<void> => {
      try {
        await setPlatformMfaRequired(required);
        showSuccess(
          required
            ? 'Platform administrators now need a second factor to reach this console.'
            : 'The second-factor requirement is off.',
        );
        setReloadKey((k) => k + 1);
      } catch (err) {
        reportError(err, { area: 'admin:settings:mfa-toggle' });
        showError(
          required
            ? 'Sign in with your second factor first. Requiring it from a session that has not used it would lock you out.'
            : 'Could not change the requirement.',
        );
      }
    },
    [showError, showSuccess],
  );

  const ownerCount = useMemo(
    () => (admins ?? []).filter((a) => a.grant.role === 'platform_owner').length,
    [admins],
  );

  const changeRole = useCallback(
    async (row: AdminRow, role: PlatformRole): Promise<void> => {
      const who = row.profile?.full_name ?? row.profile?.email ?? 'this administrator';
      const ok = await confirm({
        title: `Change ${who} to ${PLATFORM_ROLE_LABELS[role]}?`,
        message: PLATFORM_ROLE_SCOPES[role],
        confirmLabel: 'Change role',
        tone: role === 'platform_owner' ? 'danger' : undefined,
      });
      if (!ok) return;

      setBusyUser(row.grant.user_id);
      try {
        await grantPlatformRole(row.grant.user_id, role);
        setAdmins(
          (prev) =>
            prev?.map((a) =>
              a.grant.user_id === row.grant.user_id
                ? { ...a, grant: { ...a.grant, role } }
                : a,
            ) ?? null,
        );
        showSuccess('Platform role updated.');
      } catch (err) {
        reportError(err, { area: 'admin:settings:grant-role' });
        showError(
          err instanceof Error && err.message ? err.message : 'Could not change that.',
        );
      } finally {
        setBusyUser(null);
      }
    },
    [confirm, showError, showSuccess],
  );

  const revoke = useCallback(
    async (row: AdminRow): Promise<void> => {
      const who = row.profile?.full_name ?? row.profile?.email ?? 'this administrator';
      const ok = await confirm({
        title: `Remove platform access from ${who}?`,
        message:
          'They lose access to the platform console and to every organisation’s data. Their own organisation membership is unchanged.',
        confirmLabel: 'Remove access',
        tone: 'danger',
      });
      if (!ok) return;

      setBusyUser(row.grant.user_id);
      try {
        await revokePlatformRole(row.grant.user_id);
        setAdmins(
          (prev) => prev?.filter((a) => a.grant.user_id !== row.grant.user_id) ?? null,
        );
        showSuccess('Platform access removed.');
      } catch (err) {
        reportError(err, { area: 'admin:settings:revoke-role' });
        showError(
          err instanceof Error && err.message ? err.message : 'Could not remove that.',
        );
      } finally {
        setBusyUser(null);
      }
    },
    [confirm, showError, showSuccess],
  );

  const adminColumns = useMemo<DataTableColumn<AdminRow>[]>(
    () => [
      {
        key: 'person',
        label: 'Administrator',
        width: 'w-[32%]',
        cell: ({ grant, profile }) => (
          <>
            <p className="truncate font-medium text-content dark:text-content-dark">
              {profile?.full_name ?? '-'}
              {grant.user_id === user?.id && (
                <span className="ml-2 text-xs font-normal text-content-muted dark:text-content-muted-dark">
                  (you)
                </span>
              )}
            </p>
            <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
              {profile?.email ?? 'Profile not readable'}
            </p>
          </>
        ),
      },
      {
        key: 'role',
        label: 'Platform role',
        width: 'w-[28%]',
        cell: (row) => {
          // Same guard as the Remove button below, and now also enforced
          // server-side (grant_platform_role raises 23514): picking a
          // non-owner role for the platform's only owner here used to
          // succeed and leave nobody able to grant or revoke a platform
          // role ever again, including this dropdown's own next use.
          const lastOwner = row.grant.role === 'platform_owner' && ownerCount <= 1;
          return canManagePlatformAdmins ? (
            <Select
              value={row.grant.role}
              aria-label={`Platform role for ${row.profile?.email ?? row.grant.user_id}`}
              disabled={busyUser === row.grant.user_id || lastOwner}
              title={
                lastOwner
                  ? 'The platform must always have at least one owner.'
                  : undefined
              }
              onChange={(e) => void changeRole(row, e.target.value as PlatformRole)}
            >
              {ROLES.map((role) => (
                <option key={role} value={role}>
                  {PLATFORM_ROLE_LABELS[role]}
                </option>
              ))}
            </Select>
          ) : (
            <Badge tone="danger">
              {PLATFORM_ROLE_LABELS[row.grant.role as PlatformRole] ?? row.grant.role}
            </Badge>
          );
        },
      },
      {
        key: 'granted',
        label: 'Granted',
        width: 'w-[22%]',
        cell: ({ grant }) => (
          <span className="whitespace-nowrap text-content-muted dark:text-content-muted-dark">
            {new Date(grant.granted_at).toLocaleDateString('en-GB')}
          </span>
        ),
      },
      {
        key: 'actions',
        label: '',
        width: 'w-[18%]',
        align: 'right',
        cell: (row) => {
          // The database refuses this too (`revoke_platform_role` raises
          // 23514). Disabling here explains why before the click rather than
          // surfacing an error after it.
          const lastOwner = row.grant.role === 'platform_owner' && ownerCount <= 1;
          return (
            <Button
              variant="secondary"
              disabled={
                !canManagePlatformAdmins || lastOwner || busyUser === row.grant.user_id
              }
              title={
                lastOwner
                  ? 'This is the last platform owner'
                  : !canManagePlatformAdmins
                    ? 'Only a platform owner can change platform roles'
                    : undefined
              }
              onClick={() => void revoke(row)}
            >
              Remove
            </Button>
          );
        },
      },
    ],
    [user?.id, canManagePlatformAdmins, busyUser, ownerCount, changeRole, revoke],
  );

  if (failed) {
    return (
      <AdminPage
        title="Platform settings"
        description="Configuration for this deployment."
      >
        <AdminError onRetry={retry} />
      </AdminPage>
    );
  }

  if (!settings || !admins) {
    return (
      <AdminPage
        title="Platform settings"
        description="Configuration for this deployment."
      >
        <AdminLoading variant="card" rows={5} />
      </AdminPage>
    );
  }

  return (
    <AdminPage
      title="Platform settings"
      description="Configuration that applies to every tenant. Changes are audited and take effect immediately."
    >
      <div className="space-y-4">
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          More settings appear here when they do something.
        </p>
        <PanelTabs
          items={TABS.map((t) => ({ value: t.value, label: t.label }))}
          active={tab}
          onChange={setTab}
          label="Platform settings sections"
        />

        {tab === 'administrators' && (
          <div className="space-y-4">
            <Panel title="Platform administrators" flush>
              <DataTable
                caption="Platform administrators"
                columns={adminColumns}
                rows={admins}
                rowKey={({ grant }) => grant.user_id}
                emptyMessage="No platform administrators are recorded."
              />
            </Panel>
            <Panel title="What each role can do">
              <dl className="space-y-2">
                {ROLES.map((role) => (
                  <div key={role}>
                    <dt className="text-sm font-medium text-content dark:text-content-dark">
                      {PLATFORM_ROLE_LABELS[role]}
                    </dt>
                    <dd className="text-sm text-content-muted dark:text-content-muted-dark">
                      {PLATFORM_ROLE_SCOPES[role]}
                    </dd>
                  </div>
                ))}
              </dl>
              <p className="mt-3 border-t border-surface-border pt-3 text-sm text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
                Grant new administrators from{' '}
                <span className="font-medium">Platform users</span>. New grants start as
                Platform Support and can be promoted here.
              </p>
            </Panel>
          </div>
        )}

        {tab === 'authentication' && (
          <div className="space-y-4">
            <Callout tone="warning" title="These settings are not editable here">
              <p>
                Password policy, email verification, magic links, session length and OAuth
                providers are owned by Supabase Auth and configured in the Supabase
                dashboard. Storing a copy of them in this database would create a switch
                that persists a value nothing reads.
              </p>
              <p>
                What is below is the real, build-time configuration this deployment is
                running with.
              </p>
            </Callout>
            <Panel title="Second factor for this console" bodyClassName="p-4">
              <SettingRow
                label="Require a second factor of platform administrators"
                hint={
                  settings.require_mfa
                    ? 'Enforced by is_platform_admin(): a console policy refuses a session that has not completed a second factor.'
                    : 'Off. Administrators reach this console with a password alone.'
                }
                control={
                  <Toggle
                    checked={settings.require_mfa}
                    // Turning it ON needs a session that has itself done MFA.
                    // The database refuses otherwise; disabling the control
                    // says so before the click rather than after.
                    disabled={!settings.require_mfa && !(mfa?.sessionIsAal2 ?? false)}
                    onChange={(next: boolean) => void toggleMfaRequired(next)}
                    label="Require a second factor of platform administrators"
                  />
                }
              />
              {!settings.require_mfa && !(mfa?.sessionIsAal2 ?? false) && (
                <p className="pt-3 text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
                  {mfa?.hasVerifiedFactor
                    ? 'You have a second factor but this session did not use it. Sign out and back in with your code, then turn this on.'
                    : 'Set one up on your own account first (Account → Security). Requiring a second factor from a session that has not used one would lock you out of this console — the database refuses it for that reason.'}
                </p>
              )}
              <p className="pt-3 text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
                This column existed from `0027` with a default of on, and nothing checked
                it until `0102`. It was set to off in that migration because off is what
                was true: there were no enrolled factors at all.
              </p>
            </Panel>
            <Panel title="Actual configuration" flush>
              <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
                <Capability
                  name="Sign-in providers"
                  detail={
                    env.oauthProviders.length > 0
                      ? env.oauthProviders.join(', ')
                      : 'Email and password only, no OAuth providers declared'
                  }
                  enabled={env.oauthProviders.length > 0}
                />
                <Capability
                  name="Error monitoring"
                  detail={env.sentryDsn ? 'Sentry DSN configured' : 'No Sentry DSN'}
                  enabled={Boolean(env.sentryDsn)}
                />
              </ul>
            </Panel>
          </div>
        )}

        {tab === 'retention' && (
          <Panel title="Retention schedule" bodyClassName="p-4">
            {retention.map((row) => (
              <SettingRow
                key={row.data_type}
                label={row.label}
                hint={row.note}
                control={
                  <span className="flex items-center gap-2">
                    <span className="font-mono text-xs text-content dark:text-content-dark">
                      {row.retain_months === null
                        ? 'Indefinite'
                        : `${row.retain_months} months`}
                    </span>
                    <Badge tone={row.enforced ? 'success' : 'warning'} dot>
                      {row.enforced ? 'Enforced' : 'Not enforced'}
                    </Badge>
                  </span>
                }
              />
            ))}
            <p className="pt-4 text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
              Enforced by <code>enforce_retention()</code> on a nightly pg_cron schedule
              since 0029, with every run recorded in <code>retention_runs</code>. The
              audit log is unreachable from that function by construction: its retention
              is null and the loop skips null. Deleted tenant data stays manual, because
              it removes an organisation and everything cascading from it.
            </p>
          </Panel>
        )}
      </div>
    </AdminPage>
  );
}

function Capability({
  name,
  detail,
  enabled,
}: {
  name: string;
  detail: string;
  enabled: boolean;
}): JSX.Element {
  return (
    <li className="flex flex-wrap items-center gap-3 px-5 py-4">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-content dark:text-content-dark">{name}</p>
        <p className="text-xs text-content-muted dark:text-content-muted-dark">
          {detail}
        </p>
      </div>
      {/* Colour is never the only signal. The word says it too (§26). */}
      <Badge tone={enabled ? 'success' : 'neutral'}>
        {enabled ? 'Enabled' : 'Not configured'}
      </Badge>
    </li>
  );
}
