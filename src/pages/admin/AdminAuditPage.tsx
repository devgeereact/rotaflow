import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
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
import { Callout } from '@/components/ui/Callout';
import { Button } from '@/components/ui/Button';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { downloadCsv } from '@/lib/csv';
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

const SEVERITIES = Object.keys(SEVERITY_TONE) as SeverityKey[];

function toneFor(severity: string): (typeof SEVERITY_TONE)[SeverityKey] {
  return SEVERITY_TONE[severity as SeverityKey] ?? 'neutral';
}

/**
 * `/admin/audit`. NEW_STRUCTURE §34's platform audit.
 *
 * Shows the most recent {@link LIMIT} events across every organisation.
 * Deliberately capped rather than paginated: `audit_logs` is append-only and
 * grows without bound, and this is a "what just happened" view. The cap is
 * stated on screen, a truncated list that looks complete is how an
 * investigation reaches the wrong conclusion.
 *
 * `metadata` is not rendered. It is free-form JSON written by whatever recorded
 * the event, and §44 is explicit that sensitive information must not surface in
 * standard audit views.
 *
 * ## Two kinds of row
 *
 * Since 0016 an event may be platform-scoped, carrying a null `org_id`, a
 * platform role granted or revoked belongs to no customer. Those render as
 * "Platform" rather than "Unknown", which is the distinction that matters when
 * reading this list: one is an event about RotaFlow itself, the other would be
 * a lookup failure.
 *
 * A null `org_id` also arises the other way, when an organisation has been
 * deleted. The FK is `on delete set null` so the trail survives the tenant.
 * `org_name` is snapshotted at write time and is what those rows fall back to,
 * so a deleted customer's events still name the customer.
 */
/**
 * The prior or resulting value for one audit row.
 *
 * `audit_logs.before_value` and `after_value` are real columns as of 0027, and
 * `audit_write` lifts a scalar out of the metadata into them on every write.
 * Rows written before that migration have nothing in the columns, so this falls
 * back to reading the same two keys out of `metadata`. Otherwise the whole
 * history before 05 August 2026 would show an em dash and look like a gap in
 * the record rather than a column that arrived late.
 *
 * Only scalars, in both paths. §44 is explicit that sensitive information must
 * not surface in a standard audit view, and a nested payload is exactly where a
 * phone number or an address would be hiding.
 */
function changeValue(entry: AuditLog, key: 'before' | 'after'): string | null {
  const column = key === 'before' ? entry.before_value : entry.after_value;
  if (column !== null && column !== undefined) return column;

  const metadata = entry.metadata;
  if (typeof metadata !== 'object' || metadata === null) return null;
  const value = (metadata as Record<string, unknown>)[key];
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  return null;
}

function ChangeCell({
  value,
  muted,
}: {
  value: string | null;
  muted?: boolean;
}): JSX.Element {
  return (
    <span
      className={`block truncate text-xs ${
        muted
          ? 'text-content-muted dark:text-content-muted-dark'
          : 'font-semibold text-content dark:text-content-dark'
      }`}
    >
      {value ?? '-'}
    </span>
  );
}

