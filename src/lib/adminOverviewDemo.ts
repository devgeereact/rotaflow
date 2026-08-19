/**
 * PLACEHOLDER DATA FOR `/admin`, NOT REAL, AND NOT DERIVED FROM ANYTHING.
 *
 * ============================================================================
 * Every value in this file is invented. It exists so the platform overview can
 * be built to the full shape of `docs/PLATFORM_CONSOLE.html` before the schema
 * can supply the figures, and it is expected to be deleted.
 * ============================================================================
 *
 * ## What is fabricated, and why it could not be computed
 *
 * - **Revenue / MRR**, `subscriptions` records a plan and a status but no
 *   amount, and no payment provider is connected. There is nothing to total.
 * - **Active users today**, `profiles` has no last-seen column and Supabase
 *   does not expose `auth.users.last_sign_in_at` to a client.
 * - **Named plan tiers** (Free … Enterprise). Plans are free text per
 *   organisation; this deployment has no plan catalogue.
 * - **Organisation health** (Healthy / Attention / At risk), `organisations`
 *   has `status`, which is an account state, not a health signal. Nothing
 *   computes risk.
 * - **Per-service uptime history**, a browser cannot observe another user's
 *   latency, and nothing stores a history. `/admin/platform-health` measures
 *   this device, live, and says so.
 * - **Support cases**. There is no `support_cases` table and no inbound
 *   channel writing to one.
 *
 * ## Removing it
 *
 * Delete this file and the imports of `DEMO_*` in `AdminOverviewPage`. Anything
 * that then fails to compile is a section that was never backed by data, which
 * is exactly the list of work still to do. The real figures already on that
 * screen. Organisation counts, growth from `created_at`, plan and status
 * breakdowns, the audit feed, support-access sessions. Do not come from here.
 */

/** Marks a card whose figures are placeholder, for the on-screen notice. */
export const DEMO_SECTIONS = ['System health history'] as const;

export const DEMO_ACTIVE_USERS_TODAY = 12_489;
export const DEMO_ACTIVE_USERS_SHARE = '25.6% of all users';
export const DEMO_ACTIVE_USERS_TREND = [
  10_820, 11_240, 10_990, 11_680, 12_010, 11_870, 12_489,
];

export const DEMO_PUBLISHED_ROTAS_TREND = [
  7_100, 7_480, 7_690, 8_020, 8_310, 8_640, 8_942,
];
export const DEMO_USERS_TREND = [41_200, 42_600, 43_800, 44_900, 46_100, 47_300, 48_726];

export const DEMO_SUBSCRIPTION_MIX = [
  { label: 'Free', value: 186, colour: '#6B7280' },
  { label: 'Starter', value: 341, colour: '#388FD4' },
  { label: 'Professional', value: 402, colour: '#3B6FE0' },
  { label: 'Business', value: 264, colour: '#1EA06B' },
  { label: 'Enterprise', value: 91, colour: '#E0A030' },
] as const;

export const DEMO_ORG_HEALTH = [
  { label: 'Healthy', value: 1_042, colour: '#1EA06B' },
  { label: 'Attention', value: 118, colour: '#E0A030' },
  { label: 'At risk', value: 82, colour: '#D94A3A' },
  { label: 'Suspended', value: 42, colour: '#6B7280' },
] as const;

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

export interface DemoActivity {
  icon: 'building' | 'card' | 'key' | 'flag' | 'plug';
  tone: DemoActivityTone;
  title: string;
  meta: string;
}

export const DEMO_ACTIVITY: readonly DemoActivity[] = [
  {
    icon: 'building',
    tone: 'success',
    title: 'Brightpath Nurseries created an organisation',
    meta: 'Starter trial · 6 minutes ago',
  },
  {
    icon: 'card',
    tone: 'info',
    title: 'Cardiff Retail Partners upgraded Business → Enterprise',
    meta: '£640 → £1,180 MRR · 41 minutes ago',
  },
  {
    icon: 'building',
    tone: 'danger',
    title: 'Harbour Logistics UK suspended',
    meta: 'Chargeback unresolved · 2 hours ago',
  },
  {
    icon: 'key',
    tone: 'warning',
    title: 'Support access granted to Mersey Domiciliary Care',
    meta: 'Idris Okafor · 60 minutes · case RF-4796',
  },
  {
    icon: 'flag',
    tone: 'info',
    title: 'new_rota_builder rollout raised to 12%',
    meta: 'Idris Okafor · 3 hours ago',
  },
  {
    icon: 'plug',
    tone: 'danger',
    title: 'BrightHR sync failed for 27 organisations',
    meta: 'Retry scheduled · 41 minutes ago',
  },
];

