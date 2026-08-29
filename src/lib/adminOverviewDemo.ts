/**
 * PLACEHOLDER DATA FOR `/admin`, NOT REAL, AND NOT DERIVED FROM ANYTHING.
 *
 * ============================================================================
 * Every value in this file is invented, for the domains that still have
 * nothing real behind them. It is not a blanket statement about the whole
 * `/admin` surface: `/admin/users`, `/admin/integrations`,
 * `/admin/feature-flags`, `/admin/notifications`, `/admin/incidents` and
 * `/admin/settings` all now read real tables through their own services
 * (`platformService`, `integrationService`, `platformSettingsService`, …) and
 * do not import this file at all. Stripe billing (migration `0050`) is
 * connected, `plans` is a real catalogue, and MRR/churn/revenue are computed
 * for real in `src/lib/revenue.ts` and `src/lib/platformOverview.ts`.
 *
 * Prior versions of this file carried mock data for those now-real screens
 * (fabricated org/user counts, a fake support-case queue, a fake connector
 * list, a fake feature-flag list, a fake incident register). All of it was
 * dead code once those screens were wired to real data — deleted rather than
 * left as an unused, misleading fixture. `git log -- src/lib/adminOverviewDemo.ts`
 * has the full history if any of it is ever needed again.
 * ============================================================================
 *
 * ## What is still fabricated here, and why it could not be computed
 *
 * - **System health history** (`DEMO_SERVICES`, `/admin` overview) and the
 *   **platform-health extras** (`DEMO_SERVICE_ROWS`, latency percentiles,
 *   `/admin/platform-health`) — a browser cannot observe another user's
 *   latency or another service's history, and nothing stores one. The three
 *   probes that page genuinely runs (database, auth, realtime) are real and
 *   marked as such on screen; everything else there is invented.
 * Removed by BUG-026, and worth recording so nobody reinstates them: this
 * file used to invent an industry, a usage percentage and a last-activity
 * string per organisation, plus an org-detail panel of industry / country /
 * timezone / account health / last activity and a "14.2 GB" storage figure.
 * Industry, country, timezone and `last_activity_at` are all real columns
 * now, account health is computed by `tenantHealth.healthBand`, and the two
 * that measure nothing — usage percentage and storage — were deleted rather
 * than relabelled. An administrator acts on what this console tells them, so
 * a plausible-looking invention is worse here than an absent field.
 * - **Support-access refusal count** (`DEMO_DENIED_BY_OWNER`) — refusals are
 *   not recorded anywhere; `request_support_access` just refuses.
 *
 * ## Removing a section
 *
 * Delete the constants for that domain and their imports. Anything that then
 * fails to compile is a screen still drawing from here.
 */

/** Marks a card whose figures are placeholder, for the on-screen notice. */
export const DEMO_SECTIONS = ['System health history'] as const;

export type DemoServiceState = 'operational' | 'degraded' | 'outage';

export interface DemoService {
  name: string;
  status: DemoServiceState;
  /** Twelve slots, oldest first, one per hour. */
  history: DemoServiceState[];
}

const OK: DemoServiceState = 'operational';
const WARN: DemoServiceState = 'degraded';

export const DEMO_SERVICES: readonly DemoService[] = [
  { name: 'Web application', status: OK, history: Array<DemoServiceState>(12).fill(OK) },
  {
    name: 'API',
    status: OK,
    history: [OK, OK, OK, OK, OK, OK, WARN, OK, OK, OK, OK, OK],
  },
  {
    name: 'Authentication',
    status: OK,
    history: Array<DemoServiceState>(12).fill(OK),
  },
  {
    name: 'PostgreSQL database',
    status: WARN,
    history: [OK, OK, OK, OK, WARN, WARN, WARN, OK, OK, WARN, WARN, WARN],
  },
  { name: 'File storage', status: OK, history: Array<DemoServiceState>(12).fill(OK) },
  {
    name: 'Email delivery',
    status: OK,
    history: [OK, OK, WARN, OK, OK, OK, OK, OK, OK, OK, OK, OK],
  },
];

export type DemoActivityTone = 'success' | 'info' | 'warning' | 'danger';

