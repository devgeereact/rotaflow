import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import {
  AdminEmpty,
  AdminError,
  AdminLoading,
  AdminPage,
} from '@/components/admin/AdminPage';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/useToast';
import {
  addIncidentUpdate,
  declareIncident,
  listIncidentUpdates,
  listIncidents,
  resolveIncident,
  type Incident,
  type IncidentSeverity,
  type IncidentStatus,
  type IncidentUpdate,
} from '@/services/incidentService';
import { FilterBar } from '@/components/ui/FilterBar';
import { useFilterState } from '@/hooks/useFilterState';
import {
  filterValue,
  matchesFilters,
  matchesSearch,
  type FilterDimension,
  type FilterOption,
} from '@/lib/filters';
import {
  criticalsSince,
  formatDuration,
  meanTimeToDetect,
  meanTimeToResolve,
  monthOverMonth,
  openIncidents,
  startedLastMonth,
  startedThisMonth,
} from '@/lib/incidentMetrics';
import { reportError } from '@/lib/sentry';
import { ScrollRegion } from '@/components/ui/ScrollRegion';

const SEVERITY_TONE: Record<string, BadgeTone> = {
  critical: 'danger',
  high: 'warning',
  medium: 'info',
  low: 'neutral',
};

const STATUS_TONE: Record<string, BadgeTone> = {
  investigating: 'danger',
  identified: 'warning',
  monitoring: 'warning',
  resolved: 'success',
};

const SEVERITIES: IncidentSeverity[] = ['critical', 'high', 'medium', 'low'];