export interface DemoCase {
  priority: 'Urgent' | 'High' | 'Normal';
  subject: string;
  meta: string;
}

export const DEMO_OPEN_CASES = 5;
export const DEMO_URGENT_CASES = 1;

export const DEMO_CASES: readonly DemoCase[] = [
  {
    priority: 'Urgent',
    subject: 'Rota publish fails for 3 locations',
    meta: 'Tayside Community Trust · 14 minutes ago',
  },
  {
    priority: 'High',
    subject: 'Clock-in GPS rejecting on-site staff',
    meta: 'Sunnyvale Care Group · 52 minutes ago',
  },
  {
    priority: 'Normal',
    subject: 'Invoice VAT number incorrect',
    meta: 'Cardiff Retail Partners · 3 hours ago',
  },
];

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

/** Counts the reference shows that no column can produce. */
export const DEMO_ORGS_TRIAL = 86;
export const DEMO_ORGS_TRIAL_HINT = '22 converting this week';
export const DEMO_ORGS_AT_RISK = 82;
export const DEMO_ORGS_AT_RISK_HINT = 'no activity in 14 days';
export const DEMO_ORGS_NEW_CHANGE = '+18% vs July';

/* ---------------------------------------------------------------------------
 * `/admin/users`
 * ------------------------------------------------------------------------- */

/**
 * Account status, MFA state and last sign-in.
 *
 * All three live in Supabase's `auth` schema. `auth.users` is reachable only
 * through the Auth Admin API from a service-role Edge Function, and a static
 * client holding the anon key cannot read it, so `profiles` has no
 * `last_sign_in_at`, no `banned_until` and no factor list to join against.
 *
 * Derived from the account id so a row keeps the same invented values through
 * sorting and filtering.
 */
export interface DemoUserFacts {
  disabled: boolean;
  verified: boolean;
  mfa: boolean;
  lastLogin: string;
}

const DEMO_LAST_LOGIN = [
  '4 minutes ago',
  '2 minutes ago',
  'just now',
  '6 days ago',
  '22 minutes ago',
  '34 days ago',
  '48 minutes ago',
  '1 hour ago',
  '19 minutes ago',
  '3 hours ago',
] as const;

export function demoUserFacts(id: string, index: number): DemoUserFacts {
  const seed = index + id.charCodeAt(0);
  return {
    // One disabled and one unverified account in any reasonable list, so the
    // states the screen has to render are actually visible.
    disabled: seed % 11 === 3,
    verified: seed % 7 !== 2,
    mfa: seed % 3 !== 1,
    lastLogin: DEMO_LAST_LOGIN[seed % DEMO_LAST_LOGIN.length] ?? 'today',
  };
}

/** Tile counts the reference shows that `profiles` alone cannot produce. */
export const DEMO_USERS_ACTIVE = 46_104;
export const DEMO_USERS_ACTIVE_SHARE = '94.6%';
export const DEMO_USERS_INACTIVE_90 = 1_884;
export const DEMO_USERS_UNVERIFIED = 412;
export const DEMO_USERS_UNVERIFIED_HINT = 'invite not accepted';
export const DEMO_USERS_SUSPENDED = 326;

/* ---------------------------------------------------------------------------
 * `/admin/support`. The case queue
 *
 * There is no `support_cases` table and no inbound channel writing to one, so
 * cases, priorities, assignment, response targets and CSAT are all invented.
 * The support *access* screen beside this one is real: those sessions exist in
 * `support_access_sessions` and every figure on that page is computed.
 * ------------------------------------------------------------------------- */

export type DemoCasePriority = 'Urgent' | 'High' | 'Normal' | 'Low';
export type DemoCaseStatus = 'open' | 'awaiting_customer' | 'resolved';

export interface DemoSupportCase {
  ref: string;
  priority: DemoCasePriority;
  subject: string;
  category: string;
  organisation: string;
  requester: string;
  assigned: string;
  status: DemoCaseStatus;
  updated: string;
}

