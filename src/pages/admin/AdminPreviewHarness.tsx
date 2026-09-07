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
  platform_url: 'https://rotaflow.space',
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
  // Retired flags still appear in the console: the row stays so
  // `feature_flag_changes` keeps its referent (0030), and the harness should
  // show what the real screen shows.
  [
    'gps_clock_in',
    'GPS clock-in',
    false,
    0,
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
  ['starter', 'Starter', 2900, 1, 15, 1],
  ['professional', 'Professional', 12900, 2, 60, 5],
  ['business', 'Business', 29900, 3, 200, 20],
  ['enterprise', 'Enterprise', 79000, 4, null, null],
].map(([code, name, price, sort, seats, sites]) => ({
  code,
  name,
  monthly_price_pence: price,
  currency: 'GBP',
  // The real limits from 0023. They were all null here, so the seat-usage
  // column rendered "Uncapped" for every row and the preview exercised none of
  // the arithmetic it exists to show (BUG-062).
  seat_limit: seats ?? null,
  location_limit: sites ?? null,
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
  // A draft first, so the register's Publish and Cancel actions are on screen
  // in the design loop rather than only reachable after composing one.
  ['Draft: pricing change for Business', 'billing', 'draft', null, null],
  ['Scheduled maintenance-02:00–03:00 BST', 'maintenance', 'scheduled', null, 5],
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

/**
 * Deliveries, with queued, delivered and failed all present.
 *
 * Every row used to carry `sent_at`, because the publish function stamped it
 * at insert — so the preview could only ever show one state and the repair
 * that separates them would be invisible here. One organisation per
 * announcement is left queued and one is a recorded failure.
 */
const ANNOUNCEMENT_DELIVERIES = ANNOUNCEMENTS.filter((a) => a.status === 'sent').flatMap(
  (a) =>
    ORG_IDS.map((org_id, i) => {
      const queued = i === 1;
      const failed = i === 4;
      return {
        id: `del-${a.id}-${i}`,
        announcement_id: a.id,
        org_id,
        outbox_id: queued || failed ? null : `outbox-${a.id}-${i}`,
        sent_at: queued || failed ? null : a.sent_at,
        read_at: queued || failed || i % 5 === 0 ? null : a.sent_at,
        read_by: queued || failed || i % 5 === 0 ? null : USER_IDS[0],
        failed_at: failed ? a.sent_at : null,
        failure_reason: failed ? 'No active owner or manager to address' : null,
        created_at: a.sent_at,
      };
    }),
);

// Deliberately a mix. Production after 0073 has EVERY connector `planned`,
// because none is built — but a preview showing five empty rows would exercise
// none of this screen's layout, which is what a design harness is for. The two
// planned rows below are here so the state that production actually has is
// rendered somewhere: the neutral badge, the null success rate, and the
// "Built 5 of 7" tile all come from them.
const CONNECTOR_STATS = [
  ['sage_payroll', 'Sage Payroll', 'payroll', 'operational', 5, 412, 3, 99.4, 2400],
  ['xero', 'Xero', 'accounting', 'operational', 4, 288, 0, 99.8, 1800],
  ['brighthr', 'BrightHR', 'hr', 'degraded', 3, 194, 27, 91.2, 5200],
  ['google_calendar', 'Google Calendar', 'calendar', 'operational', 6, 706, 1, 99.9, 900],
  ['slack', 'Slack', 'communication', 'operational', 2, 96, 0, 100, 700],
  ['quickbooks', 'QuickBooks', 'accounting', 'planned', 0, 0, 0, null, null],
  ['bamboohr', 'BambooHR', 'hr', 'planned', 0, 0, 0, null, null],
].map(([key, name, category, status, orgs, runs, failed, rate, median]) => ({
  key,
  name,
  category,
  status,
  // The flag `connect_integration` checks. A planned connector refuses.
  available: status !== 'planned',
  orgs_connected: orgs,
  runs_24h: runs,
  failed_24h: failed,
  success_rate_7d: rate,
  median_duration_ms: median,
  last_sync_at: status === 'planned' ? null : ISO(0),
}));

// Service names must match what `runHealthChecks()` calls them, because
// `recordHealthSample` stores samples under `check.name` and System status
// joins the summary on it. 'Database' looked right and matched nothing.
const HEALTH_SUMMARY = [
  ['PostgreSQL database', 99.98, 18, 42, 61],
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

/**
 * The directory rows 0130 returns, for `/admin-preview/organisations`.
 *
 * Deliberately more than one page. The console's organisations screen was
 * repaired precisely because it could only ever show the rows that happened to
 * load, and a six-row fixture would hide the repair: the page control would
 * not render, the "of 34" total would equal the page length, and a reviewer
 * would sign off a screen that has never been asked to page.
 *
 * The six named tenants come first so the screenshots stay recognisable; the
 * rest exist to be paged through.
 */
const DIRECTORY_ROWS: {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
  industry: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  country: string;
  timezone: string;
  is_demo: boolean;
  created_at: string;
  last_activity_at: string | null;
  onboarding_completed_at: string | null;
  support_access_allowed: boolean;
  suspended_at: string | null;
  suspended_reason: string | null;
  subscription_status: string | null;
  subscription_plan: string | null;
  subscription_currency: string | null;
  subscription_price_pence: number | null;
  trial_ends_at: string | null;
  current_period_end: string | null;
  members: number;
  staff_active: number;
  locations: number;
  owner_email: string | null;
  owner_name: string | null;
  owner_contact_visible: boolean;
  health: string;
}[] = [
  ...ORGANISATIONS.map((org, i) => {
    const sub = SUBSCRIPTIONS.find((s) => s.org_id === org.id);
    return {
      id: String(org.id),
      name: String(org.name),
      slug: String(org.slug),
      status: String(org.status),
      plan: String(sub?.plan ?? org.plan),
      industry: ['Residential care', 'Hospitality', 'Retail'][i % 3] ?? null,
      contact_email: null,
      contact_phone: null,
      country: 'United Kingdom',
      timezone: 'Europe/London',
      is_demo: false,
      created_at: org.created_at,
      last_activity_at: org.last_activity_at,
      onboarding_completed_at: null,
      support_access_allowed: Boolean(org.support_access_allowed),
      suspended_at: org.suspended_at,
      suspended_reason: org.suspended_reason,
      subscription_status: sub ? String(sub.status) : null,
      subscription_plan: sub ? String(sub.plan) : null,
      subscription_currency: sub ? 'GBP' : null,
      subscription_price_pence: sub ? 79000 : null,
      trial_ends_at: null,
      current_period_end: sub ? String(sub.current_period_end) : null,
      // Login accounts and rostered staff are different populations, and the
      // fixture keeps them apart on purpose: most rostered staff never sign
      // in, so a console showing one under the other's name is BUG-062.
      members: [7, 5, 3, 4, 2, 1][i] ?? 1,
      staff_active: [248, 96, 41, 33, 27, 14][i] ?? 0,
      locations: [4, 3, 2, 6, 2, 1][i] ?? 1,
      owner_email: `owner@${String(org.slug)}.example`,
      owner_name: 'Preview Owner',
      owner_contact_visible: true,
      health:
        org.status === 'archived'
          ? 'archived'
          : org.status === 'suspended'
            ? 'suspended'
            : sub?.status === 'past_due'
              ? 'attention'
              : 'healthy',
    };
  }),
  ...Array.from({ length: 28 }, (_, n) => {
    const i = n + 1;
    const status = i % 11 === 0 ? 'suspended' : 'active';
    const plan = ['starter', 'professional', 'business'][i % 3] ?? 'starter';
    return {
      id: `99999999-0000-4000-8000-${String(i).padStart(12, '0')}`,
      name: `Preview Tenant ${String(i).padStart(2, '0')}`,
      slug: `preview-tenant-${String(i).padStart(2, '0')}`,
      status,
      plan,
      industry: ['Residential care', 'Hospitality', 'Retail'][i % 3] ?? null,
      contact_email: `accounts@preview-${i}.example`,
      contact_phone: null,
      country: 'United Kingdom',
      timezone: 'Europe/London',
      is_demo: false,
      created_at: ISO(20 + i * 5),
      last_activity_at: i % 7 === 0 ? null : ISO(i % 40),
      onboarding_completed_at: null,
      support_access_allowed: i % 4 !== 0,
      suspended_at: status === 'suspended' ? ISO(9) : null,
      suspended_reason: status === 'suspended' ? 'Unresolved chargeback' : null,
      subscription_status: i % 5 === 0 ? 'trialing' : i % 9 === 0 ? null : 'active',
      subscription_plan: i % 9 === 0 ? null : plan,
      subscription_currency: i % 9 === 0 ? null : 'GBP',
      subscription_price_pence: i % 9 === 0 ? null : 4900 * (1 + (i % 3)),
      trial_ends_at: null,
      current_period_end: null,
      members: 1 + (i % 6),
      staff_active: 4 + i * 3,
      locations: 1 + (i % 4),
      owner_email: `owner@preview-${i}.example`,
      owner_name: `Preview Owner ${i}`,
      owner_contact_visible: true,
      health:
        status === 'suspended'
          ? 'suspended'
          : i % 7 === 0
            ? 'at_risk'
            : i % 40 > 30
              ? 'at_risk'
              : i % 40 > 14
                ? 'attention'
                : 'healthy',
    };
  }),
];

/**
 * The account rows 0131 returns, for `/admin-preview/users`.
 *
 * Marcus Bell holds two memberships and Priya Raman has one that is
 * suspended, because those are the two states the repaired screen exists to
 * show: an account findable by either of its organisation names, and a
 * "no active membership" badge that the old screen could never render.
 */
const USER_DIRECTORY_ROWS: {
  id: string;
  email: string;
  full_name: string | null;
  avatar_url: string | null;
  is_platform_admin: boolean;
  platform_role: string | null;
  created_at: string;
  organisations: number;
  active_memberships: number;
  org_ids: string[];
  org_names: string[];
  roles: string[];
  membership_statuses: string[];
}[] = [
  ...PROFILES.map((profile, i) => {
    const own = MEMBERSHIPS.filter((m) => m.user_id === profile.id);
    const suspended = i === 3;
    return {
      id: String(profile.id),
      email: String(profile.email),
      full_name: profile.full_name === undefined ? null : String(profile.full_name),
      avatar_url: null,
      is_platform_admin: Boolean(profile.is_platform_admin),
      platform_role: profile.is_platform_admin
        ? i === 1
          ? 'platform_owner'
          : 'platform_support'
        : null,
      created_at: profile.created_at,
      organisations: own.length,
      active_memberships: suspended ? 0 : own.length,
      org_ids: own.map((m) => String(m.org_id)),
      org_names: own.map((m) => String(m.organisation.name ?? '')),
      roles: [...new Set(own.map((m) => String(m.role)))].sort(),
      membership_statuses: own.length === 0 ? [] : suspended ? ['suspended'] : ['active'],
    };
  }),
  ...Array.from({ length: 26 }, (_, n) => {
    const i = n + 1;
    const role = ['owner', 'manager', 'staff'][i % 3] ?? 'staff';
    return {
      id: `88888888-0000-4000-8000-${String(i).padStart(12, '0')}`,
      email: `person${String(i).padStart(2, '0')}@preview-tenant.example`,
      full_name: `Preview Person ${String(i).padStart(2, '0')}`,
      avatar_url: null,
      is_platform_admin: false,
      platform_role: null,
      created_at: ISO(30 + i * 4),
      organisations: i % 8 === 0 ? 0 : 1,
      active_memberships: i % 8 === 0 ? 0 : 1,
      org_ids: i % 8 === 0 ? [] : [String(ORG_IDS[i % 6] ?? '')],
      org_names: i % 8 === 0 ? [] : [String(ORGANISATIONS[i % 6]?.name ?? '')],
      roles: i % 8 === 0 ? [] : [role],
      membership_statuses: i % 8 === 0 ? [] : ['active'],
    };
  }),
];

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

  // RPCs the console calls. Keyed by the path segment after `/rpc/`, so the
  // interceptor can serve them exactly like a table. Without these the screens
  // that moved onto SECURITY DEFINER functions render dashes in the preview
  // while showing real numbers in production, which teaches the reviewer the
  // wrong thing about their own console.
  'rpc/platform_auth_facts_summary': [
    {
      total_accounts: 12,
      unverified: 1,
      active_30d: 11,
      inactive_90d: 1,
      mfa_enrolled: 0,
      banned: 0,
    },
  ],
  'rpc/platform_totals': [
    {
      // Matches the directory fixture, so the overview cannot show one count
      // beside a different one for the same fact.
      organisations: DIRECTORY_ROWS.length,
      active_orgs: DIRECTORY_ROWS.filter((o) => o.status === 'active').length,
      profiles: PROFILES.length,
      staff_profiles: 91,
      published_rotas: 96,
      shifts_month: 4210,
    },
  ],
  // Seat usage on /admin/subscriptions divides these by plans.seat_limit, so
  // the numbers are chosen to exercise the states that matter: Brightpath is a
  // Starter (15 seats) sitting at 14, Sunnyvale is Enterprise and therefore
  // uncapped. Active STAFF, not memberships — see BUG-062.
  'rpc/platform_staff_counts': ORG_IDS.slice(0, 6).map((id, i) => ({
    org_id: id,
    staff_active: [248, 96, 41, 33, 27, 14][i] ?? 0,
  })),
  'rpc/platform_tenant_counts': [
    {
      staff_total: 24,
      staff_active: 21,
      locations: 4,
      departments: 6,
      published_rotas: 18,
      shifts_month: 412,
    },
  ],
  // `gps_clock_in` is deliberately absent: 0090 removed it from every plan,
  // because every plan had it and a gate that can never refuse is not a gate.
  'rpc/my_feature_access': [
    { feature: 'advanced_reporting', source: 'plan' },
    { feature: 'ai_rota_assistant', source: 'flag' },
  ],
  // Lets `/admin-preview/organisations` drive the admin-assisted org
  // creation flow end to end, same reasoning as the RPCs above: the real
  // migration isn't applied everywhere yet, so without this fixture the
  // preview can only show the form, never the success state it leads to.
  'rpc/admin_create_organisation_with_invite': [
    {
      org_id: '77777777-7777-4777-8777-777777777777',
      // 0084 returns this so the caller can email the invite instead of asking
      // a person to copy a link. Without it the preview's success path throws.
      invite_id: '77777777-7777-4777-8777-888888888888',
      invite_token: 'preview-invite-token',
      invite_expires_at: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    },
  ],
  // A scalar function, so the fixture is the bare number rather than a row
  // array — `fixtureFor` returns non-array values as-is, matching how
  // PostgREST actually serialises an RPC that returns `integer`. Not
  // org-filtered, same as `platform_tenant_counts` above: the RPC call is a
  // POST with the org id in the body, not the URL, so every organisation's
  // detail page sees this same figure in the preview.
  'rpc/subscription_mrr_pence': 79000,

  // 0130's directory. A function fixture, because this RPC pages and filters
  // in the database: a fixed array would render page 1 forever and the
  // Pagination control would be a decoration. It reproduces the parts of the
  // real function the screen depends on — the search, the status/plan filters,
  // the sort whitelist, the clamp and `total_count` over the whole match set —
  // so the preview shows paging behaving the way production does.
  'rpc/platform_organisation_directory': ((args: Record<string, unknown>) => {
    const text = (key: string): string =>
      typeof args[key] === 'string' ? args[key].toLowerCase() : '';
    const list = (key: string): string[] =>
      Array.isArray(args[key]) ? (args[key] as string[]) : [];
    const search = text('p_search');
    const status = list('p_status');
    const plan = list('p_plan');
    const subscription = list('p_subscription_status');
    const industry = list('p_industry');
    const health = list('p_health');

    const matched = DIRECTORY_ROWS.filter((row) => {
      if (status.length > 0 && !status.includes(row.status)) return false;
      if (plan.length > 0 && !plan.includes(row.plan)) return false;
      if (
        subscription.length > 0 &&
        !subscription.includes(row.subscription_status ?? 'none')
      ) {
        return false;
      }
      if (industry.length > 0 && !industry.includes(row.industry ?? '')) return false;
      if (health.length > 0 && !health.includes(row.health)) return false;
      if (search === '') return true;
      return [row.name, row.slug, row.contact_email, row.owner_email]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search);
    });

    const sortKey = typeof args.p_sort === 'string' ? args.p_sort : 'created_at';
    const sign = args.p_direction === 'asc' ? 1 : -1;
    const sorted = [...matched].sort((a, b) => {
      const left = a[sortKey as keyof typeof a];
      const right = b[sortKey as keyof typeof b];
      const primary =
        typeof left === 'number' && typeof right === 'number'
          ? (left - right) * sign
          : String(left ?? '').localeCompare(String(right ?? '')) * sign;
      // The same tie-break 0130 applies. Without it, paging an equal-valued
      // sort repeats one row and drops another.
      return primary !== 0 ? primary : a.id.localeCompare(b.id);
    });

    const limit = Math.min(Math.max(Number(args.p_limit ?? 25), 1), 200);
    const offset = Math.max(Number(args.p_offset ?? 0), 0);
    return sorted
      .slice(offset, offset + limit)
      .map((row) => ({ ...row, total_count: matched.length }));
  }) satisfies BodyFixture,
  // 0131's user directory. A function fixture for the same reason as the
  // organisation one above: it pages and filters in the database, and a fixed
  // array would show page 1 forever.
  //
  // Marcus Bell is in two organisations on purpose. He is the account the old
  // screen could not find by either organisation name, and the preview has to
  // be able to demonstrate that it now can.
  'rpc/platform_user_directory': ((args: Record<string, unknown>) => {
    const search = typeof args.p_search === 'string' ? args.p_search.toLowerCase() : '';
    const access = args.p_platform_access;
    const roles = Array.isArray(args.p_role) ? (args.p_role as string[]) : [];
    const statuses = Array.isArray(args.p_membership_status)
      ? (args.p_membership_status as string[])
      : [];

    const matched = USER_DIRECTORY_ROWS.filter((row) => {
      if (access === 'platform' && !row.is_platform_admin) return false;
      if (access === 'standard' && row.is_platform_admin) return false;
      if (roles.length > 0 && !row.roles.some((r) => roles.includes(r))) return false;
      if (
        statuses.length > 0 &&
        !row.membership_statuses.some((st) => statuses.includes(st))
      ) {
        return false;
      }
      if (search === '') return true;
      return [row.email, row.full_name, ...row.org_names]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(search);
    });

    const sortKey = typeof args.p_sort === 'string' ? args.p_sort : 'created_at';
    const sign = args.p_direction === 'asc' ? 1 : -1;
    const sorted = [...matched].sort((a, b) => {
      const key = sortKey === 'name' ? 'full_name' : sortKey;
      const left = a[key as keyof typeof a];
      const right = b[key as keyof typeof b];
      const primary =
        typeof left === 'number' && typeof right === 'number'
          ? (left - right) * sign
          : String(left ?? '').localeCompare(String(right ?? '')) * sign;
      return primary !== 0 ? primary : a.id.localeCompare(b.id);
    });

    const limit = Math.min(Math.max(Number(args.p_limit ?? 25), 1), 200);
    const offset = Math.max(Number(args.p_offset ?? 0), 0);
    return sorted
      .slice(offset, offset + limit)
      .map((row) => ({ ...row, total_count: matched.length }));
  }) satisfies BodyFixture,
  // 0132's scoped delivery aggregate. A function fixture because it takes the
  // ids on screen — the old service read the whole deliveries table into the
  // browser instead, which is the thing this RPC exists to stop.
  'rpc/platform_announcement_stats': ((args: Record<string, unknown>) => {
    const ids = new Set(Array.isArray(args.p_ids) ? (args.p_ids as string[]) : []);
    const byAnnouncement = new Map<
      string,
      {
        recipients: number;
        queued: number;
        delivered: number;
        failed: number;
        read: number;
      }
    >();
    for (const row of ANNOUNCEMENT_DELIVERIES) {
      if (!ids.has(row.announcement_id)) continue;
      const current = byAnnouncement.get(row.announcement_id) ?? {
        recipients: 0,
        queued: 0,
        delivered: 0,
        failed: 0,
        read: 0,
      };
      current.recipients += 1;
      if (row.sent_at === null && row.failed_at === null) current.queued += 1;
      if (row.sent_at !== null) current.delivered += 1;
      if (row.failed_at !== null) current.failed += 1;
      if (row.read_at !== null) current.read += 1;
      byAnnouncement.set(row.announcement_id, current);
    }
    return [...byAnnouncement].map(([announcement_id, counts]) => ({
      announcement_id,
      ...counts,
    }));
  }) satisfies BodyFixture,
  // The composer's three writes. Fixtures rather than an unmocked call, so the
  // preview can be driven all the way to a success state; nothing here changes
  // the register, which is what a fixture harness can honestly offer.
  'rpc/create_platform_announcement': 'preview-announcement-id',
  'rpc/publish_platform_announcement': 6,
  'rpc/cancel_platform_announcement': null,
  // 0133. A function fixture so the reporting-period select actually changes
  // the chart in the design loop.
  'rpc/platform_growth': ((args: Record<string, unknown>) => {
    const months = Math.min(Math.max(Number(args.p_months ?? 12), 1), 36);
    const now = new Date();
    return Array.from({ length: months }, (_, i) => {
      const start = new Date(
        Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1 - i), 1),
      );
      const created = [1, 0, 2, 1, 3, 0, 1, 2, 0, 1, 1, 3][i % 12] ?? 1;
      return {
        month_start: start.toISOString().slice(0, 10),
        created,
        total: 6 + i * 2,
        churned: i % 5 === 0 ? 1 : 0,
      };
    });
  }) satisfies BodyFixture,
  'rpc/platform_operations_summary': [
    {
      open_cases: 3,
      urgent_open_cases: 1,
      unassigned_open_cases: 1,
      open_incidents: 1,
      active_support_sessions: 2,
      failed_notifications: 0,
    },
  ],
  // 0134's per-currency billing summary and paged invoice list. Two
  // currencies on purpose: the mixed-currency banner is a state the console
  // is now supposed to render, and one nobody could reach in a preview.
  'rpc/platform_billing_summary': [
    {
      currency: 'GBP',
      mrr_pence: 121800,
      paying_orgs: 3,
      collected_month_pence: 98000,
      collected_prev_month_pence: 91000,
      outstanding_pence: 34000,
      past_due_pence: 12900,
      refunded_month_pence: 4900,
      open_invoices: 4,
      past_due_invoices: 1,
      refunded_invoices: 1,
    },
    {
      currency: 'EUR',
      mrr_pence: 29900,
      paying_orgs: 1,
      collected_month_pence: 29900,
      collected_prev_month_pence: 29900,
      outstanding_pence: 0,
      past_due_pence: 0,
      refunded_month_pence: 0,
      open_invoices: 0,
      past_due_invoices: 0,
      refunded_invoices: 0,
    },
  ],
  'rpc/platform_invoice_directory': ((args: Record<string, unknown>) => {
    const limit = Math.min(Math.max(Number(args.p_limit ?? 25), 1), 200);
    const offset = Math.max(Number(args.p_offset ?? 0), 0);
    const rows = INVOICES.map((invoice) => ({
      ...invoice,
      org_name: ORGANISATIONS.find((org) => org.id === invoice.org_id)?.name ?? null,
      tax_pence: 0,
      period_start: invoice.issued_on,
      period_end: invoice.due_on,
      failure_reason: null,
      attempts: invoice.status === 'past_due' ? 2 : 0,
      provider: 'stripe',
      provider_ref: `in_preview_${invoice.number}`,
    }));
    return rows
      .slice(offset, offset + limit)
      .map((row) => ({ ...row, total_count: rows.length }));
  }) satisfies BodyFixture,
  'rpc/platform_user_facets': [
    {
      total: USER_DIRECTORY_ROWS.length,
      with_membership: USER_DIRECTORY_ROWS.filter((r) => r.organisations > 0).length,
      unattached: USER_DIRECTORY_ROWS.filter((r) => r.organisations === 0).length,
      multi_org: USER_DIRECTORY_ROWS.filter((r) => r.organisations > 1).length,
      platform_admins: USER_DIRECTORY_ROWS.filter((r) => r.is_platform_admin).length,
      suspended_only: USER_DIRECTORY_ROWS.filter(
        (r) => r.organisations > 0 && r.active_memberships === 0,
      ).length,
      roles: ['manager', 'owner', 'staff'],
    },
  ],
  'rpc/platform_organisation_facets': [
    {
      total: DIRECTORY_ROWS.length,
      active: DIRECTORY_ROWS.filter((r) => r.status === 'active').length,
      suspended: DIRECTORY_ROWS.filter((r) => r.status === 'suspended').length,
      archived: DIRECTORY_ROWS.filter((r) => r.status === 'archived').length,
      new_this_month: 3,
      new_last_month: 2,
      trialing: DIRECTORY_ROWS.filter((r) => r.subscription_status === 'trialing').length,
      past_due: DIRECTORY_ROWS.filter((r) => r.subscription_status === 'past_due').length,
      healthy: DIRECTORY_ROWS.filter((r) => r.health === 'healthy').length,
      attention: DIRECTORY_ROWS.filter((r) => r.health === 'attention').length,
      at_risk: DIRECTORY_ROWS.filter((r) => r.health === 'at_risk').length,
      archived_band: DIRECTORY_ROWS.filter((r) => r.health === 'archived').length,
      active_24h: DIRECTORY_ROWS.filter(
        (r) =>
          r.last_activity_at !== null &&
          Date.now() - Date.parse(r.last_activity_at) < 86_400_000,
      ).length,
      plans: ['starter', 'professional', 'business', 'enterprise'],
      industries: ['Residential care', 'Hospitality', 'Retail'],
      subscription_statuses: ['trialing', 'active', 'past_due', 'none'],
    },
  ],
};

