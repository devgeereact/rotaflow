import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Save } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { PanelTabs } from '@/components/ui/PanelTabs';
import { Panel } from '@/components/ui/Card';
import { Callout } from '@/components/ui/Callout';
import { SettingRow } from '@/components/ui/SettingRow';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { Select } from '@/components/ui/Select';
import { Toggle } from '@/components/ui/Toggle';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import {
  getPlatformSettings,
  updatePlatformSettings,
} from '@/services/platformSettingsService';
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
import { MeterRows } from '@/components/ui/MeterRows';
import {
  DEMO_API,
  DEMO_BRANDING,
  DEMO_EMAIL,
  DEMO_SECURITY,
  DEMO_STORAGE_LIMITS,
  DEMO_STORAGE_USAGE,
  RETENTION_POLICY,
  type DemoSettingRow,
} from '@/lib/adminOverviewDemo';
import type { PlatformAdmin, PlatformRole, PlatformSettings, Profile } from '@/types';

type Tab =
  | 'general'
  | 'branding'
  | 'authentication'
  | 'security'
  | 'email'
  | 'storage'
  | 'retention'
  | 'administrators'
  | 'api'
  | 'maintenance';

/** The console reference's tabs, in its order. */
const TABS = [
  { value: 'general', label: 'General' },
  { value: 'branding', label: 'Branding' },
  { value: 'authentication', label: 'Authentication' },
  { value: 'security', label: 'Security' },
  { value: 'email', label: 'Email' },
  { value: 'storage', label: 'Storage' },
  { value: 'retention', label: 'Data Retention' },
  { value: 'administrators', label: 'Administrators' },
  { value: 'api', label: 'API' },
  { value: 'maintenance', label: 'Maintenance' },
] as const satisfies readonly { value: Tab; label: string }[];

/**
 * Which tabs are drawn from `adminOverviewDemo` rather than from a column.
 *
 * Each one carries its own warning at the top of the tab naming what would be
 * needed to make it real, so a reader never has to guess which switch does
 * something. Delete the demo module and every one of these fails to compile.
 */
const PLACEHOLDER_TABS: Partial<Record<Tab, string>> = {
  branding:
    'No table holds a logo, favicon or accent colour, and the palette is compiled into the bundle by Tailwind — changing it is a deploy, not a setting.',
  security:
    'MFA enforcement, session timeout, IP allowlisting and concurrent-session limits are Supabase Auth and network concerns. None is readable or writable from a static client holding the anon key.',
  email:
    'The platform sender is configured in the Supabase dashboard, and no table records what was sent, delivered or bounced. Per-organisation SMTP is real and lives on Integrations.',
  storage:
    'Documents are recorded as rows but no file storage is wired up, so there are no bytes to total and no limits to enforce.',
  retention:
    'Nothing enforces a retention period. GDPR erasure is per data subject and lives on the GDPR screen; a number here would be one no job reads.',
  api: 'There is no public API, so there are no keys, rate limits or webhook retries to configure. Issuing a long-lived token would be a security decision, not a settings row.',
};

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
 * `/admin/settings` — deployment configuration and the administrator roster.
 *
 * ## Which settings are real
 *
 * The General and Maintenance tabs write `platform_settings` (0018) and take
 * effect. The Authentication tab is **read-only and says so**: password policy,
 * magic links, OAuth providers and session length all belong to Supabase Auth,
 * which this table cannot override. A "require email verification" switch here
 * would persist a boolean nothing consults — the same defect the console
 * already shipped once, where a toggle reported success and changed nothing.
 * So that tab reports the real build-time configuration and names where each
 * setting actually lives.
 */