export const DEMO_CASE_STATUS_LABEL: Record<DemoCaseStatus, string> = {
  open: 'Open',
  awaiting_customer: 'Awaiting customer',
  resolved: 'Resolved',
};

export const DEMO_SUPPORT_CASES: readonly DemoSupportCase[] = [
  {
    ref: 'RF-4821',
    priority: 'Urgent',
    subject: 'Rota publish fails for 3 locations',
    category: 'Rota builder',
    organisation: 'Tayside Community Trust',
    requester: 'Alison Frame',
    assigned: 'Sarah Okonjo',
    status: 'open',
    updated: '14 minutes ago',
  },
  {
    ref: 'RF-4819',
    priority: 'High',
    subject: 'Clock-in GPS rejecting on-site staff',
    category: 'Attendance',
    organisation: 'Sunnyvale Care Group',
    requester: 'Marcus Bell',
    assigned: 'Idris Okafor',
    status: 'open',
    updated: '52 minutes ago',
  },
  {
    ref: 'RF-4814',
    priority: 'Normal',
    subject: 'Invoice VAT number incorrect',
    category: 'Billing',
    organisation: 'Cardiff Retail Partners',
    requester: 'Ffion Davies',
    assigned: 'Leah Marchetti',
    status: 'awaiting_customer',
    updated: '3 hours ago',
  },
  {
    ref: 'RF-4809',
    priority: 'High',
    subject: 'Payroll export missing night premiums',
    category: 'Integrations',
    organisation: 'Northgate Hospitality',
    requester: 'Priya Raman',
    assigned: 'Sarah Okonjo',
    status: 'open',
    updated: '5 hours ago',
  },
  {
    ref: 'RF-4802',
    priority: 'Low',
    subject: 'Request to extend trial by 14 days',
    category: 'Subscription',
    organisation: 'Belfast Care Collective',
    requester: 'Sean Callaghan',
    assigned: 'Leah Marchetti',
    status: 'awaiting_customer',
    updated: '1 day ago',
  },
  {
    ref: 'RF-4796',
    priority: 'Normal',
    subject: 'Staff cannot accept shift swap on iOS',
    category: 'Mobile',
    organisation: 'Ashford Security Services',
    requester: 'Grace Nkemdi',
    assigned: 'Idris Okafor',
    status: 'resolved',
    updated: '2 days ago',
  },
  {
    ref: 'RF-4790',
    priority: 'Urgent',
    subject: 'Account suspended in error after chargeback',
    category: 'Account',
    organisation: 'Harbour Logistics UK',
    requester: 'Tomas Nowak',
    assigned: 'Sarah Okonjo',
    status: 'resolved',
    updated: '3 days ago',
  },
];

export const DEMO_MEDIAN_FIRST_RESPONSE = '34m';
export const DEMO_RESPONSE_TARGET = 'target 1h';
export const DEMO_MEDIAN_RESOLUTION = '6h 12m';
export const DEMO_URGENT_TARGET = '1h response target';
export const DEMO_CSAT = '4.6 / 5';
export const DEMO_CSAT_HINT = '184 ratings, 30 days';

/** Consent refusals are not recorded, `request_support_access` just refuses. */
export const DEMO_DENIED_BY_OWNER = 2;

/* ---------------------------------------------------------------------------
 * System status (`/admin/platform-health`) and `/admin/integrations`
 *
 * RotaFlow is a static PWA: there is no server of ours to ask for a metric, and
 * a browser holding the anon key cannot observe uptime, error rates, queue
 * depth, another user's latency, or anything at all about a service it does not
 * itself call. The three live probes the console really does run. Database,
 * auth, realtime. Are measured and marked as such on the screen; everything
 * else here is invented.
 * ------------------------------------------------------------------------- */

export const DEMO_UPTIME = '99.94%';
export const DEMO_UPTIME_TARGET = 'target 99.95%';
export const DEMO_API_P95 = '142 ms';
export const DEMO_API_P95_TREND = [128, 134, 131, 140, 152, 147, 142];
export const DEMO_ERROR_RATE = '0.21%';
export const DEMO_ERROR_RATE_CHANGE = '+0.08pt';
export const DEMO_AUTH_SUCCESS = '99.7%';
export const DEMO_QUEUE_DEPTH = 1_284;
export const DEMO_QUEUE_HINT = 'backlog rising';
export const DEMO_PUSH_DELIVERY = '94.1%';
export const DEMO_PUSH_HINT = 'APNs degraded';

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