/** Capitalised for display without a lookup table per value. */
function titleCase(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function stamp(iso: string): string {
  return new Date(iso).toLocaleString('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * `/admin/incidents`. The incident register (0021).
 *
 * ## Every figure here is derived, none is stored
 *
 * Open, criticals in 90 days, mean time to detect, mean time to resolve and the
 * month-over-month change are all computed from the rows by
 * `src/lib/incidentMetrics.ts`. Nothing caches them, because a cached average
 * is one that can disagree with the table printed underneath it.
 *
 * A mean over an empty set reads as "-", not as zero: an estimate of zero
 * minutes to resolve would be the most flattering possible reading of having
 * measured nothing.
 *
 * ## What is still not built
 *
 * The public status page. `incidents.is_public` exists and no policy grants
 * anonymous access, so setting it changes nothing until someone decides who
 * outside this console may read the register, a second surface with its own
 * hosting and its own audience.
 */
/**
 * Filters on the shared contract (`src/lib/filters.ts`), which this screen had
 * none of: the register showed every incident ever declared, newest first, with
 * no way to ask "which are still open" — the one question an operator opens
 * this page to answer.
 */
const INCIDENT_FILTERS: readonly FilterDimension[] = [
  { id: 'q', label: 'Search', kind: 'text' },
  { id: 'status', label: 'Status', kind: 'multi' },
  { id: 'severity', label: 'Severity', kind: 'multi' },
] as const;

const INCIDENT_STATUS_OPTIONS: readonly FilterOption[] = [
  { value: 'investigating', label: 'Investigating' },
  { value: 'identified', label: 'Identified' },
  { value: 'monitoring', label: 'Monitoring' },
  { value: 'resolved', label: 'Resolved' },
] as const;

const INCIDENT_SEVERITY_OPTIONS: readonly FilterOption[] = [
  { value: 'critical', label: 'Critical' },
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
] as const;

const INCIDENT_ACCESSORS = {
  status: (item: Incident) => item.status,
  severity: (item: Incident) => item.severity,
};

function incidentOptionsFor(dimensionId: string): readonly FilterOption[] {
  if (dimensionId === 'status') return INCIDENT_STATUS_OPTIONS;
  if (dimensionId === 'severity') return INCIDENT_SEVERITY_OPTIONS;
  return [];
}

/** The states an incident moves through before it is resolved. */
const NEXT_STATUSES: readonly Exclude<IncidentStatus, 'resolved'>[] = [
  'investigating',
  'identified',
  'monitoring',
] as const;

export function AdminIncidentsPage(): JSX.Element {
  const { canManagePlatformConfig } = usePermissions();
  const { showError, showSuccess } = useToast();

  const [rows, setRows] = useState<Incident[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [declaring, setDeclaring] = useState(false);
  const [resolving, setResolving] = useState<Incident | null>(null);
  const [busy, setBusy] = useState(false);

  const [form, setForm] = useState({
    title: '',
    impact: '',
    severity: 'medium' as IncidentSeverity,
    service: '',
  });
  const [resolution, setResolution] = useState('');

  const filterApi = useFilterState({
    dimensions: INCIDENT_FILTERS,
    scopeKey: 'platform',
  });
  const filters = filterApi.filters;

  /**
   * The timeline, and the control that writes to it.
   *
   * `add_incident_update` and `listIncidentUpdates` both existed and had NO
   * caller anywhere in the tree, so an incident could be declared and resolved
   * and nothing in between could ever be recorded — the `identified` and
   * `monitoring` states were unreachable, and `incident_updates` was a table
   * that could only ever hold the rows `declare_incident` and
   * `resolve_incident` write themselves.
   */
  const [timelineFor, setTimelineFor] = useState<Incident | null>(null);
  const [timeline, setTimeline] = useState<IncidentUpdate[] | null>(null);
  const [updateStatus, setUpdateStatus] =
    useState<Exclude<IncidentStatus, 'resolved'>>('identified');
  const [updateBody, setUpdateBody] = useState('');

  useEffect(() => {
    let active = true;
    setFailed(false);
    setRows(null);
    void (async () => {
      try {
        const data = await listIncidents();
        if (active) setRows(data);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'admin:incidents' });
        setFailed(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [reloadKey]);

  const retry = useCallback(() => setReloadKey((k) => k + 1), []);
  useRegisterConsoleRefresh(retry);

  /**
   * Filtered in the browser, deliberately.
   *
   * `listIncidents` caps at 100 and this set is bounded by how many incidents a
   * platform declares — tens, over years, not thousands. That bound is stated
   * rather than assumed, which is the rule for keeping a list client-filtered:
   * if the register ever approaches the cap this needs the server-side
   * treatment `0130` gave the organisations directory, and the "N of M" line
   * below is what would show it.
   */
  const visibleRows = useMemo(() => {
    const all = rows ?? [];
    const q = filterValue(filters, 'q');
    return all.filter(
      (incident) =>
        matchesFilters(incident, filters, INCIDENT_ACCESSORS) &&
        matchesSearch([incident.reference, incident.title, incident.service], q),
    );
  }, [rows, filters]);

  /** Open the timeline for one incident, loading it on demand. */
  const openTimeline = useCallback(
    async (incident: Incident): Promise<void> => {
      setTimelineFor(incident);
      setTimeline(null);
      setUpdateBody('');
      setUpdateStatus(
        incident.status === 'resolved'
          ? 'monitoring'
          : (incident.status as Exclude<IncidentStatus, 'resolved'>),
      );
      try {
        setTimeline(await listIncidentUpdates(incident.id));
      } catch (err) {
        reportError(err);
        setTimeline([]);
        showError('Could not load that incident timeline.');
      }
    },
    [showError],
  );

  /**
   * Post an update. The status moves with it, which is what
   * `add_incident_update` does in one statement — so the register cannot
   * disagree with its own timeline about what state an incident is in.
   */
  const postUpdate = useCallback(async (): Promise<void> => {
    if (timelineFor === null) return;
    const body = updateBody.trim();
    if (body.length < 3) {
      showError('An update needs a sentence saying what changed.');
      return;
    }
    setBusy(true);
    try {
      await addIncidentUpdate(timelineFor.id, updateStatus, body);
      setUpdateBody('');
      // Reload both, and await them before saying anything: the toast must
      // describe what the database holds, not what was sent.
      const [fresh, updated] = await Promise.all([
        listIncidentUpdates(timelineFor.id),
        listIncidents(),
      ]);
      setTimeline(fresh);
      setRows(updated);
      setTimelineFor(updated.find((i) => i.id === timelineFor.id) ?? timelineFor);
      showSuccess('Update posted.');
    } catch (err) {
      reportError(err);
      showError(err instanceof Error ? err.message : 'Could not post that update.');
    } finally {
      setBusy(false);
    }
  }, [timelineFor, updateBody, updateStatus, showError, showSuccess]);

  const metrics = useMemo(() => {
    const all = rows ?? [];
    const now = new Date();
    return {
      open: openIncidents(all),
      criticals: criticalsSince(all, now),
      mttd: meanTimeToDetect(all),
      mttr: meanTimeToResolve(all),
      thisMonth: startedThisMonth(all, now),
      change: monthOverMonth(startedThisMonth(all, now), startedLastMonth(all, now)),
    };
  }, [rows]);

  const declare = useCallback(async () => {
    setBusy(true);
    try {
      await declareIncident(form);
      showSuccess(`Incident declared: ${form.title}`);
      setDeclaring(false);
      setForm({ title: '', impact: '', severity: 'medium', service: '' });
      retry();
    } catch (err) {
      reportError(err, { area: 'admin:incidents:declare' });
      showError(err instanceof Error ? err.message : 'Could not declare the incident.');
    } finally {
      setBusy(false);
    }
  }, [form, retry, showError, showSuccess]);

  const resolve = useCallback(async () => {
    if (!resolving) return;
    setBusy(true);
    try {
      await resolveIncident(resolving.id, resolution);
      showSuccess(`${resolving.reference} resolved.`);
      setResolving(null);
      setResolution('');
      retry();
    } catch (err) {
      reportError(err, { area: 'admin:incidents:resolve' });
      showError(err instanceof Error ? err.message : 'Could not resolve the incident.');
    } finally {
      setBusy(false);
    }
  }, [resolving, resolution, retry, showError, showSuccess]);

  return (
    <AdminPage
      title="Incidents"
      description="Open and historic platform incidents, their blast radius and their resolution."
      action={
        <Button
          onClick={() => setDeclaring(true)}
          disabled={!canManagePlatformConfig}
          title={
            canManagePlatformConfig
              ? undefined
              : 'Only platform staff can declare an incident'
          }
        >
          Declare incident
        </Button>
      }
    >
      {failed ? (
        <AdminError onRetry={retry} />
      ) : rows === null ? (
        <AdminLoading variant="tiles" rows={4} />
      ) : (
        <div className="space-y-4">
          <TileGrid>
            <StatTile label="Open" value={metrics.open} hint="Not yet resolved" />
            <StatTile
              label="Critical, 90 days"
              value={metrics.criticals}
              hint="By start date"
            />
            <StatTile
              label="Mean time to detect"
              value={formatDuration(metrics.mttd)}
              hint="Start to detection"
            />
            <StatTile
              label="Mean time to resolve"
              value={formatDuration(metrics.mttr)}
              hint="Resolved incidents only"
            />
            <StatTile
              label="Incidents this month"
              value={metrics.thisMonth}
              hint={
                <>
                  <span
                    className={`font-semibold ${
                      metrics.change.startsWith('+')
                        ? 'text-danger-ink dark:text-danger-ink-dark'
                        : 'text-success-ink dark:text-success-ink-dark'
                    }`}
                  >
                    {metrics.change}
                  </span>{' '}
                  vs last month
                </>
              }
            />
            <StatTile
              label="Status page"
              value="Not built"
              hint="No public surface yet"
            />
          </TileGrid>

          <Card className="overflow-hidden p-0">
            <div className="border-b border-divider px-4 py-3 dark:border-divider-dark">
              <h2 className="text-card-heading font-semibold text-content dark:text-content-dark">
                Incident register
              </h2>
            </div>
            <div className="border-b border-divider p-3 dark:border-divider-dark">
              <FilterBar
                dimensions={INCIDENT_FILTERS}
                filters={filters}
                optionsFor={incidentOptionsFor}
                onSetValue={filterApi.setValue}
                onSetValues={filterApi.setValues}
                onClearOne={filterApi.clearOne}
                onClearAll={filterApi.clearAll}
                searchPlaceholder="Search reference, title or service"
                resultSummary={`${visibleRows.length} of ${rows.length}`}
              />
            </div>
            {rows.length === 0 ? (
              <AdminEmpty message="No incident has been declared." />
            ) : visibleRows.length === 0 ? (
              // A filter that matches nothing is not an empty register, and the
              // two sentences must differ or the operator distrusts the data
              // rather than the filter.
              <AdminEmpty message="No incident matches these filters." />
            ) : (
              <ScrollRegion label="Incidents">
                <table className="w-full table-fixed text-sm">
                  <caption className="sr-only">
                    Platform incidents, most recent first
                  </caption>
                  <thead>
                    <tr className="border-b border-divider text-left text-2xs uppercase tracking-wide text-content-muted dark:border-divider-dark dark:text-content-muted-dark">
                      {(
                        [
                          ['ID', 'w-[8%]'],
                          ['Title', 'w-[26%]'],
                          ['Severity', 'w-[10%]'],
                          ['Status', 'w-[11%]'],
                          ['Service', 'w-[13%]'],
                          ['Started', 'w-[13%]'],
                          ['Duration', 'w-[9%]'],
                          ['', 'w-[10%]'],
                        ] as const
                      ).map(([label, width]) => (
                        <th
                          key={label}
                          scope="col"
                          className={`px-3 py-2 font-medium ${width}`}
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((incident) => (
                      <tr
                        key={incident.id}
                        className="border-b border-divider align-top last:border-0 dark:border-divider-dark"
                      >
                        <td className="px-3 py-2.5 font-mono text-xs text-content-muted dark:text-content-muted-dark">
                          {incident.reference}
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-semibold text-content dark:text-content-dark">
                            {incident.title}
                          </p>
                          <p className="mt-0.5 text-xs leading-relaxed text-content-muted dark:text-content-muted-dark">
                            {incident.impact}
                          </p>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={SEVERITY_TONE[incident.severity] ?? 'neutral'} dot>
                            {titleCase(incident.severity)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5">
                          <Badge tone={STATUS_TONE[incident.status] ?? 'neutral'} dot>
                            {titleCase(incident.status)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2.5 text-content dark:text-content-dark">
                          {incident.service}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-content-muted dark:text-content-muted-dark">
                          {stamp(incident.started_at)}
                        </td>
                        <td className="px-3 py-2.5 font-mono text-xs tabular-nums text-content dark:text-content-dark">
                          {incident.resolved_at
                            ? formatDuration(
                                (Date.parse(incident.resolved_at) -
                                  Date.parse(incident.started_at)) /
                                  60_000,
                              )
                            : '-'}
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => void openTimeline(incident)}
                            >
                              Timeline
                            </Button>
                            {incident.status !== 'resolved' &&
                              canManagePlatformConfig && (
                                <Button
                                  size="sm"
                                  variant="secondary"
                                  onClick={() => setResolving(incident)}
                                >
                                  Resolve
                                </Button>
                              )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollRegion>
            )}
          </Card>

          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            Times are derived from each incident&rsquo;s own timestamps, not stored. The
            closest record of what platform staff did is the{' '}
            <Link
              to="/admin/audit"
              className="text-primary-ink underline underline-offset-2 dark:text-primary-ink-dark"
            >
              audit log
            </Link>
            ; measured service state is on{' '}
            <Link
              to="/admin/platform-health"
              className="text-primary-ink underline underline-offset-2 dark:text-primary-ink-dark"
            >
              System status
            </Link>
            .
          </p>
        </div>
      )}

      <Modal
        open={declaring}
        onClose={() => setDeclaring(false)}
        title="Declare an incident"
      >
        <div className="grid gap-3">
          <div>
            <Label htmlFor="incident-title">What is broken, in plain English</Label>
            <Input
              id="incident-title"
              value={form.title}
              onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))}
              className="mt-1"
            />
          </div>
          <div>
            <Label htmlFor="incident-impact">Who is affected, and how</Label>
            <textarea
              id="incident-impact"
              rows={3}
              value={form.impact}
              onChange={(e) => setForm((f) => ({ ...f, impact: e.target.value }))}
              className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-content dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
            />
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="incident-severity">Severity</Label>
              <Select
                id="incident-severity"
                value={form.severity}
                onChange={(e) =>
                  setForm((f) => ({ ...f, severity: e.target.value as IncidentSeverity }))
                }
                className="mt-1"
              >
                {SEVERITIES.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="incident-service">Affected service</Label>
              <Input
                id="incident-service"
                value={form.service}
                onChange={(e) => setForm((f) => ({ ...f, service: e.target.value }))}
                className="mt-1"
                placeholder="Authentication"
              />
            </div>
          </div>
          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            Declaring writes an audit row and opens the timeline. The detection time is
            stamped now, if it was noticed earlier, say so in the first update.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeclaring(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => void declare()}
              disabled={
                busy || !form.title.trim() || !form.impact.trim() || !form.service.trim()
              }
            >
              Declare incident
            </Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={resolving !== null}
        onClose={() => setResolving(null)}
        title={resolving ? `Resolve ${resolving.reference}?` : 'Resolve'}
      >
        <Label htmlFor="incident-resolution">What fixed it</Label>
        <textarea
          id="incident-resolution"
          rows={4}
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-content dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
        />
        <p className="mt-2 text-xs text-content-muted dark:text-content-muted-dark">
          Required. A resolved incident with no resolution is a gap in the mean time to
          resolve and in every review that reads it later.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setResolving(null)}>
            Cancel
          </Button>
          <Button onClick={() => void resolve()} disabled={busy || !resolution.trim()}>
            Mark resolved
          </Button>
        </div>
      </Modal>

      {/* The timeline, and the only way to reach `identified` and `monitoring`.
          Both states have existed in the CHECK since 0021 and neither was
          reachable: `add_incident_update` had no caller anywhere in the tree,
          so an incident went from declared straight to resolved and the story
          in between was never recorded. */}
      <Modal
        open={timelineFor !== null}
        onClose={() => setTimelineFor(null)}
        title={timelineFor ? `${timelineFor.reference} timeline` : 'Timeline'}
      >
        {timeline === null ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Loading the timeline…
          </p>
        ) : timeline.length === 0 ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Nothing has been posted yet. The first update is what tells anyone reading
            later what was happening between the declaration and the fix.
          </p>
        ) : (
          <ol className="space-y-3">
            {timeline.map((entry) => (
              <li
                key={entry.id}
                className="border-l-2 border-divider pl-3 dark:border-divider-dark"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={STATUS_TONE[entry.status] ?? 'neutral'} dot>
                    {entry.status}
                  </Badge>
                  <span className="font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                    {new Date(entry.created_at).toLocaleString('en-GB')}
                  </span>
                </div>
                <p className="mt-1 text-sm text-content dark:text-content-dark">
                  {entry.body}
                </p>
              </li>
            ))}
          </ol>
        )}

        {timelineFor !== null &&
          timelineFor.status !== 'resolved' &&
          canManagePlatformConfig && (
            <div className="mt-4 border-t border-divider pt-4 dark:border-divider-dark">
              <Label htmlFor="incident-update-status">New status</Label>
              <Select
                id="incident-update-status"
                value={updateStatus}
                onChange={(e) =>
                  setUpdateStatus(e.target.value as Exclude<IncidentStatus, 'resolved'>)
                }
                className="mt-1"
              >
                {NEXT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {value.charAt(0).toUpperCase() + value.slice(1)}
                  </option>
                ))}
              </Select>

              <Label htmlFor="incident-update-body" className="mt-3 block">
                What changed
              </Label>
              <textarea
                id="incident-update-body"
                rows={3}
                value={updateBody}
                onChange={(e) => setUpdateBody(e.target.value)}
                className="mt-1 w-full rounded-lg border border-surface-border bg-surface px-3 py-2 text-sm text-content dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
              />
              <p className="mt-2 text-xs text-content-muted dark:text-content-muted-dark">
                The status moves with the update, in one statement, so the register cannot
                disagree with its own timeline.
              </p>
              <div className="mt-3 flex justify-end">
                <Button
                  onClick={() => void postUpdate()}
                  disabled={busy || updateBody.trim().length < 3}
                >
                  Post update
                </Button>
              </div>
            </div>
          )}
      </Modal>
    </AdminPage>
  );
}
