import { useEffect, useState } from 'react';
import { ScrollText, ShieldAlert } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useToast } from '@/hooks/useToast';
import { listAuditLogs, type AuditLogEntry } from '@/services/auditService';
import { reportError } from '@/lib/sentry';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { SettingsSection } from '@/components/settings/SettingsSection';
import { formatAuditAction } from '@/lib/auditActions';
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
 * ## Why this screen is mostly an explanation
 *
 * `audit_logs` has been provisioned since `0002` and has exactly one writer in
 * the entire system: the `anonymize_staff_member` RPC. No login, rota publish,
 * shift edit, role change, invite or GDPR export is recorded anywhere.
 *
 * For a multi-tenant app holding staff PII under UK GDPR, an audit trail is an
 * accountability control, *who changed this person's shift*, *who exported
 * this record*. Shipping a viewer over a table that will be empty for every
 * organisation, without saying why, produces a screen that looks broken and,
 * worse, implies that nothing has happened. So the screen renders whatever is
 * genuinely there and states exactly which events are captured today.
 *
 * The reference also has `ip_address`, `severity` and an "area" column, none
 * of which the table has. Writing the missing events plus those columns is one
 * migration and it should land before this screen is treated as a compliance
 * artefact.
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
            <table className="w-full min-w-[40rem] text-sm">
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
                    Record
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
                    <td className="py-3 text-content-muted dark:text-content-muted-dark">
                      {entry.entity_type ?? '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ScrollRegion>
        )}
      </SettingsSection>

      <Card className="bg-warning/5">
        <div className="flex gap-3">
          <ShieldAlert
            size={18}
            className="mt-0.5 shrink-0 text-warning"
            aria-hidden="true"
          />
          <div className="text-sm text-content-muted dark:text-content-muted-dark">
            <p className="font-medium text-content dark:text-content-dark">
              What is recorded today
            </p>
            <p className="mt-1">
              Only staff-record anonymisation is written to this trail. Sign-ins, rota
              publishing, shift edits, role changes, invitations and data exports are{' '}
              <strong className="font-semibold text-content dark:text-content-dark">
                not
              </strong>{' '}
              recorded yet. Treat this as an incomplete record: an empty trail does not
              mean nothing happened.
            </p>
          </div>
        </div>
      </Card>
    </div>
  );
}
