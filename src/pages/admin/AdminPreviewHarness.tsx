import { useMemo, useState } from 'react';
import { AdminShell } from '@/components/layout/AdminShell';
import { OrgContext, type OrgContextValue } from '@/context/OrgContext';

/**
 * Design-loop harness for `/admin/*`, **development only**.
 *
 * ## Why this exists
 *
 * Every platform console screen needs a signed-in platform administrator and a
 * seeded deployment, so none of them could be opened, screenshotted or reviewed
 * during the rebuild. Eleven phases were verified by typecheck, lint and tests
 * and never once looked at, which is how an orphaned tile and a row of
 * colourless callouts survived to be reported by a human instead of caught in
 * the loop.
 *
 * The org app solves this with per-screen preview pages that render a
 * presentational component against fixtures. That pattern needs every page
 * split into view and container first, and it verifies the *view* rather than
 * the page. This takes the other route: it mounts the **real** `AdminShell` and
 * the **real** page components, and intercepts `fetch` so the Supabase client
 * answers from fixtures. What renders here is what renders in production, minus
 * the data.
 *
 * ## Scope of the deception
 *
 * The interception is installed on mount and never removed. The harness is
 * expected to own the tab. It only answers PostgREST reads; anything it does
 * not recognise falls through to the real network, so an unmocked call fails
 * loudly rather than silently rendering an empty screen.
 *
 * It is inside `import.meta.env.DEV` in the route table, which Vite replaces
 * with `false` at build time, so Rollup drops this module and its fixtures out
 * of the production bundle entirely. That gate is not optional: an earlier
 * generation of preview pages shipped to production and answered 200
 * unauthenticated (see the block comment in `App.tsx`).
 */

const ISO = (daysAgo: number): string =>
  new Date(Date.UTC(2026, 7, 5) - daysAgo * 86_400_000).toISOString();

const ORG_IDS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
  '66666666-6666-4666-8666-666666666666',
];
const USER_IDS = [
  'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
  'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
  'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
];

const ORGANISATIONS = [
  ['Sunnyvale Care Group', 'sunnyvale-care', 'enterprise', 'active', true, 40],
  ['Northgate Hospitality', 'northgate-hosp', 'business', 'active', true, 120],
  ['Mersey Domiciliary Care', 'mersey-dom', 'professional', 'active', false, 200],
  ['Cardiff Retail Partners', 'cardiff-retail', 'business', 'active', true, 310],
  ['Harbour Logistics UK', 'harbour-log', 'professional', 'suspended', true, 180],
  ['Brightpath Nurseries', 'brightpath', 'starter', 'archived', true, 15],
].map(([name, slug, plan, status, support, age], i) => ({
  id: ORG_IDS[i],
  name,
  slug,
  plan,
  status,
  support_access_allowed: support,
  suspended_at: status === 'suspended' ? ISO(12) : null,
  suspended_reason: status === 'suspended' ? 'Unresolved chargeback' : null,
  settings: {},
  // 0023's activity column. Deliberately the real clock rather than `ISO(0)`:
  // every other date here is anchored to a fixed day so screenshots stay
  // stable, but "active in the last 24 hours" is measured against *now*, and an
  // anchored value silently ages out of the window overnight.
  last_activity_at: new Date(Date.now() - (i % 3) * 3_600_000).toISOString(),
  industry: 'Residential care',
  country: 'United Kingdom',
  timezone: 'Europe/London',
  contact_email: null,
  contact_phone: null,
  created_by: USER_IDS[0],
  created_at: ISO(age as number),
  updated_at: ISO(1),
}));

const PROFILES = [
  ['Marcus Bell', 'm.bell@sunnyvalecare.co.uk', false],
  ['Sarah Okonjo', 'sarah.okonjo@rotaflow.co.uk', true],
  ['Idris Okafor', 'idris.okafor@rotaflow.co.uk', true],
  ['Priya Raman', 'priya@northgatehosp.com', false],
].map(([full_name, email, admin], i) => ({
  id: USER_IDS[i],
  full_name,
  email,
  is_platform_admin: admin,
  avatar_url: null,
  created_at: ISO(300 - i * 40),
  updated_at: ISO(2),
}));

