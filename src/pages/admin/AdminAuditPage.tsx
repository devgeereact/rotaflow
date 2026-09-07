import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Link2 } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { DataTable, type DataTableColumn } from '@/components/ui/DataTable';
import { Pagination } from '@/components/ui/Pagination';
import { FilterBar } from '@/components/ui/FilterBar';
import { AdminError, AdminLoading, AdminPage } from '@/components/admin/AdminPage';
import {
  exportPlatformAuditLogs,
  searchPlatformAuditLogs,
  type AuditQuery,
} from '@/services/platformService';
import { listOrganisationDirectoryAll } from '@/services/platformDirectoryService';
import { Callout } from '@/components/ui/Callout';
import { Button } from '@/components/ui/Button';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { useToast } from '@/hooks/useToast';
import { useFilterState } from '@/hooks/useFilterState';
import { filterValue, filterValues } from '@/lib/filters';
import type { FilterDimension, FilterOption } from '@/lib/filters';
import { serverPage, type ServerPage } from '@/lib/serverPage';
import { createdWindowBounds, CREATED_WINDOWS } from '@/lib/organisationDirectory';
import { downloadCsv } from '@/lib/csv';
import { reportError } from '@/lib/sentry';
import type { AuditLog } from '@/types';

const PAGE_SIZE = 50;

/**
 * The dimensions this screen filters on, applied by the database.
 *
 * `q` is not marked sensitive. An audit search term is an action name, an
 * entity type or a colleague's name — the last of those is a person, but this
 * screen exists to answer "what did this person do", the answer is already an
 * audit record, and a linkable filtered view is what replaces the saved filter
 * this screen used to pretend to offer.
 */
const AUDIT_FILTERS: readonly FilterDimension[] = [
  { id: 'q', label: 'Search', kind: 'text' },
  { id: 'scope', label: 'Organisation', kind: 'select' },
  { id: 'severity', label: 'Result', kind: 'multi' },
  { id: 'when', label: 'Period', kind: 'select' },
] as const;

/** Severity → badge tone. Colour is never the only signal; the word is there too. */
const SEVERITY_TONE = {
  info: 'neutral',
  notice: 'info',
  warning: 'warning',
  critical: 'danger',
} as const;

type SeverityKey = keyof typeof SEVERITY_TONE;

const SEVERITIES = Object.keys(SEVERITY_TONE) as SeverityKey[];

