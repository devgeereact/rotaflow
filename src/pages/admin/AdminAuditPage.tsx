import { useCallback, useEffect, useMemo, useState } from 'react';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Select } from '@/components/ui/Select';
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
} from '@/components/admin/AdminPage';
import { listAllOrganisations, listPlatformAuditLogs } from '@/services/platformService';
import { reportError } from '@/lib/sentry';
import type { AuditLog, Organisation } from '@/types';

const LIMIT = 200;

/**
 * `/admin/audit` — NEW_STRUCTURE §34's platform audit.
 *
 * Shows the most recent {@link LIMIT} events across every organisation.
 * Deliberately capped rather than paginated: `audit_logs` is append-only and
 * grows without bound, and this is a "what just happened" view. The cap is
 * stated on screen — a truncated list that looks complete is how an
 * investigation reaches the wrong conclusion.
 *
 * `metadata` is not rendered. It is free-form JSON written by whatever recorded
 * the event, and §44 is explicit that sensitive information must not surface in
 * standard audit views.
 */
export function AdminAuditPage(): JSX.Element {
  const [entries, setEntries] = useState<AuditLog[] | null>(null);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState('all');

  useEffect(() => {
    let active = true;
    setFailed(false);
    setEntries(null);
    void (async () => {
      try {
        const [logs, orgs] = await Promise.all([
          listPlatformAuditLogs(LIMIT),
          listAllOrganisations(),
        ]);
        if (!active) return;
        setEntries(logs);
        setOrganisations(orgs);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:audit' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const orgById = useMemo(
    () => new Map(organisations.map((o) => [o.id, o])),
    [organisations],
  );

  const visible = useMemo(() => {
    let rows = entries ?? [];
    if (orgFilter !== 'all') rows = rows.filter((e) => e.org_id === orgFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (e) =>
          e.action.toLowerCase().includes(q) ||
          (e.entity_type ?? '').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [entries, orgFilter, search]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);

  return (
    <AdminPage
      title="Platform audit"
      description={`The ${LIMIT} most recent events across every organisation.`}
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !entries ? (
        <AdminLoading />
      ) : entries.length === 0 ? (
        <AdminEmpty message="No audit events have been recorded yet." />
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-3">
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search action or entity…"
              aria-label="Search audit events"
              className="max-w-xs"
            />
            <Select
              value={orgFilter}
              onChange={(e) => setOrgFilter(e.target.value)}
              aria-label="Filter by organisation"
              className="max-w-xs"
            >
              <option value="all">All organisations</option>
              {organisations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </Select>
          </div>

          <Card className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[46rem] text-sm">
                <thead>
                  <tr className="border-b border-surface-border text-left text-xs uppercase tracking-wide text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
                    <th className="px-5 py-3 font-medium">When</th>
                    <th className="px-5 py-3 font-medium">Organisation</th>
                    <th className="px-5 py-3 font-medium">Action</th>
                    <th className="px-5 py-3 font-medium">Entity</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((entry) => (
                    <tr
                      key={entry.id}
                      className="border-b border-surface-border last:border-0 dark:border-surface-border-dark"
                    >
                      <td className="whitespace-nowrap px-5 py-3 text-content-muted dark:text-content-muted-dark">
                        {new Date(entry.created_at).toLocaleString('en-GB')}
                      </td>
                      <td className="px-5 py-3 text-content dark:text-content-dark">
                        {orgById.get(entry.org_id)?.name ?? 'Unknown'}
                      </td>
                      <td className="px-5 py-3 font-medium text-content dark:text-content-dark">
                        {entry.action}
                      </td>
                      <td className="px-5 py-3 text-content-muted dark:text-content-muted-dark">
                        {entry.entity_type ?? '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          {visible.length === 0 ? (
            <AdminEmpty message="No event matches those filters." />
          ) : (
            <p className="text-xs text-content-muted dark:text-content-muted-dark">
              Showing {visible.length} of the {entries.length} most recent events.
              {entries.length === LIMIT && ' Older events exist but are not loaded here.'}
            </p>
          )}
        </div>
      )}
    </AdminPage>
  );
}