const SUBSCRIPTIONS = [
  [0, 'enterprise', 'active', 24],
  [1, 'business', 'active', 61],
  [2, 'professional', 'past_due', -9],
  [3, 'business', 'trialing', 5],
].map(([orgIndex, plan, status, endsInDays]) => ({
  id: `sub-${orgIndex}`,
  org_id: ORG_IDS[orgIndex as number],
  plan,
  status,
  provider: null,
  provider_ref: null,
  current_period_end: new Date(
    Date.UTC(2026, 7, 5) + (endsInDays as number) * 86_400_000,
  ).toISOString(),
  created_at: ISO(200),
  updated_at: ISO(3),
}));

const MEMBERSHIPS = [
  [0, 0, 'owner'],
  [1, 0, 'manager'],
  [2, 3, 'manager'],
  [3, 1, 'owner'],
  [0, 1, 'staff'],
  [3, 2, 'owner'],
].map(([userIndex, orgIndex, role], i) => ({
  id: `mem-${i}`,
  user_id: USER_IDS[userIndex as number],
  org_id: ORG_IDS[orgIndex as number],
  role,
  status: 'active',
  created_at: ISO(120),
  organisation: { name: ORGANISATIONS[orgIndex as number]?.name, status: 'active' },
  organisations: { name: ORGANISATIONS[orgIndex as number]?.name },
  // `listOrgMembers` joins the profile under this alias. Without it the
  // organisation detail screen renders its primary contact as "Not recorded",
  // which reads as a product defect rather than a missing fixture.
  profile: {
    full_name: PROFILES[userIndex as number]?.full_name,
    email: PROFILES[userIndex as number]?.email,
  },
}));

const AUDIT_LOGS = [
  ['organisation.suspended', 'organisation', 'warning', 0],
  ['platform_role.granted', 'platform_admin', 'critical', null],
  ['support_access.granted', 'support_access_session', 'notice', 2],
  ['organisation.reactivated', 'organisation', 'info', 3],
  ['gdpr_request.closed', 'gdpr_request', 'notice', 1],
  ['organisation.suspended', 'organisation', 'warning', 4],
].map(([action, entity_type, severity, orgIndex], i) => ({
  before_value: i % 2 === 0 ? 'active' : null,
  after_value: i % 2 === 0 ? 'suspended' : null, // audit_before
  id: `audit-${i}`,
  action,
  entity_type,
  entity_id: null,
  severity,
  scope: orgIndex === null ? 'platform' : 'organisation',
  org_id: orgIndex === null ? null : ORG_IDS[orgIndex as number],
  org_name: orgIndex === null ? null : ORGANISATIONS[orgIndex as number]?.name,
  actor_id: USER_IDS[1],
  actor_name: i % 2 ? 'Idris Okafor' : 'Sarah Okonjo',
  actor_email: i % 2 ? 'idris.okafor@rotaflow.co.uk' : 'sarah.okonjo@rotaflow.co.uk',
  metadata: {},
  created_at: ISO(i),
}));

const SUPPORT_SESSIONS = [
  [2, 'Investigating a failed rota publish reported in RF-4796', 'read', 0.02, null],
  [0, 'Restoring billing access after a chargeback was resolved', 'read_write', 6, 5],
  [4, 'Checking clock-in GPS rejections', 'read', 30, null],
].map(([orgIndex, reason, scope, grantedDaysAgo, revokedDaysAgo], i) => ({
  id: `sa-${i}`,
  org_id: ORG_IDS[orgIndex as number],
  admin_user_id: USER_IDS[1],
  reason,
  case_ref: `RF-48${20 + i}`,
  scope,
  granted_at: ISO(grantedDaysAgo as number),
  expires_at: new Date(
    Date.UTC(2026, 7, 5) - (grantedDaysAgo as number) * 86_400_000 + 3_600_000,
  ).toISOString(),
  revoked_at: revokedDaysAgo === null ? null : ISO(revokedDaysAgo as number),
  revoked_by: revokedDaysAgo === null ? null : USER_IDS[1],
  revoke_reason: revokedDaysAgo === null ? null : 'Finished early',
  organisation: { name: ORGANISATIONS[orgIndex as number]?.name },
  organisations: { name: ORGANISATIONS[orgIndex as number]?.name },
  admin: { full_name: 'Sarah Okonjo' },
  profiles: { full_name: 'Sarah Okonjo' },
}));

