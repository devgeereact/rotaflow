import { useMemo, useState, type JSX } from 'react';
import {
  NavigationType,
  Route,
  Routes,
  UNSAFE_LocationContext,
  UNSAFE_RouteContext,
  useLocation,
} from 'react-router-dom';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { OrgContext, type OrgContextValue } from '@/context/OrgContext';
import { SettingsLayout } from '@/components/layout/SettingsLayout';
import { ProfileLayout } from '@/components/layout/ProfileLayout';
import { SettingsOrganisationPage } from '@/pages/app/settings/SettingsOrganisationPage';
import { SettingsPoliciesPage } from '@/pages/app/settings/SettingsPoliciesPage';
import { SettingsNotificationsPage } from '@/pages/app/settings/SettingsNotificationsPage';
import { SettingsIntegrationsPage } from '@/pages/app/settings/SettingsIntegrationsPage';
import { SettingsBillingPage } from '@/pages/app/settings/SettingsBillingPage';
import { SettingsAuditPage } from '@/pages/app/settings/SettingsAuditPage';
import { ProfilePage } from '@/pages/app/account/ProfilePage';
import { PreferencesPage } from '@/pages/app/account/PreferencesPage';
import { SecurityPage } from '@/pages/app/account/SecurityPage';

/**
 * Design-loop harness for Settings and My account, **development only**.
 *
 * ## Why this exists
 *
 * Every Settings and My account screen has a mockup in `docs/design/`, and none
 * had ever been compared with it (GAP-088): the loop could not reach them,
 * because each needs a session, an organisation and stored rows. This mounts
 * the **real** pages inside their real tab layouts, with `AuthContext` and
 * `OrgContext` stubbed and `fetch` answering Supabase REST and RPC calls from
 * fixtures, the same move as `DashboardLivePreviewPage`. Anything without a
 * fixture answers `[]`, so a page shows its empty state rather than crashing.
 *
 * Routes: `/settings-preview/{organisation,policies,notifications,integrations,
 * billing,audit}` and `/settings-preview/account/{profile,preferences,security}`.
 * The tab links inside the layouts point at the live `/app/...` routes, which
 * need a session; capture each screen by its preview URL instead.
 *
 * Gated behind `import.meta.env.DEV` in `App.tsx` like every other preview
 * route, so Rollup drops this module from the production bundle.
 */

const ROOT_ROUTE_CONTEXT = { outlet: null, matches: [], isDataRoute: false };

const ORG_ID = 'preview-org';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NOW = new Date();
const daysAgo = (n: number): string =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

const ORGANISATIONS = [
  {
    id: ORG_ID,
    name: 'Sunnyvale Care Group',
    slug: 'sunnyvale-care',
    industry: 'care',
    country: 'GB',
    timezone: 'Europe/London',
    contact_email: 'office@sunnyvale.example',
    contact_phone: '0161 496 0000',
    plan: 'professional',
    status: 'active',
    is_demo: false,
    support_access_allowed: false,
    suspended_at: null,
    suspended_reason: null,
    trial_ends_at: null,
    onboarding_completed_at: daysAgo(120),
    last_activity_at: daysAgo(0),
    created_at: daysAgo(140),
    created_by: USER_ID,
    updated_at: daysAgo(3),
    settings: {
      max_weekly_hours: 48,
      min_rest_hours: 11,
      max_shift_hours: 12,
      min_break_minutes: 20,
      paid_breaks: false,
      holiday_year_start: '04-01',
      include_bank_holidays: true,
      swaps_need_approval: true,
    },
  },
];