export const DEMO_BACKGROUND_JOBS = [
  { label: 'Rota publish', value: 412, display: '412 queued' },
  { label: 'Payroll export', value: 184, display: '184 queued', colour: '#E0A030' },
  { label: 'Notifications', value: 688, display: '688 queued' },
  { label: 'Failed, 24h', value: 31, display: '31 failed', colour: '#D94A3A' },
] as const;

export interface DemoConnector {
  name: string;
  category: string;
  organisations: number;
  status: 'operational' | 'degraded';
  successRate: number;
  lastSync: string;
  failed: number;
}

export const DEMO_CONNECTORS: readonly DemoConnector[] = [
  {
    name: 'Sage Payroll',
    category: 'Payroll',
    organisations: 412,
    status: 'operational',
    successRate: 99.4,
    lastSync: '6 minutes ago',
    failed: 3,
  },
  {
    name: 'Xero',
    category: 'Payroll',
    organisations: 288,
    status: 'operational',
    successRate: 99.8,
    lastSync: '2 minutes ago',
    failed: 0,
  },
  {
    name: 'BrightHR',
    category: 'HR',
    organisations: 194,
    status: 'degraded',
    successRate: 91.2,
    lastSync: '41 minutes ago',
    failed: 27,
  },
  {
    name: 'Google Calendar',
    category: 'Calendar',
    organisations: 706,
    status: 'operational',
    successRate: 99.9,
    lastSync: '1 minute ago',
    failed: 1,
  },
  {
    name: 'Microsoft 365',
    category: 'Identity',
    organisations: 521,
    status: 'operational',
    successRate: 99.7,
    lastSync: '3 minutes ago',
    failed: 2,
  },
  {
    name: 'Slack',
    category: 'Communication',
    organisations: 338,
    status: 'operational',
    successRate: 99.6,
    lastSync: '4 minutes ago',
    failed: 2,
  },
  {
    name: 'Outbound webhooks',
    category: 'Webhooks',
    organisations: 96,
    status: 'degraded',
    successRate: 87.5,
    lastSync: '18 minutes ago',
    failed: 44,
  },
  {
    name: 'PostHog',
    category: 'Analytics',
    organisations: 1_284,
    status: 'operational',
    successRate: 99.9,
    lastSync: 'just now',
    failed: 0,
  },
];

export const DEMO_ORGS_CONNECTED = 1_043;
export const DEMO_ORGS_CONNECTED_HINT = '81% of tenants';
export const DEMO_SYNCS_24H = 184_206;
export const DEMO_FAILED_24H = 79;
export const DEMO_FAILED_24H_HINT = '0.04%';
export const DEMO_DEGRADED_HINT = 'BrightHR, webhooks';
export const DEMO_MEDIAN_SYNC = '2.4 s';

/* ---------------------------------------------------------------------------
 * `/admin/notifications`. Platform announcements
 *
 * `notifications` rows are addressed to one user inside one organisation, and
 * the table has no client insert policy by design. There is no platform-wide
 * message, no audience definition, no fan-out and no schedule, so the
 * announcement register below is invented. The per-notification delivery
 * summary on that screen is real.
 * ------------------------------------------------------------------------- */

export type DemoAnnouncementStatus = 'pending' | 'complete';

export interface DemoAnnouncement {
  title: string;
  type: string;
  audience: string;
  when: string;
  sent: number | null;
  read: number | null;
  status: DemoAnnouncementStatus;
}