/** Sentence case, because a badge reading "critical" is a word, not a key. */
function humanSeverity(severity: string): string {
  return severity.charAt(0).toUpperCase() + severity.slice(1);
}

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
  const [page, setPage] = useState<ServerPage<AuditLog> | null>(null);
  const [organisations, setOrganisations] = useState<{ id: string; name: string }[]>([]);
  const [failed, setFailed] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const { showError, showSuccess } = useToast();

  const filterApi = useFilterState({ dimensions: AUDIT_FILTERS, scopeKey: 'platform' });
  const { filters, page: pageNumber } = filterApi;

  const query = useMemo<AuditQuery>(() => {
    const window = createdWindowBounds(filterValue(filters, 'when'), new Date());
    return {
      search: filterValue(filters, 'q') || undefined,
      scope: filterValue(filters, 'scope') || undefined,
      severity: filterValues(filters, 'severity').length
        ? [...filterValues(filters, 'severity')]
        : undefined,
      from: window.from,
      to: window.to,
      page: pageNumber,
      pageSize: PAGE_SIZE,
    };
  }, [filters, pageNumber]);

  const requestRef = useRef(0);

  useEffect(() => {
    const ticket = ++requestRef.current;
    setFailed(false);
    void (async () => {
      try {
        const result = await searchPlatformAuditLogs(query);
        if (ticket !== requestRef.current) return;
        setPage(
          serverPage({
            rows: result.rows,
            total: result.total,
            page: pageNumber,
            pageSize: PAGE_SIZE,
          }),
        );
      } catch (err) {
        if (ticket !== requestRef.current) return;
        reportError(err, { area: 'admin:audit' });
        setFailed(true);
      }
    })();
  }, [query, pageNumber, reloadKey]);

  /**
   * The organisation filter's options, loaded once.
   *
   * Every tenant, not the ones that happen to appear in the loaded events —
   * filtering an audit log by an organisation only works if the organisation
   * with no recent events is still in the list, and that is exactly the one
   * somebody is looking for.
   */
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const all = await listOrganisationDirectoryAll({ pageSize: 200 });
        if (!active) return;
        setOrganisations(all.rows.map((row) => ({ id: row.id, name: row.name })));
      } catch (err) {
        // The list still works without it; the filter simply offers fewer
        // options and says nothing it cannot back up.
        reportError(err, { area: 'admin:audit:organisations' });
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const orgById = useMemo(
    () => new Map(organisations.map((o) => [o.id, o])),
    [organisations],
  );

  const optionsFor = useCallback(
    (dimensionId: string): readonly FilterOption[] => {
      switch (dimensionId) {
        case 'scope':
          return [
            { value: 'platform', label: 'Platform events only' },
            ...organisations.map((org) => ({ value: org.id, label: org.name })),
          ];
        case 'severity':
          return SEVERITIES.map((level) => ({
            value: level,
            label: humanSeverity(level),
          }));
        case 'when':
          return CREATED_WINDOWS;
        default:
          return [];
      }
    },
    [organisations],
  );

  const rows = page?.rows ?? [];

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
              className="block truncate text-primary-ink hover:underline dark:text-primary-ink-dark"
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
        key: 'before',
        label: 'Before',
        width: 'w-[8%]',
        cell: (entry) => <ChangeCell value={changeValue(entry, 'before')} muted />,
      },
      {
        key: 'after',
        label: 'After',
        width: 'w-[9%]',
        cell: (entry) => <ChangeCell value={changeValue(entry, 'after')} />,
      },
      {
        key: 'ip',
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

  /**
   * A link, not a saved filter.
   *
   * The old control was a disabled "Save filter" whose own title admitted
   * "Nothing stores a saved filter. There is no table for one". A durable,
   * named, shareable view is a real feature with a table, an owner and an
   * authorisation question behind it, and none of that had been decided. What
   * this screen genuinely has, now that its filters live in the URL, is a
   * bookmarkable address — so the control says that instead of promising the
   * other thing and doing neither.
   */
  const copyLink = useCallback(async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      showSuccess('Link copied. It reopens this exact search.');
    } catch (err) {
      reportError(err, { area: 'admin:audit:copy-link' });
      showError('Could not copy. Use the browser address bar instead.');
    }
  }, [showError, showSuccess]);

  const exportCsv = useCallback(async (): Promise<void> => {
    setExporting(true);
    try {
      const all = await exportPlatformAuditLogs(query);
      const window = createdWindowBounds(filterValue(filters, 'when'), new Date());
      downloadCsv(
        `platform-audit_${new Date().toISOString().slice(0, 10)}`,
        all.rows,
        [
          { label: 'When (UTC)', value: (e) => e.created_at },
          { label: 'Scope', value: (e) => e.scope ?? '' },
          {
            label: 'Organisation',
            value: (e) => orgById.get(e.org_id ?? '')?.name ?? e.org_name ?? '',
          },
          { label: 'Actor', value: (e) => e.actor_name ?? e.actor_email ?? 'System' },
          { label: 'Action', value: (e) => e.action },
          { label: 'Entity', value: (e) => e.entity_type ?? '' },
          { label: 'Before', value: (e) => changeValue(e, 'before') ?? '' },
          { label: 'After', value: (e) => changeValue(e, 'after') ?? '' },
          { label: 'Severity', value: (e) => e.severity ?? '' },
        ],
        {
          // An export is read away from the screen that produced it, so it
          // carries its own scope. An audit file with no stated range is
          // evidence of nothing in particular.
          notes: [
            `RotaFlow platform audit export, generated ${new Date().toISOString()}`,
            `Range: ${window.from ?? 'all time'} to ${window.to ?? 'now'} (UTC)`,
            `Filters: ${
              [
                filterValue(filters, 'q') && `search "${filterValue(filters, 'q')}"`,
                filterValue(filters, 'scope') &&
                  `scope ${filterValue(filters, 'scope') === 'platform' ? 'platform events' : (orgById.get(filterValue(filters, 'scope'))?.name ?? filterValue(filters, 'scope'))}`,
                filterValues(filters, 'severity').length > 0 &&
                  `severity ${filterValues(filters, 'severity').join(', ')}`,
              ]
                .filter(Boolean)
                .join('; ') || 'none'
            }`,
            all.truncated
              ? `TRUNCATED: ${all.rows.length} of ${all.total} matching events. Narrow the range and export again.`
              : `Complete: all ${all.total} matching events.`,
          ],
        },
      );
      if (all.truncated) {
        showError(
          `Exported the first ${all.rows.length.toLocaleString('en-GB')} of ${all.total.toLocaleString('en-GB')} matching events. The file says so, and the range is in its header.`,
        );
      } else {
        showSuccess(
          `Exported all ${all.total.toLocaleString('en-GB')} matching events, timestamps in UTC.`,
        );
      }
    } catch (err) {
      reportError(err, { area: 'admin:audit:export' });
      showError('The export could not be built. Nothing was downloaded.');
    } finally {
      setExporting(false);
    }
  }, [query, filters, orgById, showError, showSuccess]);

  const loading = page === null && !failed;

  return (
    <AdminPage
      title="Audit logs"
      description="Append-only record of every platform-administrator action, searched across the whole history. Records cannot be edited or deleted by anyone, including a Platform Owner."
      action={
        <>
          <Button variant="secondary" onClick={() => void copyLink()}>
            <Link2 size={15} aria-hidden="true" />
            Copy link
          </Button>
          <Button
            variant="secondary"
            onClick={() => void exportCsv()}
            disabled={exporting || (page?.total ?? 0) === 0}
          >
            {exporting ? 'Exporting…' : 'Export CSV'}
          </Button>
        </>
      }
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : loading ? (
        <AdminLoading />
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
            <p>
              The search runs in the database over the whole history. It used to filter
              the two hundred most recent events, so looking for something older found
              nothing and said the filter matched nothing.
            </p>
          </Callout>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-divider p-3 dark:border-divider-dark">
              <FilterBar
                dimensions={AUDIT_FILTERS}
                filters={filters}
                optionsFor={optionsFor}
                onSetValue={filterApi.setValue}
                onSetValues={filterApi.setValues}
                onClearOne={filterApi.clearOne}
                onClearAll={filterApi.clearAll}
                searchPlaceholder="Search action, entity or actor"
                resultSummary={
                  page === null || page.total === 0
                    ? 'No events'
                    : `${page.from.toLocaleString('en-GB')}–${page.to.toLocaleString('en-GB')} of ${page.total.toLocaleString('en-GB')}`
                }
              />
            </div>

            <DataTable
              caption="Platform audit events"
              columns={columns}
              rows={rows}
              rowKey={(entry) => entry.id}
              emptyMessage="No event matches these filters, across the whole history."
              tableClassName="min-w-[70rem]"
            />

            {page && (
              <Pagination
                page={page.page}
                pageCount={page.pageCount}
                total={page.total}
                from={page.from}
                to={page.to}
                onPageChange={filterApi.setPage}
                noun="events"
              />
            )}
          </Card>
        </div>
      )}
    </AdminPage>
  );
}