/* ---------------------------------------------------------------------------
 * System status (`/admin/platform-health`)
 *
 * RotaFlow is a static PWA: there is no server of ours to ask for a metric, and
 * a browser holding the anon key cannot observe uptime, error rates, queue
 * depth, another user's latency, or anything at all about a service it does not
 * itself call. The three live probes the console really does run — database,
 * auth, realtime — are measured and marked as such on the screen; everything
 * else here is invented.
 * ------------------------------------------------------------------------- */

export const DEMO_ERROR_RATE = '0.21%';
export const DEMO_ERROR_RATE_CHANGE = '+0.08pt';
export const DEMO_AUTH_SUCCESS = '99.7%';

export interface DemoServiceRow {
  name: string;
  status: DemoServiceState | 'maintenance';
  /** Round-trip in milliseconds, or null where nothing is measured. */
  latencyMs: number | null;
  uptime: string;
  history: DemoServiceState[];
  /** The three the console genuinely probes from this browser. */
  probeKey?: 'database' | 'auth' | 'realtime';
}

const S = (pattern: string): DemoServiceState[] =>
  [...pattern].map((c) =>
    c === 'w' ? 'degraded' : c === 'b' ? 'outage' : 'operational',
  );

export const DEMO_SERVICE_ROWS: readonly DemoServiceRow[] = [
  {
    name: 'Web application',
    status: 'operational',
    latencyMs: 118,
    uptime: '99.99%',
    history: S('oooooooooooo'),
  },
  {
    name: 'API',
    status: 'operational',
    latencyMs: 142,
    uptime: '99.97%',
    history: S('oooooowooooo'),
  },
  {
    name: 'Authentication',
    status: 'operational',
    latencyMs: 96,
    uptime: '99.99%',
    history: S('oooooooooooo'),
    probeKey: 'auth',
  },
  {
    name: 'PostgreSQL database',
    status: 'degraded',
    latencyMs: 311,
    uptime: '99.82%',
    history: S('ooooowwwoowww'.slice(0, 12)),
    probeKey: 'database',
  },
  {
    name: 'File storage',
    status: 'operational',
    latencyMs: 174,
    uptime: '99.98%',
    history: S('oooooooooooo'),
  },
  {
    name: 'Email delivery',
    status: 'operational',
    latencyMs: 402,
    uptime: '99.94%',
    history: S('oowooooooooo'),
  },
  {
    name: 'Push notifications',
    status: 'degraded',
    latencyMs: 688,
    uptime: '99.41%',
    history: S('owwoowwwoowww'.slice(0, 12)),
  },
  {
    name: 'Background jobs',
    status: 'operational',
    latencyMs: 230,
    uptime: '99.96%',
    history: S('oooooooooooo'),
  },
  {
    name: 'Realtime',
    status: 'operational',
    latencyMs: 88,
    uptime: '99.99%',
    history: S('oooooooooooo'),
    probeKey: 'realtime',
  },
  {
    name: 'Analytics',
    status: 'maintenance',
    latencyMs: null,
    uptime: '99.10%',
    history: S('ooooooobbbb').concat(['outage']),
  },
];

export const DEMO_LATENCY_LABELS = [
  '−11h',
  '−10h',
  '−9h',
  '−8h',
  '−7h',
  '−6h',
  '−5h',
  '−4h',
  '−3h',
  '−2h',
  '−1h',
  'now',
] as const;
export const DEMO_LATENCY_P50 = [62, 64, 61, 68, 72, 70, 66, 71, 69, 74, 73, 70];
export const DEMO_LATENCY_P95 = [
  128, 134, 131, 140, 152, 147, 142, 168, 159, 171, 166, 142,
];
export const DEMO_LATENCY_P99 = [
  240, 252, 244, 268, 301, 288, 272, 340, 318, 352, 336, 281,
];

/* ---------------------------------------------------------------------------
 * Organisation detail
 * ------------------------------------------------------------------------- */

/* ---------------------------------------------------------------------------
 * `/admin/support-access`
 * ------------------------------------------------------------------------- */

/** Consent refusals are not recorded, `request_support_access` just refuses. */
export const DEMO_DENIED_BY_OWNER = 2;
