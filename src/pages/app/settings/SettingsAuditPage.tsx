import { useEffect, useState, type JSX } from 'react';
import { ScrollText } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import { listAuditLogs, type AuditLogEntry } from '@/services/auditService';
import { reportError } from '@/lib/sentry';
import { Badge } from '@/components/ui/Badge';
import { Callout } from '@/components/ui/Callout';
import { EmptyState } from '@/components/ui/EmptyState';
import { SettingsSection } from '@/components/settings/SettingsSection';
import {
  auditSeverityTone,
  formatAuditAction,
  formatAuditRecord,
  formatAuditSeverity,
} from '@/lib/auditActions';
import { OwnerOnlyNotice } from '@/components/layout/SettingsLayout';
import { ScrollRegion } from '@/components/ui/ScrollRegion';

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
 * `/app/settings/audit`. Design/Settingsaudit.png.
 *
 * ## What the trail holds, and what it does not
 *
 * Since `0016` the database writes an entry for the decisions it can observe
 * (rota publishing and amendments, role and membership changes, invitations,
 * organisation changes) and `log_audit_event` / `audit_write` record the rest
 * (exports, GDPR requests, leave reviews, timesheet amendments, billing,
 * announcements, the AI assistant). `formatAuditAction` names every one of
 * them. Two things are not recorded, and the note under the table says so:
 * sign-ins, and individual shift edits, which are recorded at the rota
 * decision rather than per row (see `auditService.ts`).
 *
 * The note used to say only staff anonymisation was written, which stopped
 * being true at `0016`; an owner reading it would have distrusted a complete
 * trail. The reference's Severity and Area columns are here because the table
 * has `severity` and `entity_type`. Its IP address column is not: nothing
 * writes `ip_address`, and an empty column would imply a capture that does
 * not happen.
 */
export function SettingsAuditPage(): JSX.Element {
  const { orgId, role } = useOrg();
  const { showError } = useToast();

  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    if (!orgId || role !== 'owner') return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const rows = await listAuditLogs(orgId);
        if (!active) return;
        setEntries(rows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'settings-audit:load' });
        setLoadFailed(true);
        showError('Could not load the audit trail.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, role, showError]);

  if (role !== 'owner') return <OwnerOnlyNotice section="the audit trail" />;

  return (
    <div className="space-y-6">
      <SettingsSection
        title="Audit trail"
        description="A record of actions taken in this organisation, newest first."
      >
        {loading ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Loading…
          </p>
        ) : loadFailed ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Could not load the audit trail. This is a connection problem, not an empty
            record.
          </p>
        ) : entries.length === 0 ? (
          <EmptyState
            icon={ScrollText}
            title="No recorded events"
            description="Nothing that RotaFlow currently audits has happened in this organisation."
          />
        ) : (
          <ScrollRegion label="Audit log">
            <table className="w-full min-w-160 text-sm">
              <thead>
                <tr className="border-b border-surface-border text-left dark:border-surface-border-dark">
                  <th className="pb-3 font-medium text-content-muted dark:text-content-muted-dark">
                    When
                  </th>
                  <th className="pb-3 font-medium text-content-muted dark:text-content-muted-dark">
                    Action
                  </th>
                  <th className="pb-3 font-medium text-content-muted dark:text-content-muted-dark">
                    Who
                  </th>
                  <th className="pb-3 font-medium text-content-muted dark:text-content-muted-dark">
                    Area
                  </th>
                  <th className="pb-3 font-medium text-content-muted dark:text-content-muted-dark">
                    Severity
                  </th>
                </tr>
              </thead>
              <tbody>
                {entries.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-divider last:border-0 dark:border-divider-dark"
                  >
                    <td className="whitespace-nowrap py-3 pr-4 font-mono text-xs text-content-muted dark:text-content-muted-dark">
                      {formatTimestamp(entry.created_at)}
                    </td>
                    <td className="py-3 pr-4">
                      <Badge tone="info">{formatAuditAction(entry.action)}</Badge>
                    </td>
                    <td className="py-3 pr-4 text-content dark:text-content-dark">
                      {entry.actorName ?? (
                        <span className="text-content-muted">Deleted account</span>
                      )}
                    </td>
                    <td className="py-3 pr-4 text-content-muted dark:text-content-muted-dark">
                      {formatAuditRecord(entry.entity_type)}
                    </td>
                    <td className="py-3">
                      <Badge tone={auditSeverityTone(entry.severity)}>
                        {formatAuditSeverity(entry.severity)}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </SettingsSection>

      <Callout tone="info" title="What this trail records">
        Rota publishing and amendments, role and membership changes, invitations,
        organisation and billing changes, data exports, GDPR requests, leave reviews,
        timesheet amendments, announcements and the AI assistant&rsquo;s actions. Two
        things are <strong className="font-semibold">not</strong> recorded: sign-ins, and
        individual shift edits, which are recorded once at the rota decision rather than
        shift by shift.
      </Callout>
    </div>
  );
}
