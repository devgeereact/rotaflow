import { useEffect, useState } from 'react';
import { History } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
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
 * user. The important caveat is the same one, and it is stated on the screen:
 * only staff-record anonymisation is currently written to that table, so for
 * nearly everyone this is genuinely empty.
 *
 * There is a second reason it may be empty, and it is worth understanding
 * before treating a blank list as "you have done nothing": `audit_logs_select`
 * is an **owner-only** policy. A staff member or manager reading their own
 * activity is filtered out by RLS, not by an absence of events. The screen
 * does not try to distinguish these two cases, because it cannot. It says the
 * trail is incomplete either way rather than asserting a clean record.
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
            description="No audited actions are logged against your account in this organisation."
          />
        ) : (
          <ul className="divide-y divide-divider dark:divide-divider-dark">
            {entries.map((entry) => (
              <li key={entry.id} className="flex items-start justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-content dark:text-content-dark">
                    {entry.action}
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
