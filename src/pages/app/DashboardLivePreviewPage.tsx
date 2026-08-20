import { useMemo, useState } from 'react';
import { AuthContext, type AuthContextValue } from '@/context/AuthContext';
import { OrgContext, type OrgContextValue } from '@/context/OrgContext';
import { DashboardPage } from '@/pages/app/DashboardPage';

/**
 * Debug harness for `/app/dashboard`, **development only**.
 *
 * ## Why this exists
 *
 * `DashboardPreviewPage` (`/dashboard-preview`) renders `ManagerDashboard` /
 * `StaffDashboard` directly against hand-built fixtures. That verifies the
 * presentational components, but it never runs `DashboardPage` itself, its
 * hooks, its `Promise.all` fan-out, its real service calls. A crash living in
 * that wiring (a `TypeError` on a shape only real data produces) is invisible
 * to it, which is exactly the bug this harness exists to catch: the
 * dashboard threw for a signed-in owner and the fixture preview had shown
 * nothing wrong.
 *
 * Same move as `AdminPreviewHarness`: mount the **real** page, intercept
 * `fetch` so Supabase answers from fixtures chosen to include the edge cases
 * fixtures normally sand away (`organisations.settings` null, a
 * `holiday_allowance` of null, a leave request from a staff id no longer in
 * the roster, shifts with a null `department_id`, a mixed draft/published
 * week). Also stubs `AuthContext`, `DashboardPage` needs a real `user.id`,
 * which `OrgContext` alone does not provide.
 */

const ORG_ID = 'preview-org';
const USER_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const STAFF_IDS = ['s1', 's2', 's3', 's4'];
const DEPT_ID = 'dept1';
const SHIFT_TYPE_ID = 'st1';

const now = new Date();
const ISO = (d: Date): string => d.toISOString();