export function AdminAuditPage(): JSX.Element {
  const [entries, setEntries] = useState<AuditLog[] | null>(null);
  const [organisations, setOrganisations] = useState<Organisation[]>([]);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [search, setSearch] = useState('');
  const [orgFilter, setOrgFilter] = useState('all');
  const [severityFilter, setSeverityFilter] = useState('all');

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
    if (severityFilter !== 'all') {
      rows = rows.filter((e) => e.severity === severityFilter);
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
  }, [entries, orgFilter, severityFilter, search]);

  const columns = useMemo<DataTableColumn<AuditLog>[]>(
    () => [
      {
        key: 'when',
        label: 'When',
        width: 'w-[12%]',
        cell: (entry) => (
          <span className="block font-mono text-xs leading-tight text-content-muted dark:text-content-muted-dark">
            {new Date(entry.created_at).toLocaleDateString('en-GB', {
              day: '2-digit',
              month: 'short',
              year: 'numeric',
            })}
            <br />
            {new Date(entry.created_at).toLocaleTimeString('en-GB')}
          </span>
        ),
      },
      {
        key: 'organisation',
        label: 'Organisation',
        width: 'w-[13%]',
        cell: (entry) =>
          entry.scope === 'platform' ? (
            <span className="block truncate text-content-muted dark:text-content-muted-dark">
              Platform
            </span>
          ) : (
            <Link
              to={`/admin/organisations/${entry.org_id ?? ''}`}
              className="block truncate text-primary hover:underline"
            >
              {orgById.get(entry.org_id ?? '')?.name ?? entry.org_name ?? 'Unknown'}
            </Link>
          ),
      },
      {
        key: 'actor',
        label: 'Actor',
        width: 'w-[11%]',
        cell: (entry) => (
          <span className="block truncate text-content-muted dark:text-content-muted-dark">
            {entry.actor_name ?? entry.actor_email ?? 'System'}
          </span>
        ),
      },
      {
        key: 'action',
        label: 'Action',
        width: 'w-[17%]',
        cell: (entry) => (
          <span className="block truncate font-medium">{entry.action}</span>
        ),
      },
      {
        key: 'entity',
        label: 'Entity',
        width: 'w-[11%]',
        cell: (entry) => (
          // `table-fixed` gives this column a hard width, so an entity name
          // longer than it, `support_access_session`, ran under the severity
          // badge in the next column instead of clipping.
          <span className="block truncate font-mono text-xs text-content-muted dark:text-content-muted-dark">
            {entry.entity_type ?? '-'}
          </span>
        ),
      },
      {
        key: 'entity',
        label: 'Before',
        width: 'w-[8%]',
        cell: (entry) => <ChangeCell value={changeValue(entry, 'before')} muted />,
      },
      {
        key: 'entity',
        label: 'After',
        width: 'w-[9%]',
        cell: (entry) => <ChangeCell value={changeValue(entry, 'after')} />,
      },
      {
        key: 'entity',
        label: 'IP',
        width: 'w-[9%]',
        cell: (entry) => (
          <span className="block truncate font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
            {typeof entry.ip_address === 'string' ? entry.ip_address : '-'}
          </span>
        ),
      },
      {
        key: 'severity',
        label: 'Result',
        width: 'w-[10%]',
        cell: (entry) => (
          <Badge tone={toneFor(entry.severity)} dot>
            {entry.severity}
          </Badge>
        ),
      },
    ],
    [orgById],
  );

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  const exportCsv = useCallback(() => {
    downloadCsv(`platform-audit_${new Date().toISOString().slice(0, 10)}`, visible, [
      { label: 'When', value: (e) => e.created_at },
      { label: 'Scope', value: (e) => e.scope ?? '' },
      {
        label: 'Organisation',
        value: (e) => orgById.get(e.org_id ?? '')?.name ?? e.org_name ?? '',
      },
      { label: 'Actor', value: (e) => e.actor_name ?? e.actor_email ?? 'System' },
      { label: 'Action', value: (e) => e.action },
      { label: 'Entity', value: (e) => e.entity_type ?? '' },
      { label: 'Severity', value: (e) => e.severity ?? '' },
    ]);
  }, [visible, orgById]);

  return (
    <AdminPage
      title="Audit logs"
      description="Append-only record of every platform-administrator action. Records cannot be edited or deleted by anyone, including a Platform Owner."
      action={
        <>
          <Button
            variant="secondary"
            disabled
            title="Nothing stores a saved filter. There is no table for one"
          >
            Save filter
          </Button>
          <Button variant="secondary" onClick={exportCsv} disabled={visible.length === 0}>
            Export CSV
          </Button>
        </>
      }
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : !entries ? (
        <AdminLoading />
      ) : entries.length === 0 ? (
        <AdminEmpty message="No audit events have been recorded yet." />
      ) : (
        <div className="space-y-4">
          <Callout tone="info">
            <p>
              Most writers are still to be added, so this log is thinner than it will be
              rather than incomplete. Before and After come from the columns of the same
              name, falling back to a row&rsquo;s <code>metadata</code> for events
              recorded before those columns existed, and only ever a scalar, because an
              audit view is the wrong place to dump a payload that may hold personal data.
            </p>
          </Callout>

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
            <Select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value)}
              aria-label="Filter by result"
              className="max-w-[12rem]"
            >
              <option value="all">Any result</option>
              {SEVERITIES.map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </Select>
            <span className="ml-auto self-center text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
              {visible.length} of {entries.length}
            </span>
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