/**
 * An RPC whose answer depends on its arguments.
 *
 * PostgREST posts RPC arguments in the body, not the query string, so a fixed
 * fixture cannot page or filter — every page of a paged screen would return
 * the same six rows, and the preview would teach the reviewer that paging does
 * not work. These get the parsed body instead.
 */
type BodyFixture = (args: Record<string, unknown>) => unknown;

function isBodyFixture(value: unknown): value is BodyFixture {
  return typeof value === 'function';
}

/** Everything the console reads, keyed by the PostgREST path segment. */
function fixtureFor(table: string, url: URL, body: Record<string, unknown>): unknown {
  const rows = TABLES[table];
  if (rows === undefined) return undefined;
  if (isBodyFixture(rows)) return rows(body);
  if (!Array.isArray(rows)) return rows;

  // Honour `?org_id=eq.<uuid>` and `?user_id=eq.<uuid>`, which the per-tenant
  // and per-user screens rely on to show one row rather than all of them.
  let filtered = rows as Record<string, unknown>[];
  for (const [key, raw] of url.searchParams.entries()) {
    if (key === 'select' || key === 'order' || key === 'limit') continue;
    const [op, ...rest] = raw.split('.');
    const wanted = rest.join('.');
    if (op === 'eq') filtered = filtered.filter((r) => String(r[key]) === wanted);
    // `in.(a,b)`. Without this a status or type filter in the preview changed
    // the URL and nothing else, which teaches a reviewer that the filter does
    // not work when in production it does.
    if (op === 'in') {
      const allowed = new Set(
        wanted
          .replace(/^\(|\)$/g, '')
          .split(',')
          .map((value) => value.replace(/^"|"$/g, '')),
      );
      filtered = filtered.filter((r) => allowed.has(String(r[key])));
    }
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
    const path = url.pathname.split('/rest/v1/')[1]?.split('?')[0] ?? '';

    /**
     * `?fail=a,b` makes those paths return 500.
     *
     * Partial failure is a state the console is now supposed to render — a
     * panel whose source could not be read says so rather than showing zero —
     * and a state nobody can reach is a state nobody reviews. The list is read
     * from the page's own address, so
     * `/admin-preview?fail=rpc/platform_operations_summary` shows the
     * overview with its support panel unavailable and everything else intact.
     */
    const failing = new Set(
      (new URLSearchParams(window.location.search).get('fail') ?? '')
        .split(',')
        .map((name) => name.trim())
        .filter(Boolean),
    );
    if (failing.has(path)) {
      return new Response(JSON.stringify({ message: 'Forced failure (preview)' }), {
        status: 500,
        headers: new Headers({ 'content-type': 'application/json' }),
      });
    }
    // An RPC is `rpc/<name>`; a table is just the name. Both are looked up in
    // the same map, so adding a fixture for either is one line.
    const table = path;
    // PostgREST posts RPC arguments in the body, so a fixture that pages or
    // filters has to read it.
    let rpcArgs: Record<string, unknown> = {};
    if (typeof init?.body === 'string') {
      try {
        rpcArgs = JSON.parse(init.body) as Record<string, unknown>;
      } catch {
        // A body this harness cannot read is not a reason to fail the request;
        // the fixture simply sees no arguments.
        rpcArgs = {};
      }
    }
    const data = fixtureFor(table, url, rpcArgs);

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