export const DEMO_ANNOUNCEMENTS: readonly DemoAnnouncement[] = [
  {
    title: 'Scheduled maintenance-10 Aug, 02:00-03:00 BST',
    type: 'Maintenance',
    audience: 'All organisations',
    when: 'Scheduled 08 Aug 2026',
    sent: null,
    read: null,
    status: 'pending',
  },
  {
    title: 'New: cost forecasting in Reports',
    type: 'Product release',
    audience: 'Business, Enterprise',
    when: 'Sent 29 Jul 2026',
    sent: 355,
    read: 241,
    status: 'complete',
  },
  {
    title: 'Action needed: card expiring this month',
    type: 'Billing',
    audience: '96 organisations',
    when: 'Sent 25 Jul 2026',
    sent: 96,
    read: 88,
    status: 'complete',
  },
  {
    title: 'Resolved: sign-in outage on 22 July',
    type: 'Platform incident',
    audience: 'All organisations',
    when: 'Sent 22 Jul 2026',
    sent: 1_284,
    read: 1_102,
    status: 'complete',
  },
];

export const DEMO_SENT_30_DAYS = 1_735;
export const DEMO_DELIVERED = '99.2%';
export const DEMO_READ_RATE = '82.4%';
export const DEMO_READ_TREND = [71, 74, 76, 79, 80, 81, 82];
export const DEMO_NOTIFICATIONS_FAILED = 14;
export const DEMO_NOTIFICATIONS_FAILED_HINT = 'invalid addresses';
export const DEMO_SCHEDULED = 1;
export const DEMO_SCHEDULED_HINT = 'maintenance, 10 Aug';
export const DEMO_OPT_OUTS = 38;

/* ---------------------------------------------------------------------------
 * `/admin/feature-flags`
 *
 * There is no `feature_flags` table and no service to read one, so per-tenant
 * flags. Key, rollout percentage, target plans, target organisations,
 * scheduled activation. Are all invented. The two real switches on that screen
 * (`registration_enabled`, `maintenance_mode`) come from `platform_settings`.
 * ------------------------------------------------------------------------- */

export interface DemoFeatureFlag {
  name: string;
  key: string;
  description: string;
  enabled: boolean;
  rollout: number;
  environment: 'Production' | 'Staging' | 'Development';
  critical: boolean;
  targets: string;
  updated: string;
  updatedBy: string;
}

export const DEMO_FEATURE_FLAGS: readonly DemoFeatureFlag[] = [
  {
    name: 'AI rota assistant',
    key: 'ai_rota_assistant',
    description: 'Draft-rota suggestions from the OpenRouter edge function.',
    enabled: true,
    rollout: 35,
    environment: 'Production',
    critical: true,
    targets: 'Business, Enterprise',
    updated: '02 Aug 2026',
    updatedBy: 'Idris Okafor',
  },
  {
    name: 'Advanced reporting',
    key: 'advanced_reporting',
    description: 'Cost, coverage and absence analytics beyond the standard pack.',
    enabled: true,
    rollout: 100,
    environment: 'Production',
    critical: false,
    targets: 'Professional and above',
    updated: '28 Jul 2026',
    updatedBy: 'Sarah Okonjo',
  },
  {
    name: 'GPS clock-in',
    key: 'gps_clock_in',
    description: 'Geofenced attendance capture on the staff PWA.',
    enabled: true,
    rollout: 100,
    environment: 'Production',
    critical: true,
    targets: 'All plans',
    updated: '14 Jun 2026',
    updatedBy: 'Idris Okafor',
  },
  {
    name: 'Shift swap automation',
    key: 'shift_swap_automation',
    description: 'Auto-approve swaps that break no rule and no cost ceiling.',
    enabled: false,
    rollout: 0,
    environment: 'Production',
    critical: false,
    targets: 'Enterprise',
    updated: '19 Jul 2026',
    updatedBy: 'Sarah Okonjo',
  },
  {
    name: 'New rota builder',
    key: 'new_rota_builder',
    description: 'Rebuilt drag-and-drop grid with keyboard-first editing.',
    enabled: true,
    rollout: 12,
    environment: 'Production',
    critical: true,
    targets: 'Opt-in organisations',
    updated: '03 Aug 2026',
    updatedBy: 'Idris Okafor',
  },
  {
    name: 'Beta integrations',
    key: 'beta_integrations',
    description: 'Unreleased payroll and HR connectors.',
    enabled: false,
    rollout: 0,
    environment: 'Staging',
    critical: false,
    targets: 'Internal only',
    updated: '11 Jul 2026',
    updatedBy: 'Sarah Okonjo',
  },
];

/* ------------------------------------------------------------------ *
 * GDPR & Data
 * ------------------------------------------------------------------ */