const NOTIFICATIONS = Array.from({ length: 48 }, (_, i) => ({
  id: `note-${i}`,
  org_id: ORG_IDS[i % 4],
  user_id: USER_IDS[i % 4],
  channel: ['in_app', 'in_app', 'in_app', 'push', 'email'][i % 5],
  type: ['rota_published', 'leave_decision', 'shift_swap', 'announcement'][i % 4],
  title: 'Rota published',
  body: null,
  read_at: i % 3 === 0 ? ISO(i % 6) : null,
  created_at: ISO(i % 14),
  updated_at: ISO(i % 14),
}));

const DAY = (offsetDays: number): string =>
  new Date(Date.UTC(2026, 7, 5) + offsetDays * 86_400_000).toISOString().slice(0, 10);

// `kind` and `status` are CHECK-constrained enums and `due_on` / `received_on`
// are DATE columns, so PostgREST returns 'YYYY-MM-DD'. Fixtures that drifted
// from either rendered blank chips and "NaN days left". Worth keeping exact,
// since the whole point of the harness is that what renders here is what
// renders in production.
const GDPR_REQUESTS = [
  ['access', 'received', 0, -3],
  ['erasure', 'in_progress', 1, 4],
  ['portability', 'completed', 3, 20],
  ['rectification', 'awaiting_information', 2, 12],
].map(([kind, status, orgIndex, dueInDays], i) => ({
  id: `dsr-${i}`,
  org_id: ORG_IDS[orgIndex as number],
  subject_email: `subject${i}@example.com`,
  subject_name: ['Ruth Osei', 'Daniel Lee', 'Aisha Patel', 'James Ward'][i],
  kind,
  status,
  received_on: DAY(-20 + i),
  due_on: DAY(dueInDays as number),
  extended_to: null,
  extension_reason: null,
  assigned_to: USER_IDS[1],
  closed_at: status === 'completed' ? ISO(2) : null,
  outcome_note: status === 'completed' ? 'Bundle sent by secure link.' : null,
  created_at: ISO(20 - i),
  updated_at: ISO(1),
  organisations: { name: ORGANISATIONS[orgIndex as number]?.name },
  assignee: { full_name: 'Sarah Okonjo' },
}));

const SMTP = [0, 1].map((orgIndex) => ({
  org_id: ORG_IDS[orgIndex],
  smtp_host: orgIndex ? 'smtp.office365.com' : 'smtp.eu.mailgun.org',
  smtp_port: 587,
  smtp_user: orgIndex ? 'rota@northgatehosp.com' : 'postmaster@sunnyvalecare.co.uk',
  from_email: orgIndex ? 'rota@northgatehosp.com' : 'rota@sunnyvalecare.co.uk',
  from_name: ORGANISATIONS[orgIndex]?.name,
  verified_at: orgIndex ? null : ISO(9),
  created_at: ISO(90),
  updated_at: ISO(orgIndex ? 30 : 9),
}));

const PLATFORM_SETTINGS = {
  id: true,
  platform_name: 'RotaFlow',
  platform_url: 'https://rota.gakinz.com',
  support_email: 'support@rotaflow.co.uk',
  default_timezone: 'Europe/London',
  registration_enabled: true,
  maintenance_mode: false,
  maintenance_message: null,
  created_at: ISO(400),
  updated_at: ISO(6),
  updated_by: USER_IDS[1],
};

const PLATFORM_ADMINS = [
  [1, 'platform_owner'],
  [2, 'platform_admin'],
].map(([userIndex, role], i) => ({
  id: `pa-${i}`,
  user_id: USER_IDS[userIndex as number],
  role,
  granted_at: ISO(120),
  granted_by: USER_IDS[1],
  revoked_at: null,
  revoked_by: null,
  profiles: {
    full_name: PROFILES[userIndex as number]?.full_name,
    email: PROFILES[userIndex as number]?.email,
  },
  profile: {
    full_name: PROFILES[userIndex as number]?.full_name,
    email: PROFILES[userIndex as number]?.email,
  },
}));

const LOCATIONS = ORG_IDS.flatMap((org_id, i) =>
  Array.from({ length: [4, 3, 2, 6, 1, 1][i] ?? 1 }, (_, j) => ({
    id: `loc-${i}-${j}`,
    org_id,
    name: `Site ${j + 1}`,
    address: '12 Example Street, Leeds',
    status: 'active',
    created_at: ISO(100),
    updated_at: ISO(4),
  })),
);

