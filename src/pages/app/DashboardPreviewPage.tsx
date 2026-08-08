import { useState } from 'react';
import { format } from 'date-fns';
import { DashboardView } from '@/components/dashboard/DashboardView';
import type {
  DashboardOverview,
  PendingRequest,
  ShiftGroup,
} from '@/services/dashboardService';
import type { Announcement, Location, StaffProfile } from '@/types';

const TODAY = format(new Date(), 'yyyy-MM-dd');
/** Fixed "now" so Ongoing / Starts-in labels always read the way the reference shows them, regardless of when this is screenshotted. */
const NOW = new Date(`${TODAY}T13:00:00`);

function at(time: string, dayOffset = 0): string {
  const d = new Date(`${TODAY}T${time}:00`);
  d.setDate(d.getDate() + dayOffset);
  return d.toISOString();
}

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

const DAY_GROUPS: ShiftGroup[] = [
  {
    key: '1',
    shiftTypeName: 'Morning Care Shift',
    colour: '#3B6FE0',
    locationName: 'Sunnyvale Care Home',
    startsAt: at('07:00'),
    endsAt: at('15:00'),
    filled: 8,
    total: 10,
  },
  {
    key: '2',
    shiftTypeName: 'Day Shift',
    colour: '#6CA0EB',
    locationName: 'Riverside House',
    startsAt: at('09:00'),
    endsAt: at('17:00'),
    filled: 6,
    total: 7,
  },
  {
    key: '3',
    shiftTypeName: 'Evening Shift',
    colour: '#C69A45',
    locationName: 'Oakview Care Home',
    startsAt: at('15:00'),
    endsAt: at('23:00'),
    filled: 6,
    total: 6,
  },
  {
    key: '4',
    shiftTypeName: 'Night Shift',
    colour: '#4FB39A',
    locationName: 'Riverside House',
    startsAt: at('23:00'),
    endsAt: at('07:00', 1),
    filled: 2,
    total: 4,
  },
];

const PENDING: PendingRequest[] = [
  {
    id: 'p1',
    kind: 'leave',
    staffName: 'Sarah Johnson',
    detail: 'Annual leave',
    dateLabel: '2-6 Jun',
    createdAt: NOW.toISOString(),
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

const UPCOMING: ShiftGroup[] = [
  {
    key: 'u1',
    shiftTypeName: 'Morning Care Shift',
    colour: '#3B6FE0',
    locationName: 'Sunnyvale Care Home',
    startsAt: at('07:00', 1),
    endsAt: at('15:00', 1),
    filled: 10,
    total: 10,
  },
  {
    key: 'u2',
    shiftTypeName: 'Evening Shift',
    colour: '#C69A45',
    locationName: 'Oakview Care Home',
    startsAt: at('15:00', 2),
    endsAt: at('23:00', 2),
    filled: 6,
    total: 6,
  },
  {
    key: 'u3',
    shiftTypeName: 'Night Shift',
    colour: '#4FB39A',
    locationName: 'Riverside House',
    startsAt: at('23:00', 3),
    endsAt: at('07:00', 4),
    filled: 4,
    total: 4,
  },
];

const monthShiftsByDate = new Map<string, { total: number; filled: number }>();
for (let day = 1; day <= 31; day++) {
  const date = new Date(NOW.getFullYear(), NOW.getMonth(), day);
  if (date.getMonth() !== NOW.getMonth()) continue;
  const iso = format(date, 'yyyy-MM-dd');
  // Weekends lighter, and every 6th day shown understaffed, just enough
  // variation to demonstrate both calendar dot colours.
  const weekday = date.getDay();
  if (weekday === 0 || weekday === 6) {
    monthShiftsByDate.set(iso, { total: 4, filled: 4 });
  } else {
    monthShiftsByDate.set(iso, { total: 8, filled: day % 6 === 0 ? 6 : 8 });
  }
}

/** One day short of the minimum, three days out, same pattern the seeded demo plants on purpose. */
const weekCover: DashboardOverview['weekCover'] = Array.from({ length: 7 }, (_, i) => {
  const date = new Date(NOW);
  date.setDate(date.getDate() + i);
  const required = 9;
  return { date: format(date, 'yyyy-MM-dd'), required, onShift: i === 3 ? 7 : required };
});

const hoursByDepartment: DashboardOverview['hoursByDepartment'] = [
  { departmentId: 'dept-nursing', departmentName: 'Nursing', hours: 284 },
  { departmentId: 'dept-dementia', departmentName: 'Dementia Care', hours: 112 },
  { departmentId: 'dept-wellbeing', departmentName: 'Wellbeing', hours: 61 },
];

const OVERVIEW: DashboardOverview = {
  staff: STAFF,
  locations: LOCATIONS,
  shiftTypes: [],
  announcements: ANNOUNCEMENTS,
  compliancePercent: 96,
  monthShiftsByDate,
  upcomingGroups: UPCOMING,
  weekCover,
  hoursByDepartment,
};

/**
 * Design-loop preview only, at `/dashboard-preview`. The real `/app/dashboard`
 * needs a live Supabase session and a seeded organisation (shifts, staff,
 * requests, announcements), neither of which a screenshot tool has. Renders
 * the same `DashboardView` against fixed mock data shaped to match
 * design/Workforce-Dashboard.png's numbers, so the screen can be verified
 * visually without a real account.
 */
export function DashboardPreviewPage(): JSX.Element {
  const [dayLabel, setDayLabel] = useState(format(new Date(TODAY), 'EEEE, d MMMM yyyy'));

  return (
    <div className="p-8">
      <DashboardView
        firstName="James"
        canManage
        overview={OVERVIEW}
        pending={PENDING}
        myShifts={[]}
        dayGroups={DAY_GROUPS}
        dayLoading={false}
        dayLabel={dayLabel}
        timezone="Europe/London"
        now={NOW}
        onPrevDay={() => setDayLabel('Previous day (preview only)')}
        onNextDay={() => setDayLabel('Next day (preview only)')}
        onToday={() => setDayLabel('Today')}
        onSelectDate={() => setDayLabel('Selected date (preview only)')}
      />
    </div>
  );
}
