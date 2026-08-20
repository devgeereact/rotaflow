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
 * - **Organisation industry / usage / last-activity** (`demoOrgFacts`,
 *   `/admin/organisations`) — none of the three is a column, and usage would
 *   need a plan seat/shift ceiling that doesn't exist as a denominator.
 * - **Organisation detail extras** (`DEMO_ORG_PROFILE`, `DEMO_ORG_STORAGE`) —
 *   `organisations` has no industry, country, timezone, health grade or
 *   storage figure.
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
 * `/admin/organisations`
 * ------------------------------------------------------------------------- */

/**
 * Industry, usage and last-activity per organisation.
 *
 * None of the three exists:
 *
 * - **Industry** is not a column on `organisations` and there is no taxonomy.
 * - **Usage** would need a plan with a seat or shift ceiling to be a percentage
 *   *of* something. No plan carries a limit, so there is no denominator.
 * - **Last activity** would need a per-tenant last-write timestamp. Nothing
 *   maintains one, and deriving it would mean touching every tenant-scoped
 *   table on every page load.
 *
 * Keyed by slug so a demo row follows the organisation it was invented for
 * rather than whichever happens to sort into that position.
 */
export interface DemoOrgFacts {
  industry: string;
  /** Percentage of an imaginary allowance. */
  usage: number;
  lastActivity: string;
}

const DEMO_INDUSTRIES = [
  'Residential care',
  'Hospitality',
  'Domiciliary care',
  'Retail',
  'Healthcare',
  'Childcare',
  'Logistics',
  'Security',
  'Facilities',
] as const;

const DEMO_LAST_ACTIVITY = [
  '4 minutes ago',
  '22 minutes ago',
  '6 days ago',
  '11 minutes ago',
  '2 minutes ago',
  '1 hour ago',
  '34 days ago',
  '48 minutes ago',
  '3 hours ago',
] as const;

/** Stable per-organisation placeholder, derived from the id so it never moves. */
export function demoOrgFacts(id: string, index: number): DemoOrgFacts {
  const seed = index + id.charCodeAt(0);
  return {
    industry: DEMO_INDUSTRIES[seed % DEMO_INDUSTRIES.length] ?? 'Residential care',
    usage: [92, 74, 41, 88, 96, 28, 0, 63, 34][seed % 9] ?? 50,
    lastActivity: DEMO_LAST_ACTIVITY[seed % DEMO_LAST_ACTIVITY.length] ?? 'today',
  };
}

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

/**
 * The organisation attributes the console reference shows that RotaFlow does
 * not record.
 *
 * `organisations` has a name, a slug, a plan, a status and a settings jsonb,
 * no industry, no country, no timezone and no account-health grade. Every row
 * built from this constant is drawn with a "placeholder" chip beside it, so a
 * reader never has to work out which half of the panel is real.
 */
export const DEMO_ORG_PROFILE: readonly { label: string; value: string }[] = [
  { label: 'Industry', value: 'Residential care' },
  { label: 'Country', value: 'United Kingdom' },
  { label: 'Timezone', value: 'Europe/London' },
  { label: 'Account health', value: 'Healthy' },
  { label: 'Last activity', value: '4 minutes ago' },
];

/** Storage consumed by one tenant. No file storage is wired up, so nothing measures this. */
export const DEMO_ORG_STORAGE = '14.2 GB';

/* ---------------------------------------------------------------------------
 * `/admin/support-access`
 * ------------------------------------------------------------------------- */

/** Consent refusals are not recorded, `request_support_access` just refuses. */
export const DEMO_DENIED_BY_OWNER = 2;