/** Personal-data breaches reported. No table records one; see the screen note. */
export const DEMO_BREACHES_REPORTED = 0;

/* ------------------------------------------------------------------ *
 * Platform settings. The six tabs with nothing behind them
 * ------------------------------------------------------------------ */

/**
 * One row of a settings tab that this deployment cannot actually store.
 *
 * `kind` decides what is drawn on the right: a value (`text`), a switch that
 * shows state and refuses to change (`switch`), or a button that is disabled
 * (`action`). Nothing here writes, because there is no column to write to.
 */
export interface DemoSettingRow {
  label: string;
  hint: string;
  value: string;
  kind: 'text' | 'switch' | 'action';
  on?: boolean;
}

export const DEMO_BRANDING: readonly DemoSettingRow[] = [
  {
    label: 'Platform logo',
    hint: 'Shown in the console rail and on every transactional email.',
    value: 'Replace',
    kind: 'action',
  },
  {
    label: 'Primary colour',
    hint: 'Brand blue used for actions and active state across both surfaces.',
    value: '#3B6FE0',
    kind: 'text',
  },
  {
    label: 'Favicon',
    hint: 'Browser tab icon for the customer app and this console.',
    value: 'Replace',
    kind: 'action',
  },
  {
    label: 'Support branding',
    hint: 'Show RotaFlow branding on customer-facing support replies.',
    value: '',
    kind: 'switch',
    on: true,
  },
];

export const DEMO_SECURITY: readonly DemoSettingRow[] = [
  {
    label: 'Require MFA for platform administrators',
    hint: 'Non-negotiable for Owner and Administrator roles.',
    value: '',
    kind: 'switch',
    on: true,
  },
  {
    label: 'Administrator session timeout',
    hint: 'Idle time before the console locks.',
    value: '30 minutes',
    kind: 'text',
  },
  {
    label: 'IP allowlist',
    hint: 'Only these ranges may reach /admin. Four ranges configured.',
    value: 'Manage',
    kind: 'action',
  },
  {
    label: 'Sign-in alerts',
    hint: 'Email every administrator when a new device signs in to the console.',
    value: '',
    kind: 'switch',
    on: true,
  },
  {
    label: 'Maximum concurrent sessions',
    hint: 'Per administrator account.',
    value: '2',
    kind: 'text',
  },
  {
    label: 'Re-authenticate for critical actions',
    hint: 'Suspensions, deletions, flag changes and role changes.',
    value: '',
    kind: 'switch',
    on: true,
  },
];

export const DEMO_EMAIL: readonly DemoSettingRow[] = [
  {
    label: 'Sender name',
    hint: 'Shown as the From name.',
    value: 'RotaFlow',
    kind: 'text',
  },
  {
    label: 'Provider',
    hint: 'Custom SMTP, configured in the Supabase dashboard rather than here.',
    value: 'Custom SMTP',
    kind: 'text',
  },
  {
    label: 'Delivery status',
    hint: 'Last 24 hours: 4,182 sent, 12 bounced, 0 complaints.',
    value: 'Healthy',
    kind: 'text',
  },
  {
    label: 'Send test email',
    hint: 'Delivers to the signed-in administrator.',
    value: 'Send test',
    kind: 'action',
  },
];

export const DEMO_STORAGE_USAGE: readonly {
  label: string;
  value: number;
  display: string;
}[] = [
  { label: 'Documents', value: 412, display: '412 GB' },
  { label: 'Avatars', value: 38, display: '38 GB' },
  { label: 'Exports', value: 96, display: '96 GB' },
  { label: 'Backups', value: 684, display: '684 GB' },
];

export const DEMO_STORAGE_LIMITS: readonly DemoSettingRow[] = [
  {
    label: 'Maximum file size',
    hint: 'Per upload, across all tenants.',
    value: '25 MB',
    kind: 'text',
  },
  {
    label: 'Permitted types',
    hint: 'Everything else is rejected at upload.',
    value: 'pdf, png, jpg, csv, xlsx',
    kind: 'text',
  },
];