const LOCATIONS = [
  {
    id: 'loc1',
    org_id: ORG_ID,
    name: 'Sunshine Care Home',
    status: 'active',
    location_type: 'care_home',
    address: '12 Park Road, Manchester',
    latitude: null,
    longitude: null,
    geofence_radius_m: 150,
    timezone: 'Europe/London',
    created_at: daysAgo(130),
    updated_at: daysAgo(30),
  },
  {
    id: 'loc2',
    org_id: ORG_ID,
    name: 'Riverside House',
    status: 'active',
    location_type: 'care_home',
    address: '3 Quay Street, Salford',
    latitude: null,
    longitude: null,
    geofence_radius_m: 150,
    timezone: 'Europe/London',
    created_at: daysAgo(120),
    updated_at: daysAgo(20),
  },
  {
    id: 'loc3',
    org_id: ORG_ID,
    name: 'Oakview Care Home',
    status: 'active',
    location_type: 'care_home',
    address: '88 Oak Lane, Stockport',
    latitude: null,
    longitude: null,
    geofence_radius_m: 150,
    timezone: 'Europe/London',
    created_at: daysAgo(110),
    updated_at: daysAgo(10),
  },
];

const DEPARTMENTS = [
  {
    id: 'd1',
    org_id: ORG_ID,
    location_id: 'loc1',
    name: 'Nursing',
    created_at: daysAgo(130),
    updated_at: daysAgo(30),
  },
  {
    id: 'd2',
    org_id: ORG_ID,
    location_id: 'loc1',
    name: 'Care',
    created_at: daysAgo(130),
    updated_at: daysAgo(30),
  },
  {
    id: 'd3',
    org_id: ORG_ID,
    location_id: 'loc2',
    name: 'Care',
    created_at: daysAgo(120),
    updated_at: daysAgo(20),
  },
  {
    id: 'd4',
    org_id: ORG_ID,
    location_id: 'loc3',
    name: 'Housekeeping',
    created_at: daysAgo(110),
    updated_at: daysAgo(10),
  },
];

const PROFILES = [
  {
    id: USER_ID,
    email: 'james.davis@sunnyvale.example',
    full_name: 'James Davis',
    avatar_url: null,
    is_platform_admin: false,
    created_at: daysAgo(140),
    updated_at: daysAgo(5),
  },
];

const APP_SETTINGS = [
  {
    id: 'as1',
    user_id: USER_ID,
    theme: 'light',
    notifications_enabled: true,
    created_at: daysAgo(140),
    updated_at: daysAgo(5),
  },
];

/** The signed-in person's own staff record, read through the visible view. */
const STAFF_PROFILES = [
  {
    id: 's1',
    org_id: ORG_ID,
    user_id: USER_ID,
    first_name: 'James',
    last_name: 'Davis',
    job_title: 'Registered Manager',
    payroll_id: 'RM0042',
    phone: '07700 900123',
    photo_url: null,
    email: 'james.davis@sunnyvale.example',
    active: true,
  },
];

const PLANS = [
  {
    code: 'starter',
    name: 'Starter',
    description: 'For one site getting started',
    currency: 'GBP',
    monthly_price_pence: 4900,
    seat_limit: 25,
    location_limit: 1,
    sort_order: 1,
    features: ['Rota builder', 'Clock-in'],
    stripe_price_id: null,
    stripe_test_price_id: null,
    created_at: daysAgo(200),
    updated_at: daysAgo(200),
  },
  {
    code: 'professional',
    name: 'Professional',
    description: 'For growing groups',
    currency: 'GBP',
    monthly_price_pence: 14900,
    seat_limit: 150,
    location_limit: 5,
    sort_order: 2,
    features: ['Everything in Starter', 'Reports', 'AI rota assistant'],
    stripe_price_id: null,
    stripe_test_price_id: null,
    created_at: daysAgo(200),
    updated_at: daysAgo(200),
  },
];

const SUBSCRIPTIONS = [
  {
    id: 'sub1',
    org_id: ORG_ID,
    plan: 'professional',
    status: 'active',
    currency: 'GBP',
    price_pence: 14900,
    provider: 'stripe',
    provider_ref: 'sub_preview',
    stripe_customer_id: 'cus_preview',
    stripe_mode: 'test',
    started_at: daysAgo(100),
    current_period_end: new Date(NOW.getTime() + 12 * 86_400_000).toISOString(),
    trial_ends_at: null,
    canceled_at: null,
    grace_until: null,
    past_due_since: null,
    created_at: daysAgo(100),
    updated_at: daysAgo(18),
  },
];

