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
  declareIncident,
  listIncidents,
  resolveIncident,
  type Incident,
  type IncidentSeverity,
} from '@/services/incidentService';
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
            {rows.length === 0 ? (
              <AdminEmpty message="No incident has been declared." />
            ) : (
              <div className="overflow-x-auto">
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
                    {rows.map((incident) => (
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
                          {incident.status !== 'resolved' && canManagePlatformConfig && (
                            <Button
                              size="sm"
                              variant="secondary"
                              onClick={() => setResolving(incident)}
                            >
                              Resolve
                            </Button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
    </AdminPage>
  );
}
