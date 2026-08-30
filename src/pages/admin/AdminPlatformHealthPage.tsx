import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { RefreshCw } from 'lucide-react';
import { Panel } from '@/components/ui/Card';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Callout } from '@/components/ui/Callout';
import { MeterRows } from '@/components/ui/MeterRows';
import { StatTile } from '@/components/ui/StatTile';
import { TileGrid } from '@/components/ui/TileGrid';
import { Sparkline } from '@/components/ui/TrendChart';
import { AdminPage } from '@/components/admin/AdminPage';
import { runHealthChecks } from '@/services/platformHealthService';
import {
  getHealthSummary,
  getQueueDepths,
  recordHealthSample,
  type HealthSummaryRow,
} from '@/services/platformFactsService';
import {
  formatLatency,
  overallStatus,
  statusLabel,
  type HealthCheck,
} from '@/lib/platformHealth';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { env } from '@/lib/env';

const ROW_TONE: Record<string, 'success' | 'warning' | 'danger' | 'info' | 'neutral'> = {
  operational: 'success',
  degraded: 'warning',
  outage: 'danger',
  maintenance: 'info',
  down: 'danger',
  unknown: 'neutral',
};

/** How often Watch re-probes, and how many samples it keeps. */
const WATCH_INTERVAL_MS = 60_000;
const HISTORY_LENGTH = 20;

/** Which live probe, if any, backs a row of the services table. */
/**
 * `/admin/platform-health`. Reached from **System Status** in the console rail.
 *
 * ## One screen, one name
 *
 * This route used to be listed twice: "Platform Health" in the primary nav and
 * "System Status" in the secondary, both pointing here. Two names for one screen
 * is something a reader has to discover, so the primary entry is gone and System
 * Status is the way in. The route is unchanged, so every existing link, from
 * the overview, from Integrations. Still resolves.
 *
 * ## Three rows are measured; the rest are not
 *
 * RotaFlow ships as a static bundle with no server of its own, so a browser
 * holding the anon key cannot observe uptime, error rate, queue depth, or the
 * latency of anyone other than the person looking at the screen. What it *can*
 * do is call the platform and time the answer, which is what
 * `runHealthChecks()` does for the database, authentication and realtime.
 *
 * Those rows are marked **Live** and carry a real round trip. The rest are
 * **Configured** — they read an environment variable and say whether a service
 * is wired up, not whether it answers.
 *
 * Nothing on this screen is invented (BUG-059). Uptime and the latency
 * percentiles come from `platform_health_summary` over
 * `platform_health_samples`, and read "Not sampled" where there is nothing to
 * compute from. An invented six-service list, a twelve-slot history strip per
 * service, an error rate, an auth-success rate and a twelve-point latency
 * trend chart were all deleted rather than relabelled — the shape of a trend
 * line is itself a claim, and drawing one from constants is worse than not
 * drawing it.
 *
 * **Watch** re-probes on an interval and keeps the last twenty samples per live
 * check in this tab's memory. Deliberately not persisted: writing one browser's
 * timings into a table and calling it platform uptime would be the fabrication
 * this screen exists to avoid.
 */