/* ------------------------------------------------------------------ *
 * 0021-0027: the tables the console gained when its placeholders were
 * replaced. Same rule as everything above. Enough rows to exercise the
 * screen's states, and shapes that match the migration's CHECK constraints,
 * because a fixture the database would reject teaches the wrong thing.
 * ------------------------------------------------------------------ */

const INCIDENTS = [
  [
    'Elevated push notification failures (APNs)',
    'high',
    'monitoring',
    'Push notifications',
    6,
    4,
    null,
  ],
  [
    'Database read replica lag above 30s',
    'medium',
    'investigating',
    'PostgreSQL database',
    8,
    12,
    null,
  ],
  ['Payroll export queue backlog', 'medium', 'resolved', 'Background jobs', 128, 9, 205],
  [
    'Sign-in outage. Auth provider certificate expiry',
    'critical',
    'resolved',
    'Authentication',
    336,
    3,
    38,
  ],
  ['Rota publish notifications delayed', 'low', 'resolved', 'Notifications', 620, 15, 74],
].map(([title, severity, status, service, hoursAgo, detectMin, resolveMin], i) => {
  const started = Date.now() - (hoursAgo as number) * 3_600_000;
  return {
    id: `inc-${i}`,
    reference: `INC-${138 + i}`,
    title,
    impact: 'Recorded impact for the preview harness.',
    severity,
    status,
    service,
    started_at: new Date(started).toISOString(),
    detected_at: new Date(started + (detectMin as number) * 60_000).toISOString(),
    resolved_at:
      resolveMin === null
        ? null
        : new Date(started + (resolveMin as number) * 60_000).toISOString(),
    resolution: resolveMin === null ? null : 'Fixed, and the cause removed.',
    owner_id: USER_IDS[1],
    is_public: false,
    created_at: new Date(started).toISOString(),
    updated_at: ISO(0),
  };
});

const FEATURE_FLAGS = [
  [
    'ai_rota_assistant',
    'AI rota assistant',
    true,
    35,
    'production',
    true,
    ['business', 'enterprise'],
  ],
  [
    'advanced_reporting',
    'Advanced reporting',
    true,
    100,
    'production',
    false,
    ['professional', 'business', 'enterprise'],
  ],
  [
    'gps_clock_in',
    'GPS clock-in',
    true,
    100,
    'production',
    true,
    ['starter', 'professional', 'business', 'enterprise'],
  ],
  [
    'shift_swap_automation',
    'Shift swap automation',
    false,
    0,
    'production',
    false,
    ['enterprise'],
  ],
  ['new_rota_builder', 'New rota builder', true, 12, 'production', true, []],
  ['beta_integrations', 'Beta integrations', false, 0, 'staging', false, []],
].map(([key, name, enabled, rollout, environment, critical, plans]) => ({
  key,
  name,
  description: 'Described in migration 0022.',
  enabled,
  rollout,
  environment,
  critical,
  target_plans: plans,
  created_at: ISO(60),
  updated_at: ISO(3),
  updated_by: USER_IDS[1],
}));

const FLAG_CHANGES = FEATURE_FLAGS.map((f, i) => ({
  id: `flagchange-${i}`,
  flag_key: f.key,
  actor_id: USER_IDS[1],
  actor_name: 'Sarah Okonjo',
  field: 'rollout',
  before_value: '10%',
  after_value: `${String(f.rollout)}%`,
  created_at: ISO(i + 1),
}));

