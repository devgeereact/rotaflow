import { useCallback, useEffect, useMemo, useState } from 'react';
import { Save } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { PanelTabs } from '@/components/ui/PanelTabs';
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
import type { PlatformAdmin, PlatformRole, PlatformSettings, Profile } from '@/types';

type Tab = 'general' | 'administrators' | 'authentication' | 'maintenance';

const TABS = [
  { value: 'general', label: 'General' },
  { value: 'administrators', label: 'Administrators' },
  { value: 'authentication', label: 'Authentication' },
  { value: 'maintenance', label: 'Maintenance' },
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
  const [tab, setTab] = useState<Tab>('general');
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
      description="Configuration for this deployment, and who administers it."
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
      <div className="space-y-5">
        <PanelTabs
          items={TABS.map((t) => ({ value: t.value, label: t.label }))}
          active={tab}
          onChange={setTab}
          label="Platform settings sections"
        />

        {tab === 'general' && (
          <Card className="space-y-4">
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
          </Card>
        )}

        {tab === 'administrators' && (
          <div className="space-y-4">
            <Card className="overflow-hidden p-0">
              <DataTable
                caption="Platform administrators"
                columns={adminColumns}
                rows={admins}
                rowKey={({ grant }) => grant.user_id}
                emptyMessage="No platform administrators are recorded."
              />
            </Card>
            <Card>
              <h2 className="mb-2 font-semibold text-content dark:text-content-dark">
                What each role can do
              </h2>
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
            </Card>
          </div>
        )}

        {tab === 'authentication' && (
          <div className="space-y-4">
            <Card className="border-warning/30 bg-warning/5">
              <h2 className="mb-1 font-semibold text-content dark:text-content-dark">
                These settings are not editable here
              </h2>
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                Password policy, email verification, magic links, session length and OAuth
                providers are owned by Supabase Auth and configured in the Supabase
                dashboard. Storing a copy of them in this database would create a switch
                that persists a value nothing reads.
              </p>
              <p className="mt-2 text-sm text-content-muted dark:text-content-muted-dark">
                What is below is the real, build-time configuration this deployment is
                running with.
              </p>
            </Card>
            <Card className="p-0">
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
            </Card>
          </div>
        )}

        {tab === 'maintenance' && (
          <Card className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="min-w-0">
                <p className="font-medium text-content dark:text-content-dark">
                  Maintenance banner
                </p>
                <p className="text-sm text-content-muted dark:text-content-muted-dark">
                  Shows a notice to every signed-in user.
                </p>
              </div>
              <Toggle
                checked={value('maintenance_mode')}
                disabled={!canManagePlatformConfig}
                label="Show the maintenance banner to every signed-in user"
                onChange={(checked) =>
                  setDraft((d) => ({ ...d, maintenance_mode: checked }))
                }
              />
            </div>
            <Field
              id="maintenance-message"
              label="Message"
              value={value('maintenance_message') ?? ''}
              disabled={!canManagePlatformConfig}
              onChange={(v) => setDraft((d) => ({ ...d, maintenance_message: v }))}
              hint="e.g. Scheduled maintenance on Sunday 02:00–04:00 UTC."
            />
            <p className="rounded-xl border border-warning/30 bg-warning/5 px-3 py-2.5 text-sm text-content-muted dark:text-content-muted-dark">
              This is a banner, not a kill switch. A static PWA cannot refuse to serve
              itself, and row-level security is what actually stands between a user and
              their data — so this informs people rather than stopping them.
            </p>
          </Card>
        )}
      </div>
    </AdminPage>
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
