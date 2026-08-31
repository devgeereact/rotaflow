import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { formatAuditAction } from '@/lib/auditActions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { listMyAuditLogs, type AuditLogEntry } from '@/services/auditService';
import { reportError } from '@/lib/sentry';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SettingsSection } from '@/components/settings/SettingsSection';

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * `/app/account/activity`. Design/ProfileSettings.png, "Recent account
 * activity".
 *
 * Reads the same `audit_logs` table as Settings → Audit, filtered to this
 * user.
 *
 * ## Two claims that used to be here and were both wrong
 *
 * This comment said only staff-record anonymisation was ever written, and
 * that `audit_logs_select` is owner-only so a manager reading their own
 * activity is filtered out by RLS. Neither survived being checked against the
 * live policy (BUG-063, 2026-08-31):
 *
 *     is_platform_admin()
 *     OR (visibility <> 'platform_only' AND org_id IS NOT NULL
 *         AND (has_org_role(org_id, ARRAY['owner']) OR actor_user_id = auth.uid()))
 *
 * `actor_user_id = auth.uid()` is the deliberate widening `0016` made for
 * exactly this screen — anybody can read their own actions. And `0016` writes
 * events for memberships, organisations, rotas, invites and platform-admin
 * changes, not just anonymisation.
 *
 * So an empty list here means what it says. The one thing it does NOT mean is
 * that somebody did nothing: an action taken through a service-role path — a
 * platform administrator acting on the org, a scheduled job — is recorded with
 * no `actor_user_id` and `metadata.via = 'service_role'`, and therefore
 * belongs to nobody's personal activity. That is correct, and it is why the
 * empty state below points at the org-wide audit trail rather than claiming a
 * clean record.
 */
export function ActivityPage(): JSX.Element {
  const { user } = useSupabaseAuth();
  const { orgId } = useOrg();
  const { showError } = useToast();

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!orgId || !user) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const rows = await listMyAuditLogs(orgId, user.id);
        if (!active) return;
        setEntries(rows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'account-activity:load' });
        setLoadFailed(true);
        showError('Could not load your activity.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, user, showError]);

  return (
    <div className="max-w-3xl space-y-6">
      <SettingsSection
        title="Recent activity"
        description="Actions recorded against your account in this organisation."
      >
        {loading ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Loading…
          </p>
        ) : loadFailed ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Could not load your activity. This is a connection problem, not an empty
            record.
          </p>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={History}
            title="Nothing recorded"
            description="No audited actions are logged against your account in this organisation. Actions taken on your behalf by a platform administrator, or by a scheduled job, are recorded against the organisation rather than against you — an owner can see those in Settings → Audit."
          />
        ) : (
          <ul className="divide-y divide-divider dark:divide-divider-dark">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-content dark:text-content-dark">
                    {formatAuditAction(entry.action)}
                  </p>
                  {entry.entity_type && (
                    <p className="mt-0.5 text-xs text-content-muted dark:text-content-muted-dark">
                      {entry.entity_type}
                    </p>
                  )}
                </div>
                <span className="shrink-0 whitespace-nowrap font-mono text-xs text-content-muted dark:text-content-muted-dark">
                  {formatTimestamp(entry.created_at)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SettingsSection>

      <Card className="bg-info/5">
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          RotaFlow&rsquo;s activity log is incomplete: sign-ins, rota changes, leave
          decisions and exports are not recorded yet. An empty list here does not mean
          nothing has happened on your account.
        </p>
      </Card>
    </div>
  );
}