const INVOICES = [0, 1, 2].map((i) => ({
  id: `inv${i}`,
  org_id: ORG_ID,
  number: `RF-2026-00${3 - i}`,
  amount_pence: 14900,
  tax_pence: 0,
  currency: 'GBP',
  status: 'paid',
  attempts: 1,
  failure_reason: null,
  issued_on: daysAgo(18 + i * 30).slice(0, 10),
  due_on: daysAgo(18 + i * 30).slice(0, 10),
  paid_at: daysAgo(18 + i * 30),
  period_start: daysAgo(18 + i * 30).slice(0, 10),
  period_end: daysAgo(-12 + i * 30).slice(0, 10),
  provider: 'stripe',
  provider_ref: `in_preview_${i}`,
  hosted_invoice_url: null,
  invoice_pdf: null,
  refunded_at: null,
  created_at: daysAgo(18 + i * 30),
  updated_at: daysAgo(18 + i * 30),
}));

const AUDIT_ACTIONS: readonly [string, string, string][] = [
  // Real action keys, so the labels shown are the ones `auditActions.ts` gives.
  ['leave.reviewed', 'leave_request', 'info'],
  ['timesheet.amended', 'clock_event', 'warning'],
  ['anonymize_staff_member', 'staff_profile', 'critical'],
  ['ai_assistant.rota_suggestions_generated', 'rota', 'info'],
  ['membership.changed', 'membership', 'notice'],
  ['org.settings_changed', 'organisation', 'info'],
];

const AUDIT_LOGS = AUDIT_ACTIONS.map(([action, entity, severity], i) => ({
  id: `al${i}`,
  org_id: ORG_ID,
  org_name: 'Sunnyvale Care Group',
  action,
  entity_type: entity,
  entity_id: `e${i}`,
  severity,
  scope: 'org',
  visibility: 'org',
  actor_user_id: USER_ID,
  actor_email: 'james.davis@sunnyvale.example',
  actor_name: 'James Davis',
  before_value: null,
  after_value: null,
  metadata: {},
  ip_address: null,
  user_agent: null,
  created_at: daysAgo(i),
}));

const TABLES: Record<string, unknown[]> = {
  organisations: ORGANISATIONS,
  locations: LOCATIONS,
  departments: DEPARTMENTS,
  profiles: PROFILES,
  app_settings: APP_SETTINGS,
  plans: PLANS,
  subscriptions: SUBSCRIPTIONS,
  invoices: INVOICES,
  audit_logs: AUDIT_LOGS,
  staff_profiles: STAFF_PROFILES,
  staff_profiles_visible: STAFF_PROFILES,
  memberships: [
    {
      id: 'm1',
      org_id: ORG_ID,
      user_id: USER_ID,
      role: 'owner',
      created_at: daysAgo(140),
    },
  ],
};

const RPCS: Record<string, unknown> = {
  my_org_billing_state: [{ state: 'active', read_only: false, trial_ends_at: null }],
  my_sessions: [],
};

