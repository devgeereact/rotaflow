import { format } from 'date-fns';
import { ManagerDashboard } from '@/components/dashboard/ManagerDashboard';
import { StaffDashboard } from '@/components/dashboard/StaffDashboard';
import type {
  DashboardOverview,
  MyWeekSummary,
  PendingRequest,
  ShiftGroup,
  WeeklyRosterSummary,
} from '@/services/dashboardService';
import type { Announcement, Location, StaffProfile } from '@/types';

const TODAY = format(new Date(), 'yyyy-MM-dd');
const NOW = new Date(`${TODAY}T13:00:00`);

function at(time: string, dayOffset = 0): string {
  const d = new Date(`${TODAY}T${time}:00`);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString();
}

/** Monday of the current week, so the cover chart's dates land on real weekdays. */
const MONDAY = (() => {
  const d = new Date(`${TODAY}T00:00:00`);
  const day = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - day);
  return d;
})();
const weekDate = (offset: number): string =>
  format(new Date(MONDAY.getTime() + offset * 86_400_000), 'yyyy-MM-dd');

const LOCATIONS: Location[] = [
  'Sunnyvale Care Home',
  'Riverside House',
  'Oakview Care Home',
].map((name, i) => ({
  id: `loc-${i}`,
  org_id: 'preview',
  name,
  address: null,
  timezone: 'Europe/London',
  geofence_radius_m: 100,
  location_type: null,
  status: 'active',
  latitude: null,
  longitude: null,
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
}));