const SUPPORT_CASES = [
  [
    'Rota publish is failing for the night shift',
    'bug',
    'urgent',
    'open',
    3,
    null,
    null,
    null,
  ],
  [
    'Card payment declined. Invoice unpaid',
    'billing',
    'high',
    'pending',
    20,
    42,
    null,
    null,
  ],
  [
    'Staff member cannot clock in at the new site',
    'bug',
    'high',
    'open',
    9,
    null,
    null,
    null,
  ],
  [
    'Add a bulk import for staff records',
    'feature',
    'normal',
    'on_hold',
    96,
    120,
    null,
    null,
  ],
  [
    "How do I export last month's timesheets?",
    'question',
    'normal',
    'resolved',
    200,
    35,
    4,
    5,
  ],
  ['Two managers cannot see the same rota', 'bug', 'high', 'resolved', 320, 18, 9, 4],
  [
    "Remove a former employee's personal data",
    'access',
    'high',
    'resolved',
    460,
    22,
    26,
    5,
  ],
].map(
  ([subject, category, priority, status, ageHours, firstMin, resolveHours, csat], i) => {
    const created = Date.now() - (ageHours as number) * 3_600_000;
    return {
      id: `case-${i}`,
      reference: `CASE-${4120 + i}`,
      org_id: ORG_IDS[i % 4],
      requester_id: USER_IDS[i % 4],
      requester_name: ['Marcus Bell', 'Priya Raman', 'Alison Frame', 'Tomas Nowak'][
        i % 4
      ],
      requester_email: 'requester@example.co.uk',
      subject,
      category,
      priority,
      status,
      assigned_to: USER_IDS[1 + (i % 2)],
      first_response_at:
        firstMin === null
          ? null
          : new Date(created + (firstMin as number) * 60_000).toISOString(),
      resolved_at:
        resolveHours === null
          ? null
          : new Date(created + (resolveHours as number) * 3_600_000).toISOString(),
      csat,
      csat_comment: null,
      created_at: new Date(created).toISOString(),
      updated_at: ISO(0),
    };
  },
);

const PLANS = [
  ['starter', 'Starter', 2900, 1],
  ['professional', 'Professional', 12900, 2],
  ['business', 'Business', 29900, 3],
  ['enterprise', 'Enterprise', 79000, 4],
].map(([code, name, price, sort]) => ({
  code,
  name,
  monthly_price_pence: price,
  currency: 'GBP',
  seat_limit: null,
  location_limit: null,
  description: '',
  sort_order: sort,
  created_at: ISO(400),
  updated_at: ISO(400),
}));

const INVOICES = ORG_IDS.flatMap((org_id, i) =>
  Array.from({ length: 12 }, (_, m) => {
    const issued = new Date();
    issued.setMonth(issued.getMonth() - m);
    const price = [79000, 29900, 12900, 29900, 12900, 2900][i] ?? 12900;
    const status =
      m === 0 && i === 2
        ? 'past_due'
        : m === 0
          ? 'open'
          : m === 3 && i === 1
            ? 'refunded'
            : 'paid';
    return {
      id: `inv-${i}-${m}`,
      org_id,
      number: `INV-2026-${i}${String(m).padStart(2, '0')}`,
      period_start: issued.toISOString().slice(0, 10),
      period_end: issued.toISOString().slice(0, 10),
      amount_pence: price,
      tax_pence: Math.round(price * 0.2),
      currency: 'GBP',
      status,
      issued_on: issued.toISOString().slice(0, 10),
      due_on: issued.toISOString().slice(0, 10),
      paid_at: status === 'paid' ? issued.toISOString() : null,
      refunded_at: status === 'refunded' ? issued.toISOString() : null,
      failure_reason: status === 'past_due' ? 'card_declined: insufficient funds' : null,
      attempts: status === 'past_due' ? 3 : 0,
      provider: 'stripe',
      provider_ref: null,
      created_at: issued.toISOString(),
      updated_at: issued.toISOString(),
    };
  }),
);

const ANNOUNCEMENTS = [
  ['Scheduled maintenance-02:00-03:00 BST', 'maintenance', 'scheduled', null, 5],
  ['New: cost forecasting in Reports', 'product', 'sent', 7, null],
  ['Action needed: card expiring this month', 'billing', 'sent', 11, null],
  ['Resolved: sign-in outage', 'incident', 'sent', 14, null],
].map(([title, kind, status, daysAgo, daysAhead], i) => ({
  id: `ann-${i}`,
  title,
  body: 'Announcement body for the preview harness.',
  kind,
  audience: 'all',
  audience_plans: [],
  channel: 'in_app',
  status,
  scheduled_for:
    daysAhead === null
      ? null
      : new Date(Date.now() + (daysAhead as number) * 86_400_000).toISOString(),
  sent_at: daysAgo === null ? null : ISO(daysAgo as number),
  created_by: USER_IDS[1],
  created_at: ISO((daysAgo as number) ?? 1),
  updated_at: ISO(0),
}));

const ANNOUNCEMENT_DELIVERIES = ANNOUNCEMENTS.filter((a) => a.status === 'sent').flatMap(
  (a) =>
    ORG_IDS.map((org_id, i) => ({
      id: `del-${a.id}-${i}`,
      announcement_id: a.id,
      org_id,
      sent_at: a.sent_at,
      read_at: i % 5 === 0 ? null : a.sent_at,
      read_by: i % 5 === 0 ? null : USER_IDS[0],
      failed_at: null,
      failure_reason: null,
      created_at: a.sent_at,
    })),
);