/** Honours `eq.` filters, as `DashboardLivePreviewPage`'s fixture lookup does. */
function rowsFor(table: string, url: URL): unknown[] | undefined {
  const rows = TABLES[table] as Record<string, unknown>[] | undefined;
  if (rows === undefined) return undefined;
  let filtered = rows;
  for (const [key, raw] of url.searchParams.entries()) {
    if (!raw.startsWith('eq.')) continue;
    filtered = filtered.filter((r) => !(key in r) || String(r[key]) === raw.slice(3));
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
    const path = url.pathname.split('/rest/v1/')[1] ?? '';
    const data = path.startsWith('rpc/')
      ? (RPCS[path.slice(4)] ?? null)
      : (rowsFor(path, url) ?? []);

    const count = Array.isArray(data) ? data.length : 1;
    // `.single()` asks for one object through the Accept header, which
    // supabase-js may send as a `Headers` instance rather than a plain object.
    const accept =
      new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      ).get('accept') ?? '';
    const wantsSingle = accept.includes('vnd.pgrst.object');
    const body =
      init?.method === 'HEAD'
        ? ''
        : JSON.stringify(wantsSingle && Array.isArray(data) ? (data[0] ?? null) : data);
    return new Response(body, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'content-range': `0-${Math.max(0, count - 1)}/${count}`,
      },
    });
  };
}

/** `/settings-preview/account/security` → `/app/account/security`; anything else → `/app/settings/...`. */
function livePathFor(previewPath: string): string {
  const rest = previewPath.replace(/^\/settings-preview\/?/, '');
  return rest.startsWith('account/') ? `/app/${rest}` : `/app/settings/${rest}`;
}

export function SettingsLivePreviewPage(): JSX.Element {
  const livePath = livePathFor(useLocation().pathname);

  useState(() => {
    installFixtureFetch();
    return null;
  });

  const auth = useMemo<AuthContextValue>(
    () => ({
      user: {
        id: USER_ID,
        email: 'james.davis@sunnyvale.example',
        user_metadata: { full_name: 'James Davis' },
      } as unknown as AuthContextValue['user'],
      session: null,
      loading: false,
      signOut: async () => {},
    }),
    [],
  );

  const org = useMemo<OrgContextValue>(
    () => ({
      orgId: ORG_ID,
      orgName: 'Sunnyvale Care Group',
      role: 'owner',
      memberships: [{ orgId: ORG_ID, orgName: 'Sunnyvale Care Group', role: 'owner' }],
      isPlatformAdmin: false,
      platformRole: null,
      switchOrg: () => {},
      loading: false,
      loadFailed: false,
      createOrg: async () => {},
      refresh: async () => {},
    }),
    [],
  );

  return (
    <AuthContext.Provider value={auth}>
      <OrgContext.Provider value={org}>
        <div className="min-h-screen bg-background px-6 py-8 dark:bg-background-dark md:px-10">
          {/* Routed against the live path the screen would have, so the tab
              layouts highlight the active tab and title the page exactly as
              they do behind a session. `<Routes location>` alone refuses a
              path outside its parent route, so the route context is reset to
              the root as well. DEV-only harness, hence the UNSAFE contexts. */}
          <UNSAFE_RouteContext.Provider value={ROOT_ROUTE_CONTEXT}>
            <UNSAFE_LocationContext.Provider
              value={{
                location: {
                  pathname: livePath,
                  search: '',
                  hash: '',
                  state: null,
                  key: 'preview',
                },
                navigationType: NavigationType.Pop,
              }}
            >
              <Routes>
                <Route path="/app/settings" element={<SettingsLayout />}>
                  <Route path="organisation" element={<SettingsOrganisationPage />} />
                  <Route path="policies" element={<SettingsPoliciesPage />} />
                  <Route path="notifications" element={<SettingsNotificationsPage />} />
                  <Route path="integrations" element={<SettingsIntegrationsPage />} />
                  <Route path="billing" element={<SettingsBillingPage />} />
                  <Route path="audit" element={<SettingsAuditPage />} />
                </Route>
                <Route path="/app/account" element={<ProfileLayout />}>
                  <Route path="profile" element={<ProfilePage />} />
                  <Route path="preferences" element={<PreferencesPage />} />
                  <Route path="security" element={<SecurityPage />} />
                </Route>
              </Routes>
            </UNSAFE_LocationContext.Provider>
          </UNSAFE_RouteContext.Provider>
        </div>
      </OrgContext.Provider>
    </AuthContext.Provider>
  );
}
