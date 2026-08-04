import { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  HelpCircle,
  RefreshCw,
  XCircle,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { AdminPage, AdminStat } from '@/components/admin/AdminPage';
import { runHealthChecks } from '@/services/platformHealthService';
import {
  formatLatency,
  overallStatus,
  statusLabel,
  summarise,
  type HealthCheck,
  type HealthStatus,
} from '@/lib/platformHealth';
import { env } from '@/lib/env';
import { listOpenIncidents } from '@/services/incidentService';
import { SEVERITY_LABELS, type Incident } from '@/lib/incidents';
import { Link } from 'react-router-dom';

const STATUS_TONE: Record<HealthStatus, 'success' | 'warning' | 'danger' | 'neutral'> = {
  operational: 'success',
  degraded: 'warning',
  down: 'danger',
  unknown: 'neutral',
};

function StatusIcon({ status }: { status: HealthStatus }): JSX.Element {
  const common = { size: 18, 'aria-hidden': true } as const;
  switch (status) {
    case 'operational':
      return <CheckCircle2 {...common} className="text-success" />;
    case 'degraded':
      return <AlertTriangle {...common} className="text-warning" />;
    case 'down':
      return <XCircle {...common} className="text-danger" />;
    default:
      return <HelpCircle {...common} className="text-content-muted" />;
  }
}

/**
 * `/admin/platform-health` — NEW_STRUCTURE §34's platform health screen.
 *
 * ## Why every number here is measured, not reported
 *
 * RotaFlow is a static PWA: there is no server of ours to ask for a metric.
 * So rather than render a dashboard of figures nobody computes — the failure
 * mode `AdminFeatureFlagsPage` calls out for feature flags — this runs actual
 * probes from the administrator's own browser and shows what came back.
 *
 * That makes the latencies real but local: they include the viewer's own
 * network, so this answers "can I reach the platform from here, and how fast"
 * rather than "what is the platform's global p95". The page says that on
 * screen, because an administrator reading 120ms should not conclude anything
 * about a care worker's phone on 4G in a basement.
 *
 * Anything a browser genuinely cannot know — error rates, queue depth,
 * background-job health, per-region latency — is listed as not measurable
 * rather than filled in with a plausible-looking number.
 */
export function AdminPlatformHealthPage(): JSX.Element {
  const [checks, setChecks] = useState<HealthCheck[]>([]);
  // Probes answer "is it reachable now". An open incident answers "does
  // somebody already know". Both belong on the page: without the second, the
  // first invites a duplicate investigation of a known problem.
  const [openIncidents, setOpenIncidents] = useState<Incident[]>([]);
  const [running, setRunning] = useState(true);
  const [ranAt, setRanAt] = useState<Date | null>(null);

  const run = useCallback(async (): Promise<void> => {
    setRunning(true);
    const results = await runHealthChecks();
    setChecks(results);
    try {
      setOpenIncidents(await listOpenIncidents());
    } catch {
      // A failure to read incidents must not blank the probe results, which
      // are the reason someone opened this page.
      setOpenIncidents([]);
    }
    setRanAt(new Date());
    setRunning(false);
  }, []);

  useEffect(() => {
    void run();
  }, [run]);

  const live = checks.filter((c) => !c.configuredOnly);
  const configured = checks.filter((c) => c.configuredOnly);
  const overall = overallStatus(live);

  return (
    <AdminPage
      title="Platform health"
      description="Live checks run from this browser against the platform your session is pointed at."
      action={
        <Button variant="secondary" onClick={() => void run()} disabled={running}>
          <RefreshCw
            size={16}
            className={running ? 'animate-spin' : undefined}
            aria-hidden="true"
          />
          {running ? 'Running checks…' : 'Run checks again'}
        </Button>
      }
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <AdminStat
            label="Overall"
            value={statusLabel(overall)}
            hint={summarise(live)}
          />
          <AdminStat
            label="Environment"
            value={env.isProd ? 'Production' : env.mode}
            hint={env.appUrl || 'No VITE_APP_URL set'}
          />
          <AdminStat
            label="App version"
            value={__APP_VERSION__}
            hint="From package.json at build time"
          />
          <AdminStat
            label="Last run"
            value={ranAt ? ranAt.toLocaleTimeString('en-GB') : '—'}
            hint={ranAt ? ranAt.toLocaleDateString('en-GB') : 'Checks have not finished'}
          />
        </div>

        {openIncidents.length > 0 && (
          <Card className="border-danger/40 bg-danger/5">
            <h2 className="mb-1 font-semibold text-content dark:text-content-dark">
              {openIncidents.length} open incident
              {openIncidents.length === 1 ? '' : 's'} — somebody is already on this
            </h2>
            <ul className="mt-2 space-y-1 text-sm text-content-muted dark:text-content-muted-dark">
              {openIncidents.map((incident) => (
                <li key={incident.id}>
                  <span className="font-medium text-content dark:text-content-dark">
                    {SEVERITY_LABELS[incident.severity]}
                  </span>{' '}
                  · {incident.service} — {incident.title}
                </li>
              ))}
            </ul>
            <Link
              to="/admin/incidents"
              className="mt-3 inline-block text-sm font-medium text-primary hover:underline"
            >
              Open incidents
            </Link>
          </Card>
        )}

        <Card>
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-display text-card-heading font-semibold text-content dark:text-content-dark">
              Live checks
            </h2>
            <p className="text-xs text-content-muted dark:text-content-muted-dark">
              Measured from this device, so timings include your own connection.
            </p>
          </div>

          <ul className="divide-y divide-divider dark:divide-divider-dark">
            {live.map((check) => (
              <li
                key={check.name}
                className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0"
              >
                <StatusIcon status={check.status} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-content dark:text-content-dark">
                    {check.name}
                  </p>
                  <p className="text-sm text-content-muted dark:text-content-muted-dark">
                    {check.detail}
                  </p>
                </div>
                <span className="font-mono text-sm tabular-nums text-content-muted dark:text-content-muted-dark">
                  {formatLatency(check.latencyMs)}
                </span>
                <Badge tone={STATUS_TONE[check.status]}>
                  {statusLabel(check.status)}
                </Badge>
              </li>
            ))}
            {live.length === 0 && (
              <li className="py-3 text-sm text-content-muted dark:text-content-muted-dark">
                Running the first pass…
              </li>
            )}
          </ul>
        </Card>

        <Card>
          <h2 className="mb-1 font-display text-card-heading font-semibold text-content dark:text-content-dark">
            Configured services
          </h2>
          <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
            These are read from build configuration, not probed. A key being present
            proves this deployment will try to use the service — not that the far end is
            up.
          </p>
          <ul className="divide-y divide-divider dark:divide-divider-dark">
            {configured.map((check) => (
              <li
                key={check.name}
                className="flex flex-wrap items-start gap-3 py-3 first:pt-0 last:pb-0"
              >
                <StatusIcon status={check.status} />
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-content dark:text-content-dark">
                    {check.name}
                  </p>
                  <p className="text-sm text-content-muted dark:text-content-muted-dark">
                    {check.detail}
                  </p>
                </div>
                <Badge tone={check.status === 'operational' ? 'success' : 'neutral'}>
                  {check.status === 'operational' ? 'Configured' : 'Not configured'}
                </Badge>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="border-warning/30 bg-warning/5">
          <h2 className="mb-1 font-semibold text-content dark:text-content-dark">
            What this page cannot tell you
          </h2>
          <p className="mb-3 text-sm text-content-muted dark:text-content-muted-dark">
            RotaFlow ships as a static bundle with no server of its own, so a browser
            holding the anon key has no way to observe the following. They are listed
            rather than estimated, because a made-up figure on a health page is worse than
            a gap.
          </p>
          <ul className="list-inside list-disc space-y-1 text-sm text-content-muted dark:text-content-muted-dark">
            <li>Platform-wide error rate and request volume</li>
            <li>Background job queue depth and failure counts</li>
            <li>Storage totals and per-tenant usage</li>
            <li>Per-region latency, and latency for anyone other than you</li>
            <li>
              Historical uptime — each visit measures only this moment. What <em>is</em>{' '}
              durable is the incident record, which is why it sits above.
            </li>
          </ul>
          <p className="mt-3 text-sm text-content-muted dark:text-content-muted-dark">
            Those need a collector with service-role access writing to a metrics table, or
            the Supabase project&rsquo;s own observability. Until one exists, treat this
            page as a reachability check rather than a monitoring dashboard.
          </p>
        </Card>
      </div>
    </AdminPage>
  );
}