const CONNECTOR_STATS = [
  ['sage_payroll', 'Sage Payroll', 'payroll', 'operational', 5, 412, 3, 99.4, 2400],
  ['xero', 'Xero', 'accounting', 'operational', 4, 288, 0, 99.8, 1800],
  ['brighthr', 'BrightHR', 'hr', 'degraded', 3, 194, 27, 91.2, 5200],
  ['google_calendar', 'Google Calendar', 'calendar', 'operational', 6, 706, 1, 99.9, 900],
  ['slack', 'Slack', 'communication', 'operational', 2, 96, 0, 100, 700],
].map(([key, name, category, status, orgs, runs, failed, rate, median]) => ({
  key,
  name,
  category,
  status,
  available: true,
  orgs_connected: orgs,
  runs_24h: runs,
  failed_24h: failed,
  success_rate_7d: rate,
  median_duration_ms: median,
  last_sync_at: ISO(0),
}));

const HEALTH_SUMMARY = [
  ['Database', 99.98, 18, 42, 61],
  ['Authentication', 99.9, 32, 78, 120],
  ['Realtime', 99.6, 24, 96, 180],
  ['Edge Functions', 99.2, 95, 210, 340],
  ['Storage', 100, 48, 110, 190],
].map(([service, uptime, p50, p95, p99]) => ({
  service,
  samples_24h: 96,
  ok_24h: 95,
  uptime_pct_24h: uptime,
  p50_ms: p50,
  p95_ms: p95,
  p99_ms: p99,
  last_checked_at: ISO(0),
}));

const RETENTION_POLICIES = [
  ['rota_history', 'Rota and shift history', 84, false],
  ['attendance', 'Attendance and clock-in', 36, false],
  ['leave', 'Leave records', 72, false],
  ['support_cases', 'Support cases', 36, false],
  ['audit_log', 'Platform audit log', null, true],
  ['deleted_tenant', 'Deleted tenant data', 1, false],
].map(([data_type, label, months, enforced]) => ({
  data_type,
  label,
  retain_months: months,
  enforced,
  note: '',
  updated_at: ISO(30),
}));

const BACKGROUND_JOBS = Array.from({ length: 48 }, (_, i) => ({
  id: `job-${i}`,
  queue: ['rota-publish', 'payroll-export', 'notifications', 'reminders'][i % 4],
  job_key: `job:${i}`,
  status:
    i % 11 === 0 ? 'failed' : i < 9 ? 'queued' : i % 7 === 0 ? 'running' : 'succeeded',
  attempts: 1,
  org_id: ORG_IDS[i % 6],
  payload: {},
  error: null,
  scheduled_for: ISO(0),
  started_at: ISO(0),
  finished_at: ISO(0),
  created_at: ISO(0),
}));

const TABLES: Record<string, unknown> = {
  organisations: ORGANISATIONS,
  profiles: PROFILES,
  subscriptions: SUBSCRIPTIONS,
  memberships: MEMBERSHIPS,
  audit_logs: AUDIT_LOGS,
  support_access_sessions: SUPPORT_SESSIONS,
  notifications: NOTIFICATIONS,
  push_subscriptions: Array.from({ length: 37 }, (_, i) => ({ id: `push-${i}` })),
  gdpr_requests: GDPR_REQUESTS,
  org_smtp_settings_safe: SMTP,
  platform_settings: PLATFORM_SETTINGS,
  platform_admins: PLATFORM_ADMINS,
  locations: LOCATIONS,
  departments: [],
  rotas: Array.from({ length: 128 }, (_, i) => ({
    id: `rota-${i}`,
    published_at: i % 4 === 0 ? null : ISO(i % 60),
  })),
  shifts: Array.from({ length: 4210 }, (_, i) => ({ id: `shift-${i}` })),
  staff_profiles: [],
  incidents: INCIDENTS,
  incident_updates: [],
  feature_flags: FEATURE_FLAGS,
  feature_flag_targets: [
    { flag_key: 'new_rota_builder', org_id: ORG_IDS[0], created_at: ISO(3) },
  ],
  feature_flag_changes: FLAG_CHANGES,
  support_cases: SUPPORT_CASES,
  support_case_messages: [],
  plans: PLANS,
  invoices: INVOICES,
  platform_announcements: ANNOUNCEMENTS,
  platform_announcement_deliveries: ANNOUNCEMENT_DELIVERIES,
  platform_announcement_optouts: [{ org_id: ORG_IDS[5], created_at: ISO(20) }],
  integration_connectors: CONNECTOR_STATS,
  integration_connector_stats: CONNECTOR_STATS,
  org_integrations: [],
  integration_sync_runs: [],
  platform_health_samples: [],
  platform_health_summary: HEALTH_SUMMARY,
  retention_policies: RETENTION_POLICIES,
  platform_ip_allowlist: [],
  background_jobs: BACKGROUND_JOBS,
};