function mondayOf(d: Date): Date {
  const copy = new Date(d);
  const day = (copy.getDay() + 6) % 7;
  copy.setDate(copy.getDate() - day);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function stamp(base: Date, dayOffset: number, hour: number): string {
  const d = new Date(base);
  d.setDate(d.getDate() + dayOffset);
  d.setHours(hour, 0, 0, 0);
  return ISO(d);
}

const THIS_MONDAY = mondayOf(now);

const PROFILES = [
  { id: USER_ID, full_name: 'Preview Owner', email: 'owner@preview.test' },
];

const ORGANISATIONS = [
  {
    id: ORG_ID,
    name: 'Preview Care Group',
    slug: 'preview-care',
    // Deliberately null: a fresh org has never saved Settings -> Policies.
    settings: null,
  },
];

const STAFF_PROFILES = [
  {
    id: 's1',
    org_id: ORG_ID,
    user_id: USER_ID,
    first_name: 'Owner',
    last_name: 'Person',
    job_title: 'Registered Manager',
    department_id: DEPT_ID,
    weekly_hours: 37.5,
    // Deliberately null: not every staff row has this filled in.
    holiday_allowance: null,
    active: true,
  },
  {
    id: 's2',
    org_id: ORG_ID,
    user_id: null,
    first_name: 'Amara',
    last_name: 'Osei',
    job_title: 'Senior Carer',
    department_id: DEPT_ID,
    weekly_hours: 37.5,
    holiday_allowance: 28,
    active: true,
  },
  {
    id: 's3',
    org_id: ORG_ID,
    user_id: null,
    first_name: 'Callum',
    last_name: 'Reid',
    job_title: 'Care Assistant',
    // Deliberately null: an unassigned department.
    department_id: null,
    weekly_hours: 30,
    holiday_allowance: 24,
    active: true,
  },
  {
    id: 's4',
    org_id: ORG_ID,
    user_id: null,
    first_name: 'Priya',
    last_name: 'Raman',
    job_title: 'Night Lead',
    department_id: DEPT_ID,
    weekly_hours: 37.5,
    holiday_allowance: 28,
    active: true,
  },
];

const LOCATIONS = [
  { id: 'loc1', org_id: ORG_ID, name: 'Sunnyvale House', timezone: 'Europe/London' },
  { id: 'loc2', org_id: ORG_ID, name: 'Oak Lodge', timezone: 'Europe/London' },
];

const DEPARTMENTS = [
  { id: DEPT_ID, org_id: ORG_ID, location_id: 'loc1', name: 'Nursing' },
];

const SHIFT_TYPES = [
  {
    id: SHIFT_TYPE_ID,
    org_id: ORG_ID,
    name: 'Long day',
    colour: '#6CA0EB',
    default_start: '07:00:00',
    default_end: '19:30:00',
  },
];

const ROTAS = [
  {
    id: 'rota-current-loc1',
    org_id: ORG_ID,
    location_id: 'loc1',
    period_start: ISO(THIS_MONDAY).slice(0, 10),
    period_end: ISO(new Date(THIS_MONDAY.getTime() + 6 * 86_400_000)).slice(0, 10),
    status: 'draft',
  },
  {
    id: 'rota-current-loc2',
    org_id: ORG_ID,
    location_id: 'loc2',
    period_start: ISO(THIS_MONDAY).slice(0, 10),
    period_end: ISO(new Date(THIS_MONDAY.getTime() + 6 * 86_400_000)).slice(0, 10),
    status: 'published',
  },
];

/** Shifts across the last 7 weeks plus the current week, mixed published/draft, mixed department. */
const SHIFTS = (() => {
  const rows: Record<string, unknown>[] = [];
  for (let week = -6; week <= 0; week++) {
    const weekMonday = new Date(THIS_MONDAY.getTime() + week * 7 * 86_400_000);
    const rotaStatus = week === 0 ? 'draft' : 'published';
    for (let day = 0; day < 5; day++) {
      const staffId = STAFF_IDS[day % STAFF_IDS.length]!;
      rows.push({
        id: `shift-${week}-${day}`,
        org_id: ORG_ID,
        rota_id: week === 0 ? 'rota-current-loc1' : `rota-past-${week}`,
        location_id: day % 2 === 0 ? 'loc1' : 'loc2',
        // Deliberately null on some rows: an unassigned department on a shift.
        department_id: day % 3 === 0 ? null : DEPT_ID,
        staff_profile_id: day === 4 ? null : staffId, // one open/unfilled shift per week
        shift_type_id: SHIFT_TYPE_ID,
        starts_at: stamp(weekMonday, day, 7),
        ends_at: stamp(weekMonday, day, 19),
        // Deliberately 0, not null: exercises the numeric-zero path distinctly from null.
        break_minutes: 0,
        status: 'assigned',
        colour: null,
        notes: null,
        rota: { status: rotaStatus },
      });
    }
  }
  return rows;
})();

const LEAVE_REQUESTS = [
  {
    id: 'lv1',
    org_id: ORG_ID,
    // Deliberately not in STAFF_PROFILES: simulates a since-deactivated staff member.
    staff_profile_id: 'ghost-staff',
    type: 'annual',
    start_date: ISO(new Date(now.getTime() + 5 * 86_400_000)).slice(0, 10),
    end_date: ISO(new Date(now.getTime() + 9 * 86_400_000)).slice(0, 10),
    status: 'pending',
    created_at: ISO(new Date(now.getTime() - 16 * 86_400_000)),
  },
  {
    id: 'lv2',
    org_id: ORG_ID,
    staff_profile_id: 's2',
    type: 'annual',
    start_date: ISO(new Date(now.getTime() + 20 * 86_400_000)).slice(0, 10),
    end_date: ISO(new Date(now.getTime() + 24 * 86_400_000)).slice(0, 10),
    status: 'approved',
    created_at: ISO(new Date(now.getTime() - 40 * 86_400_000)),
  },
];

const SHIFT_SWAPS = [
  {
    id: 'sw1',
    org_id: ORG_ID,
    shift_id: 'shift-0-1',
    requested_by: 's3',
    target_staff_profile_id: null,
    status: 'pending',
    created_at: ISO(now),
    shift: SHIFTS.find((s) => s.id === 'shift-0-1') ?? null,
  },
];

const ANNOUNCEMENTS = [
  {
    id: 'a1',
    org_id: ORG_ID,
    title: 'Fire drill Wednesday',
    body: 'Full evacuation drill at 10:00.',
    urgent: false,
    created_at: ISO(new Date(now.getTime() - 2 * 3_600_000)),
  },
];

const TABLES: Record<string, unknown[]> = {
  profiles: PROFILES,
  organisations: ORGANISATIONS,
  staff_profiles: STAFF_PROFILES,
  locations: LOCATIONS,
  departments: DEPARTMENTS,
  shift_types: SHIFT_TYPES,
  rotas: ROTAS,
  shifts: SHIFTS,
  leave_requests: LEAVE_REQUESTS,
  shift_swaps: SHIFT_SWAPS,
  announcements: ANNOUNCEMENTS,
  documents: [],
};

/**
 * Honours every `?col=eq.value` filter a real query sends, not just `id`.
 * `getMyStaffProfile` filters on `org_id` *and* `user_id` together; matching
 * only `id` returned all four fixture rows for a `.maybeSingle()` call and
 * threw PGRST116, a bug in this harness, not in the app it was built to test.
 */
function fixtureFor(table: string, url: URL): unknown {
  const rows = TABLES[table];
  if (rows === undefined) return undefined;

  let filtered = rows as Record<string, unknown>[];
  for (const [key, raw] of url.searchParams.entries()) {
    if (key === 'select' || key === 'order' || key === 'limit') continue;
    if (!raw.startsWith('eq.')) continue;
    const wanted = raw.slice(3);
    filtered = filtered.filter((r) => String(r[key]) === wanted);
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
      console.warn(`[dashboard-live-preview] no fixture for "${table}". Returning []`);
    }
    const rows = data === undefined ? [] : data;
    const count = Array.isArray(rows) ? rows.length : 1;
    const headers = new Headers({
      'content-type': 'application/json',
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

export function DashboardLivePreviewPage(): JSX.Element {
  useState(() => {
    installFixtureFetch();
    return null;
  });

  const auth = useMemo<AuthContextValue>(
    () => ({
      user: { id: USER_ID, email: 'owner@preview.test' } as AuthContextValue['user'],
      session: null,
      loading: false,
      signOut: async () => {},
    }),
    [],
  );

  const role = new URLSearchParams(window.location.search).get('role');

  const org = useMemo<OrgContextValue>(
    () => ({
      orgId: ORG_ID,
      orgName: 'Preview Care Group',
      role: role === 'staff' ? 'staff' : role === 'manager' ? 'manager' : 'owner',
      memberships: [],
      isPlatformAdmin: false,
      platformRole: null,
      switchOrg: () => {},
      loading: false,
      loadFailed: false,
      createOrg: async () => {},
      refresh: async () => {},
    }),
    [role],
  );

  return (
    <AuthContext.Provider value={auth}>
      <OrgContext.Provider value={org}>
        <div className="min-h-screen bg-background px-6 py-8 dark:bg-background-dark md:px-10">
          <DashboardPage />
        </div>
      </OrgContext.Provider>
    </AuthContext.Provider>
  );
}
