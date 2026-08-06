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
import { Sparkline, TrendChart } from '@/components/ui/TrendChart';
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
  type HealthStatus,
} from '@/lib/platformHealth';
import {
  DEMO_AUTH_SUCCESS,
  DEMO_ERROR_RATE,
  DEMO_ERROR_RATE_CHANGE,
  DEMO_LATENCY_LABELS,
  DEMO_LATENCY_P50,
  DEMO_LATENCY_P95,
  DEMO_LATENCY_P99,
  DEMO_SERVICE_ROWS,
  type DemoServiceRow,
} from '@/lib/adminOverviewDemo';
import { useRegisterConsoleRefresh } from '@/hooks/useConsoleRefresh';
import { env } from '@/lib/env';

const SEGMENT = {
  operational: 'bg-success',
  degraded: 'bg-warning',
  outage: 'bg-danger',
} as const;

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
function probeFor(row: DemoServiceRow, checks: HealthCheck[]): HealthCheck | undefined {
  if (!row.probeKey) return undefined;
  return checks.find((c) => c.name.toLowerCase().includes(row.probeKey ?? ''));
}

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
 * Those rows are marked **Live** and carry a real round trip. Everything else,
 * the other services, every uptime percentage, the twelve-slot history strips,
 * the latency percentiles and the job queues, is placeholder from
 * `src/lib/adminOverviewDemo.ts`.
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
          <StatTile
            label="Error rate"
            value={DEMO_ERROR_RATE}
            hint={
              <>
                <span className="font-semibold text-danger">
                  {DEMO_ERROR_RATE_CHANGE}
                </span>{' '}
                in 24h
              </>
            }
          />
          <StatTile label="Auth success" value={DEMO_AUTH_SUCCESS} />
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
                last 12 hours
              </span>
            }
            flush
          >
            <ul>
              {DEMO_SERVICE_ROWS.map((row) => {
                const probe = probeFor(row, live);
                const status = probe ? probe.status : row.status;
                const latency = probe
                  ? formatLatency(probe.latencyMs)
                  : row.latencyMs === null
                    ? '-'
                    : `${row.latencyMs} ms`;
                const samples = probe ? (history.get(probe.name) ?? []) : [];
                return (
                  <li
                    key={row.name}
                    className="flex flex-wrap items-center gap-2.5 border-b border-divider px-4 py-2.5 last:border-0 dark:border-divider-dark"
                  >
                    <span className="text-sm font-semibold text-content dark:text-content-dark">
                      {row.name}
                    </span>
                    <Badge tone={ROW_TONE[status] ?? 'neutral'} dot>
                      {status === 'maintenance'
                        ? 'Maintenance'
                        : statusLabel(status as HealthStatus)}
                    </Badge>
                    {probe && <Badge tone="info">Live</Badge>}
                    <span className="font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                      {latency}
                    </span>
                    {samples.length > 1 && (
                      <Sparkline values={samples} colour="#388FD4" className="mt-0" />
                    )}
                    <span className="ml-auto flex items-center gap-3">
                      <span className="flex gap-[2px]" aria-hidden="true">
                        {row.history.map((state, i) => (
                          <span
                            key={i}
                            className={`block h-[18px] w-[4px] rounded-sm ${SEGMENT[state]}`}
                          />
                        ))}
                      </span>
                      <span className="w-14 text-right font-mono text-xs tabular-nums text-content-muted dark:text-content-muted-dark">
                        {row.uptime}
                      </span>
                    </span>
                  </li>
                );
              })}
            </ul>
          </Panel>

          <div className="grid content-start gap-4">
            <Panel title="API latency">
              <TrendChart
                title="API latency percentiles over twelve hours. Placeholder figures"
                labels={[...DEMO_LATENCY_LABELS]}
                series={[
                  { name: 'p50', values: DEMO_LATENCY_P50, colour: '#3B6FE0' },
                  {
                    name: 'p95',
                    values: DEMO_LATENCY_P95,
                    colour: '#E0A030',
                    lineOnly: true,
                  },
                  {
                    name: 'p99',
                    values: DEMO_LATENCY_P99,
                    colour: '#D94A3A',
                    lineOnly: true,
                  },
                ]}
                height={150}
              />
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
          <Callout tone="warning" title="Three rows are measured; the rest are not">
            <p>
              RotaFlow ships as a static bundle with no server of its own, so a browser
              holding the anon key cannot observe uptime, error rate, request volume,
              queue depth, or the latency of anyone other than you. It can call the
              platform and time the answer, which is what the rows marked{' '}
              <strong>Live</strong> do. Database, authentication and realtime.
            </p>
            <p>
              Everything else here. The other services, every uptime percentage, the
              history strips, the latency percentiles and the job queues, is placeholder
              from <code>src/lib/adminOverviewDemo.ts</code>. <strong>Watch</strong> keeps
              the last twenty live samples in this tab only; nothing is stored, because
              one browser&rsquo;s timings are not platform uptime.
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
              What is still absent is the public status page. <code>is_public</code>
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