export const DEMO_API: readonly DemoSettingRow[] = [
  {
    label: 'Public API',
    hint: 'Tenant-scoped REST API for payroll and HR systems.',
    value: '',
    kind: 'switch',
    on: true,
  },
  {
    label: 'Rate limit',
    hint: 'Requests per minute, per organisation.',
    value: '600 / min',
    kind: 'text',
  },
  {
    label: 'Webhook retries',
    hint: 'Exponential backoff before an endpoint is marked failing.',
    value: '5 attempts',
    kind: 'text',
  },
  {
    label: 'API keys issued',
    hint: 'Across 96 organisations.',
    value: 'Manage keys',
    kind: 'action',
  },
];

/* ------------------------------------------------------------------ *
 * Organisation and user detail
 * ------------------------------------------------------------------ */

/**
 * The organisation attributes the console reference shows that RotaFlow does
 * not record.
 *
 * `organisations` has a name, a slug, a plan, a status and a settings jsonb,
 * no industry, no country, no timezone and no account-health grade. Every row
 * built from this constant is drawn with a "placeholder" chip beside it, so a
 * reader never has to work out which half of the panel is real.
 *
 * The same values are shown for every tenant, deliberately: varying them by
 * organisation would make them look derived from something.
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

/**
 * The account attributes the reference shows on a user that this schema does
 * not carry.
 *
 * `profiles` has a name, an email, an avatar and timestamps. Whether the
 * address was verified, when the person last signed in, and whether MFA is
 * enrolled all live in `auth.users`, which a client holding the anon key
 * cannot read, an Edge Function would have to expose them deliberately.
 */
export const DEMO_USER_ACCOUNT: readonly { label: string; value: string }[] = [
  { label: 'Email verified', value: 'Verified' },
  { label: 'Last login', value: '4 minutes ago' },
  { label: 'MFA', value: 'Enforced' },
];

/* ------------------------------------------------------------------ *
 * Incidents
 * ------------------------------------------------------------------ */

export interface DemoIncident {
  id: string;
  title: string;
  impact: string;
  severity: 'Critical' | 'High' | 'Medium' | 'Low';
  status: 'investigating' | 'monitoring' | 'resolved';
  service: string;
  started: string;
  ended: string | null;
  owner: string;
}

/**
 * The incident register, in full.
 *
 * There is no `incidents` table in any migration, so every row here is
 * invented. The screen exists anyway because an incident register is a
 * decision about process, who declares, who owns, what the public status page
 * says, and having the shape on screen is what makes that decision concrete.
 * Nothing on it writes: Declare and Resolve are disabled, and the page says so
 * above the table.
 */
export const DEMO_INCIDENTS: readonly DemoIncident[] = [
  {
    id: 'INC-0142',
    title: 'Elevated push notification failures (APNs)',
    impact: '≈8% of staff devices did not receive shift-change pushes for 46 minutes.',
    severity: 'High',
    status: 'monitoring',
    service: 'Push notifications',
    started: '04 Aug 2026 07:14',
    ended: null,
    owner: 'Idris Okafor',
  },
  {
    id: 'INC-0141',
    title: 'Database read replica lag above 30s',
    impact: 'Reports and exports served stale figures; writes unaffected.',
    severity: 'Medium',
    status: 'investigating',
    service: 'PostgreSQL database',
    started: '04 Aug 2026 05:52',
    ended: null,
    owner: 'Sarah Okonjo',
  },
  {
    id: 'INC-0139',
    title: 'Payroll export queue backlog',
    impact: '412 payroll exports delayed by up to 3h 25m. All completed.',
    severity: 'Medium',
    status: 'resolved',
    service: 'Background jobs',
    started: '31 Jul 2026 22:10',
    ended: '01 Aug 2026 01:35',
    owner: 'Idris Okafor',
  },
  {
    id: 'INC-0138',
    title: 'Sign-in outage. Auth provider certificate expiry',
    impact: 'All sign-ins failed for 38 minutes across every tenant.',
    severity: 'Critical',
    status: 'resolved',
    service: 'Authentication',
    started: '22 Jul 2026 09:03',
    ended: '22 Jul 2026 09:41',
    owner: 'Sarah Okonjo',
  },
];

export const DEMO_INCIDENT_CRITICAL_90 = 1;
export const DEMO_INCIDENT_MTTD = '4m 20s';
export const DEMO_INCIDENT_MTTR = '1h 06m';
export const DEMO_INCIDENTS_THIS_MONTH = 4;
export const DEMO_INCIDENTS_MONTH_CHANGE = '−2';
