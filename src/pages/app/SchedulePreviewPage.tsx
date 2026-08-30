import { format } from 'date-fns';
import { ManagerSchedule } from '@/components/schedule/ManagerSchedule';
import { StaffSchedule } from '@/components/schedule/StaffSchedule';
import { resolvePeriod, todayIso } from '@/lib/schedulePeriod';
import type { WeeklyRosterSummary } from '@/services/dashboardService';
import type {
  ClockEvent,
  LeaveRequest,
  Location,
  Shift,
  ShiftType,
  StaffProfile,
} from '@/types';

const ORG_ID = 'preview-org';
const TODAY = todayIso();
const NOW = new Date(`${TODAY}T13:00:00`);
const TZ = 'Europe/London';

function at(time: string): string {
  return new Date(`${TODAY}T${time}:00`).toISOString();
}

const LOCATIONS: Location[] = ['Sunnyvale Care Home', 'Riverside House'].map(
  (name, i) => ({
    id: `loc-${i}`,
    org_id: ORG_ID,
    name,
    address: null,
    latitude: null,
    longitude: null,
    timezone: TZ,
    geofence_radius_m: 100,
    location_type: null,
    status: 'active',
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  }),
);

const STAFF: StaffProfile[] = [
  'Sarah Johnson',
  'Michael Brown',
  'Emily Davis',
  'Daniel Lee',
  'Aisha Patel',
].map((full, i) => {
  const [first_name, last_name] = full.split(' ') as [string, string];
  return {
    id: `staff-${i}`,
    org_id: ORG_ID,
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
    start_date: null,
    phone: null,
    photo_url: null,
    active: true,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
});

const SHIFT_TYPES: ShiftType[] = [
  { name: 'Long day', colour: '#6CA0EB' },
  { name: 'Early', colour: '#4FB39A' },
  { name: 'Late', colour: '#C69A45' },
].map((t, i) => ({
  id: `type-${i}`,
  org_id: ORG_ID,
  name: t.name,
  colour: t.colour,
  default_start: null,
  default_end: null,
  is_paid: true,
  category: null,
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
}));

let shiftSeq = 0;
function mkShift(
  staffId: string,
  locationId: string,
  typeId: string,
  start: string,
  end: string,
): Shift {
  shiftSeq += 1;
  return {
    id: `shift-${shiftSeq}`,
    org_id: ORG_ID,
    rota_id: 'rota-preview',
    location_id: locationId,
    department_id: null,
    staff_profile_id: staffId,
    shift_type_id: typeId,
    starts_at: at(start),
    ends_at: at(end),
    break_minutes: 30,
    status: 'confirmed',
    colour: null,
    notes: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
}

const TODAY_SHIFTS: Shift[] = [
  mkShift('staff-0', 'loc-0', 'type-0', '07:00', '19:30'),
  mkShift('staff-1', 'loc-0', 'type-1', '07:00', '15:00'),
  mkShift('staff-2', 'loc-0', 'type-2', '14:00', '22:00'),
  mkShift('staff-4', 'loc-1', 'type-1', '07:00', '15:00'),
];

const LEAVE: LeaveRequest[] = [
  {
    id: 'leave-0',
    org_id: ORG_ID,
    staff_profile_id: 'staff-3',
    type: 'sick',
    start_date: TODAY,
    end_date: TODAY,
    status: 'approved',
    reason: null,
    reviewed_by: null,
    reviewed_at: null,
    client_event_id: null,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  },
];

function mkClockEvent(staffId: string, type: string, time: string): ClockEvent {
  return {
    id: `clock-${staffId}-${time}`,
    org_id: ORG_ID,
    staff_profile_id: staffId,
    shift_id: null,
    type,
    event_at: at(time),
    method: 'gps',
    latitude: null,
    longitude: null,
    accuracy: null,
    location_name: null,
    event_at_reported: null,
    client_event_id: null,
    synced: true,
    created_at: NOW.toISOString(),
    updated_at: NOW.toISOString(),
  };
}

const CLOCK_EVENTS: ClockEvent[] = [
  mkClockEvent('staff-0', 'in', '06:56'),
  mkClockEvent('staff-1', 'in', '07:12'),
  // staff-2's Late shift starts at 14:00; NOW is 13:00, so they read as "not
  // yet clocked in" rather than late, matching a still-accurate preview.
];

const WEEK_DATES = resolvePeriod('week', TODAY, TZ).dates;

const WEEKLY: WeeklyRosterSummary = {
  totalHours: 312,
  coverByDate: WEEK_DATES.map((date, i) => ({
    date,
    onShift: date === TODAY ? 3 : ([6, 6, 6, 6, 6, 5, 5][i] ?? 6),
    required: [6, 6, 6, 6, 6, 5, 5][i] ?? 6,
  })),
  hoursByDepartment: [],
  overLimitStaff: [],
  rotaStatus: 'draft',
};

const MY_SHIFTS: Shift[] = [mkShift('staff-0', 'loc-0', 'type-0', '07:00', '19:30')];
if (WEEK_DATES[4]) {
  MY_SHIFTS.push({
    ...mkShift('staff-0', 'loc-0', 'type-1', '07:00', '15:00'),
    starts_at: new Date(`${WEEK_DATES[4]}T07:00:00`).toISOString(),
    ends_at: new Date(`${WEEK_DATES[4]}T15:00:00`).toISOString(),
  });
}

/**
 * Design-loop preview only, at `/schedule-preview`. The real `/app/schedule`
 * needs a live Supabase session and a seeded organisation, neither of which a
 * screenshot tool has. Renders the real `ManagerSchedule`/`StaffSchedule`
 * against fixed mock data shaped to match `docs/ORGANISATION_WORKSPACE.html`'s
 * `SCREENS.schedule`. `?role=staff` switches branch.
 */
export function SchedulePreviewPage(): JSX.Element {
  const role = new URLSearchParams(window.location.search).get('role');

  return (
    <div className="p-8">
      {role === 'staff' ? (
        <StaffSchedule
          weekStartLabel={format(new Date(`${WEEK_DATES[0]}T00:00:00`), 'd MMMM yyyy')}
          weekDates={WEEK_DATES}
          published
          shifts={MY_SHIFTS}
          locations={LOCATIONS}
          shiftTypes={SHIFT_TYPES}
          fallbackTimezone={TZ}
          onAddToCalendar={() => {}}
        />
      ) : (
        <ManagerSchedule
          todayLabel={resolvePeriod('day', TODAY, TZ).label}
          weekly={WEEKLY}
          shifts={TODAY_SHIFTS}
          staff={STAFF}
          locations={LOCATIONS}
          shiftTypes={SHIFT_TYPES}
          leave={LEAVE}
          clockEvents={CLOCK_EVENTS}
        />
      )}
    </div>
  );
}
