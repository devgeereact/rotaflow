import { format } from 'date-fns';
import {
  OperationsDashboard,
  type OperationsDaySnapshot,
} from '@/components/dashboard/OperationsDashboard';
import { buildAttendanceViewRows } from '@/lib/attendanceRows';
import {
  buildAttendanceRows,
  summariseAttendance,
  type AttendanceCounts,
} from '@/lib/attendance';
import { operationalWindow, nextDay } from '@/lib/operationalDay';
import type { ClockEvent, Shift } from '@/types';
import { StaffDashboard } from '@/components/dashboard/StaffDashboard';
import type {
  DashboardOverview,
  MyWeekSummary,
  PendingRequest,
  ShiftGroup,
  WeeklyRosterSummary,
} from '@/services/dashboardService';
import type { Announcement, Location, StaffProfile } from '@/types';
import { PreviewCanvas } from '@/components/ui/PreviewCanvas';

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
    job_title_id: null,
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
 * A day's worth of shifts and clock events, built so the preview exercises
 * every attendance state rather than a happy path.
 *
 * One person working, one on a break, one who finished, one starting later
 * and one overdue with nothing recorded. This is the same set the acceptance
 * tests use, and it is here so a screenshot of this screen shows what the
 * states actually look like beside each other.
 */
const PREVIEW_TZ = 'Europe/London';

function previewShift(
  id: string,
  staffIndex: number,
  start: string,
  end: string,
  dayOffset = 0,
): Shift {
  return {
    id,
    org_id: 'preview',
    rota_id: 'rota-preview',
    staff_profile_id: `staff-${staffIndex}`,
    location_id: 'loc-0',
    department_id: null,
    shift_type_id: null,
    starts_at: at(start, dayOffset),
    ends_at: at(end, dayOffset),
    break_minutes: 30,
    notes: null,
    colour: null,
    status: 'scheduled',
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
}

function previewEvent(
  id: string,
  staffIndex: number,
  type: string,
  time: string,
  dayOffset = 0,
): ClockEvent {
  return {
    id,
    org_id: 'preview',
    staff_profile_id: `staff-${staffIndex}`,
    shift_id: null,
    type,
    event_at: at(time, dayOffset),
    event_at_reported: null,
    method: 'gps',
    location_name: 'Sunnyvale Care Home',
    latitude: null,
    longitude: null,
    accuracy: null,
    client_event_id: null,
    synced: true,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
}

const PREVIEW_SHIFTS: Shift[] = [
  previewShift('shift-working', 0, '07:00', '19:00'),
  previewShift('shift-break', 1, '08:00', '16:00'),
  previewShift('shift-done', 2, '06:00', '12:00'),
  previewShift('shift-later', 3, '14:00', '22:00'),
];

const PREVIEW_EVENTS: ClockEvent[] = [
  previewEvent('ev-1', 0, 'in', '06:58'),
  previewEvent('ev-2', 1, 'in', '07:59'),
  previewEvent('ev-3', 1, 'break_start', '12:30'),
  previewEvent('ev-4', 2, 'in', '05:57'),
  previewEvent('ev-5', 2, 'out', '12:04'),
];

function previewDay(
  date: string,
  shifts: Shift[],
  events: ClockEvent[],
): OperationsDaySnapshot {
  const window = operationalWindow(date, PREVIEW_TZ);
  const rows = buildAttendanceRows({
    shifts,
    events,
    now: NOW,
    timezone: PREVIEW_TZ,
    windowFromIso: window.fromIso,
    windowToIso: window.toIso,
  });
  const counts: AttendanceCounts = summariseAttendance(rows, shifts);
  return {
    date,
    rows: buildAttendanceViewRows(rows, {
      staffById: new Map(STAFF.map((s) => [s.id, s])),
      locationById: new Map(LOCATIONS.map((l) => [l.id, l])),
      departmentById: new Map(),
      jobTitleById: new Map(),
      fallbackTimezone: PREVIEW_TZ,
    }),
    counts,
    failed: false,
  };
}

/**
 * Design-loop preview only, at `/dashboard-preview`. The real `/app/dashboard`
 * needs a live Supabase session and a seeded organisation, neither of which a
 * screenshot tool has. Renders the real
 * `OperationsDashboard`/`StaffDashboard` against fixed mock data.
 * `?role=staff` switches branch.
 */
export function DashboardPreviewPage(): JSX.Element {
  const role = new URLSearchParams(window.location.search).get('role');

  return (
    <PreviewCanvas>
      {role === 'staff' ? (
        <StaffDashboard
          firstName="Priya"
          overview={OVERVIEW}
          myWeek={MY_WEEK}
          myUpcoming={MY_UPCOMING}
          leaveRemaining={11}
          holidayAllowance={28}
          openSwaps={2}
          timezone="Europe/London"
        />
      ) : (
        <OperationsDashboard
          orgName="Sunnyvale Care Group"
          locations={LOCATIONS}
          selectedLocationId={null}
          onSelectLocation={() => undefined}
          timezone={PREVIEW_TZ}
          mixedTimezones={false}
          today={previewDay(TODAY, PREVIEW_SHIFTS, PREVIEW_EVENTS)}
          tomorrow={previewDay(
            nextDay(TODAY),
            [previewShift('shift-tomorrow', 0, '07:00', '19:00', 1)],
            [],
          )}
          staffingDay="today"
          onStaffingDayChange={() => undefined}
          pending={PENDING}
          weekly={WEEKLY}
          fetchedAt={NOW.toISOString()}
          refreshing={false}
          stale={false}
          onRefresh={() => undefined}
          sort="expected"
          direction="asc"
          onSort={() => undefined}
          onOpenRow={() => undefined}
          // The preview organisation is fully set up, so the banner is absent —
          // which is the state a screenshot of this screen should show.
          setup={{ requiredDone: 6, requiredTotal: 6, nextTitle: '' }}
        />
      )}
    </PreviewCanvas>
  );
}
