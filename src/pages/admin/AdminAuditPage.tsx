import { useCallback, useEffect, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
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

/** Severity → badge tone. Colour is never the only signal; the word is there too. */
const SEVERITY_TONE = {
  info: 'neutral',
  notice: 'info',
  warning: 'warning',
  critical: 'danger',
} as const;

type SeverityKey = keyof typeof SEVERITY_TONE;

function toneFor(severity: string): (typeof SEVERITY_TONE)[SeverityKey] {
  return SEVERITY_TONE[severity as SeverityKey] ?? 'neutral';
}

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
 *
 * ## Two kinds of row
 *
 * Since 0016 an event may be platform-scoped, carrying a null `org_id` — a
 * platform role granted or revoked belongs to no customer. Those render as
 * "Platform" rather than "Unknown", which is the distinction that matters when
 * reading this list: one is an event about RotaFlow itself, the other would be
 * a lookup failure.
 *
 * A null `org_id` also arises the other way, when an organisation has been
 * deleted — the FK is `on delete set null` so the trail survives the tenant.
 * `org_name` is snapshotted at write time and is what those rows fall back to,
 * so a deleted customer's events still name the customer.
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
    if (orgFilter === 'platform') {
      rows = rows.filter((e) => e.scope === 'platform');
    } else if (orgFilter !== 'all') {
      rows = rows.filter((e) => e.org_id === orgFilter);
    }
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (e) =>
          e.action.toLowerCase().includes(q) ||
          (e.entity_type ?? '').toLowerCase().includes(q) ||
          (e.actor_name ?? '').toLowerCase().includes(q) ||
          (e.actor_email ?? '').toLowerCase().includes(q),
      );
    }
    return rows;
  }, [entries, orgFilter, search]);

  const columns = useMemo<DataTableColumn<AuditLog>[]>(
    () => [
      {
        key: 'when',
        label: 'When',
        width: 'w-[16%]',
        cell: (entry) => (
          <span className="whitespace-nowrap font-mono text-xs text-content-muted dark:text-content-muted-dark">
            {new Date(entry.created_at).toLocaleString('en-GB')}
          </span>
        ),
      },
      {
        key: 'organisation',
        label: 'Organisation',
        width: 'w-[20%]',
        cell: (entry) =>
          entry.scope === 'platform' ? (
            <span className="text-content-muted dark:text-content-muted-dark">
              Platform
            </span>
          ) : (
            <span className="truncate">
              {orgById.get(entry.org_id ?? '')?.name ?? entry.org_name ?? 'Unknown'}
            </span>
          ),
      },
      {
        key: 'actor',
        label: 'Actor',
        width: 'w-[20%]',
        cell: (entry) => (
          <span className="truncate text-content-muted dark:text-content-muted-dark">
            {entry.actor_name ?? entry.actor_email ?? 'System'}
          </span>
        ),
      },
      {
        key: 'action',
        label: 'Action',
        width: 'w-[24%]',
        cell: (entry) => <span className="font-medium">{entry.action}</span>,
      },
      {
        key: 'entity',
        label: 'Entity',
        width: 'w-[12%]',
        cell: (entry) => (
          <span className="text-content-muted dark:text-content-muted-dark">
            {entry.entity_type ?? '—'}
          </span>
        ),
      },
      {
        key: 'severity',
        label: 'Severity',
        width: 'w-[10%]',
        cell: (entry) => <Badge tone={toneFor(entry.severity)}>{entry.severity}</Badge>,
      },
    ],
    [orgById],
  );

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
              placeholder="Search action, entity or actor…"
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
              <option value="platform">Platform events only</option>
              {organisations.map((org) => (
                <option key={org.id} value={org.id}>
                  {org.name}
                </option>
              ))}
            </Select>
          </div>

          <Card className="overflow-hidden p-0">
            <DataTable
              caption="Platform audit events"
              columns={columns}
              rows={visible}
              rowKey={(entry) => entry.id}
              emptyMessage="No event matches those filters."
            />
          </Card>

          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            Showing {visible.length} of the {entries.length} most recent events.
            {entries.length === LIMIT && ' Older events exist but are not loaded here.'}
          </p>
        </div>
      )}
    </AdminPage>
  );
}