/** Everything the console reads, keyed by the PostgREST path segment. */
function fixtureFor(table: string, url: URL): unknown {
  const rows = TABLES[table];
  if (rows === undefined) return undefined;
  if (!Array.isArray(rows)) return rows;

  // Honour `?org_id=eq.<uuid>` and `?user_id=eq.<uuid>`, which the per-tenant
  // and per-user screens rely on to show one row rather than all of them.
  let filtered = rows as Record<string, unknown>[];
  for (const [key, raw] of url.searchParams.entries()) {
    if (key === 'select' || key === 'order' || key === 'limit') continue;
    const [op, ...rest] = raw.split('.');
    const wanted = rest.join('.');
    if (op === 'eq') filtered = filtered.filter((r) => String(r[key]) === wanted);
    if (op === 'is' && wanted === 'null') filtered = filtered.filter((r) => !r[key]);
    if (op === 'not') filtered = filtered.filter((r) => Boolean(r[key]));
  }
  const limit = url.searchParams.get('limit');
  return limit ? filtered.slice(0, Number(limit)) : filtered;
}

function installFixtureFetch(): void {
  const original = window.fetch.bind(window);
  window.fetch = async (input, init) => {
    const href =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;

    if (!href.includes('/rest/v1/')) return original(input, init);

    const url = new URL(href);
    const table = url.pathname.split('/rest/v1/')[1]?.split('?')[0] ?? '';
    const data = fixtureFor(table, url);

    if (data === undefined) {
      // Loud rather than empty: an unmocked table should be obvious.
      console.warn(`[admin-preview] no fixture for "${table}". Returning []`);
    }

    const rows = data === undefined ? [] : data;
    const count = Array.isArray(rows) ? rows.length : 1;
    const headers = new Headers({
      'content-type': 'application/json',
      // `head: true` count queries read the total from here.
      'content-range': `0-${Math.max(0, count - 1)}/${count}`,
    });

    const wantsSingle =
      (init?.headers as Record<string, string> | undefined)?.Accept?.includes(
        'vnd.pgrst.object',
      ) ?? false;
    const body =
      init?.method === 'HEAD'
        ? ''
        : JSON.stringify(wantsSingle && Array.isArray(rows) ? (rows[0] ?? null) : rows);

    return new Response(body, { status: 200, headers });
  };
}

export function AdminPreviewHarness(): JSX.Element {
  // Installed once, before the first child render, so no screen ever sees the
  // real client.
  useState(() => {
    installFixtureFetch();
    return null;
  });

  /**
   * A platform-owner session, supplied directly.
   *
   * `OrgProvider` resolves the platform role from `my_platform_role()`, and
   * only after Supabase Auth has produced a user, which the harness has no way
   * to fake, and should not try to. Overriding the context here is both simpler
   * and more honest about what is being stubbed. It also matters for what this
   * harness is *for*: `adminNavForRole(null)` hides every role-gated entry, so
   * without a role the sidebar renders eight items instead of thirteen and a
   * screenshot of it proves nothing about the real thing.
   */
  const org = useMemo<OrgContextValue>(
    () => ({
      orgId: ORG_IDS[0] ?? null,
      orgName: String(ORGANISATIONS[0]?.name ?? ''),
      role: 'owner',
      memberships: [],
      isPlatformAdmin: true,
      platformRole: 'platform_owner',
      switchOrg: () => {},
      loading: false,
      loadFailed: false,
      createOrg: async () => {},
      refresh: async () => {},
    }),
    [],
  );

  return (
    <OrgContext.Provider value={org}>
      <AdminShell />
    </OrgContext.Provider>
  );
}