export function AdminSettingsPage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const { canManagePlatformConfig, canManagePlatformAdmins } = usePermissions();
  const { confirm } = useConfirm();
  const { showError, showSuccess } = useToast();

  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [admins, setAdmins] = useState<AdminRow[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  // The open tab lives in the URL so a link can point at one — "the API tab
  // says there is no API" is a thing people send each other, and it was
  // unlinkable while this was component state.
  const [params, setParams] = useSearchParams();
  const requested = params.get('tab');
  const tab: Tab = TABS.some((t) => t.value === requested)
    ? (requested as Tab)
    : 'general';
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
  const [draft, setDraft] = useState<Partial<PlatformSettings>>({});
  const [saving, setSaving] = useState(false);
  const [busyUser, setBusyUser] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setFailed(false);
    setSettings(null);
    setAdmins(null);
    void (async () => {
      try {
        const [row, grants, profiles] = await Promise.all([
          getPlatformSettings(),
          listPlatformAdmins(),
          listAllProfiles(),
        ]);
        if (!active) return;
        const byId = new Map(profiles.map((p) => [p.id, p]));
        setSettings(row);
        setDraft({});
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

  const value = <K extends keyof PlatformSettings>(key: K): PlatformSettings[K] =>
    (draft[key] ?? settings?.[key]) as PlatformSettings[K];

  const dirty = Object.keys(draft).length > 0;

  const save = useCallback(async (): Promise<void> => {
    if (!user || !dirty) return;
    setSaving(true);
    try {
      const saved = await updatePlatformSettings(draft, user.id);
      setSettings(saved);
      setDraft({});
      showSuccess('Platform settings saved.');
    } catch (err) {
      reportError(err, { area: 'admin:settings:save' });
      showError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not save. Please try again.',
      );
    } finally {
      setSaving(false);
    }
  }, [user, dirty, draft, showError, showSuccess]);

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
              {profile?.full_name ?? '—'}
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
        cell: (row) =>
          canManagePlatformAdmins ? (
            <Select
              value={row.grant.role}
              aria-label={`Platform role for ${row.profile?.email ?? row.grant.user_id}`}
              disabled={busyUser === row.grant.user_id}
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
          ),
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
      action={
        tab === 'general' || tab === 'maintenance' ? (
          <Button
            disabled={!dirty || saving || !canManagePlatformConfig}
            onClick={() => void save()}
            title={
              canManagePlatformConfig
                ? undefined
                : 'Only a platform owner or administrator can change these'
            }
          >
            <Save size={16} aria-hidden="true" />
            Save changes
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-4">
        <PanelTabs
          items={TABS.map((t) => ({ value: t.value, label: t.label }))}
          active={tab}
          onChange={setTab}
          label="Platform settings sections"
        />

        {tab === 'general' && (
          <Panel
            title="Platform identity"
            bodyClassName="grid gap-4 p-4 [grid-template-columns:repeat(auto-fit,minmax(16rem,1fr))]"
          >
            <Field
              id="platform-name"
              label="Platform name"
              value={value('platform_name')}
              disabled={!canManagePlatformConfig}
              onChange={(v) => setDraft((d) => ({ ...d, platform_name: v }))}
            />
            <Field
              id="support-email"
              label="Support email"
              type="email"
              value={value('support_email')}
              disabled={!canManagePlatformConfig}
              onChange={(v) => setDraft((d) => ({ ...d, support_email: v }))}
            />
            <Field
              id="platform-url"
              label="Platform URL"
              value={value('platform_url')}
              disabled={!canManagePlatformConfig}
              onChange={(v) => setDraft((d) => ({ ...d, platform_url: v }))}
            />
            <Field
              id="default-timezone"
              label="Default timezone"
              value={value('default_timezone')}
              disabled={!canManagePlatformConfig}
              onChange={(v) => setDraft((d) => ({ ...d, default_timezone: v }))}
              hint="Used when an organisation has not chosen one. Existing organisations are unaffected."
            />
          </Panel>
        )}

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
            <Panel title="Actual configuration" flush>
              <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
                <Capability
                  name="Sign-in providers"
                  detail={
                    env.oauthProviders.length > 0
                      ? env.oauthProviders.join(', ')
                      : 'Email and password only — no OAuth providers declared'
                  }
                  enabled={env.oauthProviders.length > 0}
                />
                <Capability
                  name="Self-service registration"
                  detail={
                    value('registration_enabled')
                      ? 'Recorded as open. Supabase Auth is the enforcement point.'
                      : 'Recorded as closed. Supabase Auth is the enforcement point.'
                  }
                  enabled={value('registration_enabled')}
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

        {PLACEHOLDER_TABS[tab] && (
          <Callout tone="warning" title="This tab is placeholder">
            <p>{PLACEHOLDER_TABS[tab]}</p>
            <p>
              The rows below come from <code>src/lib/adminOverviewDemo.ts</code>. Every
              control on them is inert — a switch that flipped and forgot would be worse
              than one that plainly cannot move.
            </p>
          </Callout>
        )}

        {tab === 'branding' && <DemoSettings title="Branding" rows={DEMO_BRANDING} />}

        {tab === 'security' && (
          <DemoSettings title="Console security" rows={DEMO_SECURITY} />
        )}

        {tab === 'email' && <DemoSettings title="Platform email" rows={DEMO_EMAIL} />}

        {tab === 'storage' && (
          <div className="space-y-4">
            <Panel title="Storage by type" bodyClassName="p-4">
              <MeterRows
                caption="Placeholder storage totals by type"
                rows={DEMO_STORAGE_USAGE.map((row) => ({
                  label: row.label,
                  value: row.value,
                  display: row.display,
                }))}
              />
            </Panel>
            <DemoSettings title="Upload limits" rows={DEMO_STORAGE_LIMITS} />
          </div>
        )}

        {tab === 'retention' && (
          <Panel title="Retention schedule" bodyClassName="p-4">
            {RETENTION_POLICY.map((row) => (
              <SettingRow
                key={row.data}
                label={row.data}
                control={
                  <span className="font-mono text-xs text-content dark:text-content-dark">
                    {row.retained}
                  </span>
                }
              />
            ))}
            <p className="pt-4 text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
              The audit row is the one that is true today: <code>audit_logs</code> carries
              no update or delete policy, so it cannot be erased from the product. The
              rest is the schedule to build to, and the same table is shown beside the
              request register on GDPR &amp; Data.
            </p>
          </Panel>
        )}

        {tab === 'api' && <DemoSettings title="API" rows={DEMO_API} />}

        {tab === 'maintenance' && (
          <Panel title="Maintenance" bodyClassName="p-4">
            <SettingRow
              label="Maintenance banner"
              hint="Shows a notice to every signed-in user, across every organisation."
              control={
                <Toggle
                  checked={value('maintenance_mode')}
                  disabled={!canManagePlatformConfig}
                  label="Show the maintenance banner to every signed-in user"
                  onChange={(checked) =>
                    setDraft((d) => ({ ...d, maintenance_mode: checked }))
                  }
                />
              }
            />
            <div className="pt-4">
              <Field
                id="maintenance-message"
                label="Message"
                value={value('maintenance_message') ?? ''}
                disabled={!canManagePlatformConfig}
                onChange={(v) => setDraft((d) => ({ ...d, maintenance_message: v }))}
                hint="e.g. Scheduled maintenance on Sunday 02:00–04:00 UTC."
              />
            </div>
            <Callout tone="warning" className="mt-4">
              <p>
                This is a banner, not a kill switch. A static PWA cannot refuse to serve
                itself, and row-level security is what actually stands between a user and
                their data — so this informs people rather than stopping them.
              </p>
            </Callout>
          </Panel>
        )}
      </div>
    </AdminPage>
  );
}

/**
 * A tab of settings this deployment cannot store.
 *
 * Controls render their state and refuse to change it, and each says why on
 * hover — a dead switch that explains itself is better than one that answers
 * the click with nothing.
 */
function DemoSettings({
  title,
  rows,
}: {
  title: string;
  rows: readonly DemoSettingRow[];
}): JSX.Element {
  return (
    <Panel title={title} bodyClassName="p-4">
      {rows.map((row) => (
        <SettingRow
          key={row.label}
          label={row.label}
          hint={row.hint}
          control={
            row.kind === 'switch' ? (
              <Toggle
                checked={Boolean(row.on)}
                disabled
                label={row.label}
                onChange={() => {}}
              />
            ) : row.kind === 'action' ? (
              <Button variant="secondary" disabled title="Nothing stores this setting">
                {row.value}
              </Button>
            ) : (
              <span className="font-mono text-xs text-content dark:text-content-dark">
                {row.value}
              </span>
            )
          }
        />
      ))}
    </Panel>
  );
}

function Field({
  id,
  label,
  value,
  onChange,
  hint,
  type = 'text',
  disabled,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  type?: string;
  disabled?: boolean;
}): JSX.Element {
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type={type}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1"
      />
      {hint && (
        <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
          {hint}
        </p>
      )}
    </div>
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
      {/* Colour is never the only signal — the word says it too (§26). */}
      <Badge tone={enabled ? 'success' : 'neutral'}>
        {enabled ? 'Enabled' : 'Not configured'}
      </Badge>
    </li>
  );
}