export function AdminPlatformHealthPage(): JSX.Element {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  const [running, setRunning] = useState(true);
  const [ranAt, setRanAt] = useState<Date | null>(null);
  const [watching, setWatching] = useState(false);
  const [history, setHistory] = useState<Map<string, number[]>>(new Map());
  const [summary, setSummary] = useState<HealthSummaryRow[]>([]);
  const [queues, setQueues] = useState<
    { queue: string; queued: number; failed: number }[]
  >([]);

  const runRef = useRef<() => Promise<void>>(async () => {});

  const run = useCallback(async (): Promise<void> => {
    setRunning(true);
    const results = await runHealthChecks();
    setChecks(results);
    setRanAt(new Date());

    // Store what was measured. Until this existed, every sample in the table
    // came from the seed and carried `source = 'manual'`, so the uptime figure
    // was arithmetic over rows a human inserted. A console probe is a real
    // measurement from one browser, and is stored saying so.
    for (const check of results) {
      if (check.configuredOnly) continue;
      void recordHealthSample(
        check.name,
        check.status === 'operational' || check.status === 'degraded'
          ? check.status
          : 'down',
        check.latencyMs ?? null,
        'console',
      ).catch(() => undefined);
    }

    void getHealthSummary()
      .then(setSummary)
      .catch(() => setSummary([]));
    void getQueueDepths()
      .then(setQueues)
      .catch(() => setQueues([]));
    setHistory((prev) => {
      const next = new Map(prev);
      for (const check of results) {
        if (check.configuredOnly || check.latencyMs === undefined) continue;
        next.set(
          check.name,
          [...(next.get(check.name) ?? []), check.latencyMs].slice(-HISTORY_LENGTH),
        );
      }
      return next;
    });
    setRunning(false);
  }, []);

  // Assigned in an effect, not during render: mutating a ref while rendering is
  // a side effect, and under StrictMode's double render it runs twice.
  useEffect(() => {
    runRef.current = run;
  }, [run]);

  useEffect(() => {
    void run();
  }, [run]);

  useEffect(() => {
    if (!watching) return;
    const id = setInterval(() => void runRef.current(), WATCH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [watching]);

  const refresh = useCallback(() => void run(), [run]);
  useRegisterConsoleRefresh(refresh);

  const live = useMemo(() => checks.filter((c) => !c.configuredOnly), [checks]);

  /**
   * The measured figures, over the samples this console and any scheduled
   * probe have recorded. Null where nothing has been sampled: an uptime of
   * 100% over zero observations is the most flattering possible reading of
   * having measured nothing.
   */
  const measured = useMemo(() => {
    const withLatency = summary.filter((s) => s.p95_ms !== null);
    const slowest = withLatency.reduce<HealthSummaryRow | null>(
      (worst, row) =>
        worst === null || (row.p95_ms ?? 0) > (worst.p95_ms ?? 0) ? row : worst,
      null,
    );
    const totalSamples = summary.reduce((t, s) => t + (s.samples_24h ?? 0), 0);
    const totalOk = summary.reduce((t, s) => t + (s.ok_24h ?? 0), 0);
    return {
      p95: slowest?.p95_ms ?? null,
      p95Service: slowest?.service ?? null,
      samples: totalSamples,
      uptime:
        totalSamples === 0 ? null : Math.round((totalOk / totalSamples) * 10000) / 100,
      queued: queues.reduce((t, q) => t + q.queued, 0),
      failed: queues.reduce((t, q) => t + q.failed, 0),
    };
  }, [summary, queues]);
  /**
   * One row per service the platform actually has, joined to what has been
   * sampled about it.
   *
   * This replaces a hand-written list of ten services in
   * `adminOverviewDemo.ts` (BUG-059) that invented a status, a latency, an
   * uptime percentage and a twelve-segment history strip for each — including
   * two services that do not exist at all ("Web application", "Analytics", the
   * latter permanently in "maintenance"). Three of the ten carried a
   * `probeKey`, so those showed a real status over an invented history; the
   * other seven were invented end to end.
   *
   * The real list is whatever `runHealthChecks()` returns: three live probes
   * and six configuration checks. `recordHealthSample` stores samples under
   * `check.name`, so `platform_health_summary` joins on the same key with no
   * mapping table in between.
   *
   * Uptime is null, not 100%, where nothing has been sampled — for the reason
   * the `measured` memo below already gives.
   */
  const services = useMemo(() => {
    const aggregates = new Map(summary.map((row) => [row.service, row]));
    return checks.map((check) => {
      const aggregate = aggregates.get(check.name);
      return {
        name: check.name,
        status: check.status,
        detail: check.detail,
        configuredOnly: check.configuredOnly === true,
        latencyMs: check.latencyMs,
        uptime24h: aggregate?.uptime_pct_24h ?? null,
        samples24h: aggregate?.samples_24h ?? 0,
        sparkline: history.get(check.name) ?? [],
      };
    });
  }, [checks, summary, history]);

  /** Only services with latency percentiles worth showing. */
  const sampledLatency = useMemo(
    () => summary.filter((row) => row.p95_ms !== null),
    [summary],
  );

  const overall = overallStatus(live);

  return (
    <AdminPage
      title="System status"
      description="Live service status, latency and queue depth across the RotaFlow estate."
      action={
        <>
          <Button
            variant="secondary"
            onClick={() => setWatching((v) => !v)}
            title={`Re-probe every ${WATCH_INTERVAL_MS / 1000} seconds`}
          >
            {watching ? 'Stop watching' : 'Watch'}
          </Button>
          <Button variant="secondary" onClick={() => void run()} disabled={running}>
            <RefreshCw
              size={15}
              className={running ? 'animate-spin' : undefined}
              aria-hidden="true"
            />
            {running ? 'Running checks…' : 'Run checks again'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <TileGrid>
          <StatTile
            label="Overall. Live"
            value={statusLabel(overall)}
            hint={
              ranAt
                ? `Checked ${ranAt.toLocaleTimeString('en-GB')}`
                : 'Checks have not finished'
            }
          />
          <StatTile
            label="Slowest p95"
            value={
              measured.p95 === null ? 'Not sampled' : `${Math.round(measured.p95)} ms`
            }
            hint={measured.p95Service ?? 'No samples in the last 24 hours'}
          />
          {/* "Error rate" and "Auth success" tiles used to sit here, reading
              0.21% / +0.08pt / 99.7% from adminOverviewDemo.ts. Both are
              deleted rather than relabelled: nothing in this system counts
              errors (Sentry does, and the console cannot query it) and nothing
              records authentication outcomes. Substituting a loosely related
              real number to keep the grid full would fabricate relevance
              instead of data, which is the same problem one step removed. */}
          <StatTile
            label="Queue depth"
            value={measured.queued.toLocaleString('en-GB')}
            hint={
              measured.failed > 0 ? (
                <span className="font-semibold text-danger">
                  {measured.failed} failed
                </span>
              ) : (
                'Nothing failed'
              )
            }
          />
          <StatTile
            label="Uptime, 24 hours"
            value={measured.uptime === null ? 'Not sampled' : `${measured.uptime}%`}
            hint={
              measured.samples === 0
                ? 'Open this screen to take a sample'
                : `${measured.samples} samples`
            }
          />
        </TileGrid>

        <div className="grid gap-4 lg:grid-cols-3">
          <Panel
            className="lg:col-span-2"
            title="Services"
            actions={
              <span className="text-xs text-content-muted dark:text-content-muted-dark">
                uptime over the last 24 hours
              </span>
            }
            flush
          >
            {services.length === 0 ? (
              // The demo list always had ten rows, so this state never
              // existed before and the panel rendered as an empty box on
              // first paint. `checks` is empty until the first probe resolves.
              <p className="px-4 py-3 text-sm text-content-muted dark:text-content-muted-dark">
                {running ? 'Running checks…' : 'No checks returned a result.'}
              </p>
            ) : (
              <ul>
                {services.map((service) => (
                  <li
                    key={service.name}
                    className="flex flex-wrap items-center gap-2.5 border-b border-divider px-4 py-2.5 last:border-0 dark:border-divider-dark"
                  >
                    <span className="text-sm font-semibold text-content dark:text-content-dark">
                      {service.name}
                    </span>
                    <Badge tone={ROW_TONE[service.status] ?? 'neutral'} dot>
                      {statusLabel(service.status)}
                    </Badge>
                    <Badge tone={service.configuredOnly ? 'neutral' : 'info'}>
                      {/* The distinction the old table blurred: a configuration
                        check reads an env var, it does not contact anything. */}
                      {service.configuredOnly ? 'Configured' : 'Live'}
                    </Badge>
                    {!service.configuredOnly && (
                      <span className="font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                        {formatLatency(service.latencyMs)}
                      </span>
                    )}
                    {service.sparkline.length > 1 && (
                      <Sparkline
                        values={service.sparkline}
                        colour="#388FD4"
                        className="mt-0"
                      />
                    )}
                    <span className="ml-auto text-right font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                      {service.uptime24h === null
                        ? 'Not sampled'
                        : `${service.uptime24h}% · ${service.samples24h} samples`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <div className="grid content-start gap-4">
            {/* This was a twelve-point p50/p95/p99 trend chart drawn from
                constants, titled "Placeholder figures" (BUG-059). The shape of
                a time series is the claim — a rising p99 means something — and
                drawing that from invented numbers is worse than not drawing it.
                A real one needs samples over time, and samples are only written
                when an administrator opens this page, so it waits on the
                scheduled probe (GAP-011). The percentiles below are real, over
                whatever has actually been sampled. */}
            <Panel title="Latency, last 24 hours" flush>
              {sampledLatency.length === 0 ? (
                <p className="px-4 py-3 text-sm text-content-muted dark:text-content-muted-dark">
                  Nothing has been sampled in the last 24 hours. Samples are recorded when
                  this page runs its checks, so opening it is currently the only thing
                  that measures anything.
                </p>
              ) : (
                <ul>
                  {sampledLatency.map((row) => (
                    <li
                      key={row.service}
                      className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-divider px-4 py-2.5 last:border-0 dark:border-divider-dark"
                    >
                      <span className="text-sm text-content dark:text-content-dark">
                        {row.service}
                      </span>
                      <span className="ml-auto font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                        p50 {formatLatency(row.p50_ms ?? undefined)} · p95{' '}
                        {formatLatency(row.p95_ms ?? undefined)} · p99{' '}
                        {formatLatency(row.p99_ms ?? undefined)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Background jobs">
              {queues.length === 0 ? (
                <p className="text-sm text-content-muted dark:text-content-muted-dark">
                  Nothing is queued or running.
                </p>
              ) : (
                <MeterRows
                  caption="Background job queues"
                  rows={queues.map((q) => ({
                    label: q.queue,
                    value: q.queued,
                    display:
                      q.failed > 0
                        ? `${q.queued} queued, ${q.failed} failed`
                        : `${q.queued} queued`,
                    colour: q.failed > 0 ? '#E0A030' : undefined,
                  }))}
                />
              )}
            </Panel>
          </div>
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Callout
            tone="warning"
            title="Three rows are probed; the rest report configuration"
          >
            <p>
              RotaFlow ships as a static bundle with no server of its own, so a browser
              holding the anon key cannot observe uptime, error rate, request volume,
              queue depth, or the latency of anyone other than you. It can call the
              platform and time the answer, which is what the rows marked{' '}
              <strong>Live</strong> do. Database, authentication and realtime.
            </p>
            <p>
              The remaining rows are <strong>configuration</strong> checks: they read an
              environment variable and report whether a service is wired up, not whether
              it is answering. Nothing on this page is invented any more — every uptime
              percentage and percentile is computed from{' '}
              <code>platform_health_samples</code>, and reads &ldquo;Not sampled&rdquo;
              rather than 100% where there is nothing to compute from.
            </p>
            <p>
              That honesty has a cost worth knowing: samples are only written when
              somebody opens this page, so the figures describe the moments an
              administrator happened to look. A scheduled probe is not running yet.{' '}
              <strong>Watch</strong> keeps the last twenty samples in this tab for the
              sparklines; those are not stored, because one browser&rsquo;s timings are
              not platform uptime.
            </p>
          </Callout>

          <Panel title="Incidents are recorded elsewhere">
            <p className="text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
              The register lives on{' '}
              <Link to="/admin/incidents" className="text-primary hover:underline">
                Incidents
              </Link>
              , backed by the <code>incidents</code> table: severity, affected service,
              owner, a timeline of updates and a resolution note that the database
              requires before an incident can close.
            </p>
            <p className="mt-2 text-sm leading-relaxed text-content-muted dark:text-content-muted-dark">
              What is still absent is the public status page. <code>is_public</code>{' '}
              exists on the table and no policy grants anonymous access, so it is a stored
              intent rather than a live switch. Publishing means a second surface with its
              own hosting and its own audience. Environment:{' '}
              {env.isProd ? 'production' : env.mode}, app v{__APP_VERSION__}.
            </p>
          </Panel>
        </div>
      </div>
    </AdminPage>
  );
}