const STAFF: StaffProfile[] = [
  'Sarah Johnson',
  'Michael Brown',
  'Emily Davis',
  'James Davis',
].map((full, i) => {
  const [first_name, last_name] = full.split(' ') as [string, string];
  return {
    id: `staff-${i}`,
    org_id: 'preview',
    user_id: null,
    email: null,
    first_name,
    last_name,
    job_title: 'Care Assistant',
    department_id: null,
    contract_type: 'full_time',
    weekly_hours: 37.5,
    holiday_allowance: 28,
    skills: [],
    payroll_id: null,
    start_date: NOW.toISOString().slice(0, 10),
    phone: null,
    photo_url: null,
    active: true,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
});

const PENDING: PendingRequest[] = [
  {
    id: 'p1',
    kind: 'leave',
    staffName: 'Sarah Johnson',
    detail: 'Annual leave',
    dateLabel: '2-6 Jun',
    createdAt: new Date(NOW.getTime() - 16 * 86_400_000).toISOString(),
  },
  {
    id: 'p2',
    kind: 'swap',
    staffName: 'Michael Brown',
    detail: 'Shift swap',
    dateLabel: '30 May',
    createdAt: NOW.toISOString(),
  },
  {
    id: 'p3',
    kind: 'leave',
    staffName: 'Emily Davis',
    detail: 'Annual leave',
    dateLabel: '16-18 Jun',
    createdAt: NOW.toISOString(),
  },
];

const ANNOUNCEMENTS: Announcement[] = [
  {
    id: 'a1',
    org_id: 'preview',
    author_user_id: null,
    title: 'Staff Meeting Reminder',
    body: "Don't forget our monthly staff meeting tomorrow at 10:00 in the main office.",
    scope: 'org',
    location_id: null,
    department_id: null,
    urgent: false,
    published_at: NOW.toISOString(),
    created_at: new Date(NOW.getTime() - 2 * 3_600_000).toISOString(),
    updated_at: NOW.toISOString(),
  },
  {
    id: 'a2',
    org_id: 'preview',
    author_user_id: null,
    title: 'New Training Available',
    body: 'Moving & Handling Refresher is now available. Please check your training.',
    scope: 'org',
    location_id: null,
    department_id: null,
    urgent: false,
    published_at: NOW.toISOString(),
    created_at: new Date(NOW.getTime() - 26 * 3_600_000).toISOString(),
    updated_at: NOW.toISOString(),
  },
  {
    id: 'a3',
    org_id: 'preview',
    author_user_id: null,
    title: 'Bank Holiday Notice',
    body: 'Please note our opening hours for the Spring Bank Holiday.',
    scope: 'org',
    location_id: null,
    department_id: null,
    urgent: false,
    published_at: NOW.toISOString(),
    created_at: new Date(NOW.getTime() - 48 * 3_600_000).toISOString(),
    updated_at: NOW.toISOString(),
  },
];

const monthShiftsByDate = new Map<string, { total: number; filled: number }>();
for (let day = 1; day <= 31; day++) {
  const date = new Date(NOW.getFullYear(), NOW.getMonth(), day);
  if (date.getMonth() !== NOW.getMonth()) continue;
  const iso = format(date, 'yyyy-MM-dd');
  const weekday = date.getDay();
  if (weekday === 0 || weekday === 6) {
    monthShiftsByDate.set(iso, { total: 4, filled: 4 });
  } else {
    monthShiftsByDate.set(iso, { total: 8, filled: day % 6 === 0 ? 6 : 8 });
  }
}

const OVERVIEW: DashboardOverview = {
  staff: STAFF,
  locations: LOCATIONS,
  shiftTypes: [],
  announcements: ANNOUNCEMENTS,
  compliancePercent: 96,
  monthShiftsByDate,
  upcomingGroups: [],
};

const WEEKLY: WeeklyRosterSummary = {
  totalHours: 365,
  coverByDate: [6, 6, 6, 5, 6, 5, 4].map((onShift, i) => ({
    date: weekDate(i),
    onShift,
    required: 6,
  })),
  hoursByDepartment: [
    { name: 'Nursing', hours: 267 },
    { name: 'Dementia', hours: 78 },
    { name: 'Wellbeing', hours: 20 },
  ],
  overLimitStaff: [
    { staffName: 'Amara Osei', hours: 49, contractHours: 37.5, overStatutory: true },
  ],
  rotaStatus: 'draft',
};

const MY_WEEK: MyWeekSummary = { hours: 32, shiftsBooked: 4 };

const MY_UPCOMING: ShiftGroup[] = [
  {
    key: 'u1',
    shiftTypeName: 'Morning Care Shift',
    colour: '#3B6FE0',
    locationName: 'Sunnyvale Care Home',
    startsAt: at('07:00', 1),
    endsAt: at('15:00', 1),
    filled: 1,
    total: 1,
  },
  {
    key: 'u2',
    shiftTypeName: 'Evening Shift',
    colour: '#C69A45',
    locationName: 'Oakview Care Home',
    startsAt: at('15:00', 2),
    endsAt: at('23:00', 2),
    filled: 1,
    total: 1,
  },
];

/**
 * Design-loop preview only, at `/dashboard-preview`. The real `/app/dashboard`
 * needs a live Supabase session and a seeded organisation, neither of which a
 * screenshot tool has. Renders the real `ManagerDashboard`/`StaffDashboard`
 * against fixed mock data shaped to match
 * `docs/ORGANISATION_WORKSPACE.html`'s numbers. `?role=staff` switches branch.
 */
export function DashboardPreviewPage(): JSX.Element {
  const role = new URLSearchParams(window.location.search).get('role');

  return (
    <div className="p-8">
      {role === 'staff' ? (
        <StaffDashboard
          firstName="Priya"
          overview={OVERVIEW}
          myWeek={MY_WEEK}
          myUpcoming={MY_UPCOMING}
          leaveRemaining={11}
          holidayAllowance={28}
          openSwaps={2}
        />
      ) : (
        <ManagerDashboard
          firstName="Marcus"
          orgName="Sunnyvale Care Group"
          overview={OVERVIEW}
          pending={PENDING}
          weekly={WEEKLY}
          hoursTrend={[402, 418, 396, 441, 428, 449, 462]}
        />
      )}
    </div>
  );
}
