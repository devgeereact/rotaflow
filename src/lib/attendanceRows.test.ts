import { describe, expect, it } from 'vitest';
import { buildAttendanceRows } from '@/lib/attendance';
import {
  ATTENDANCE_CSV_COLUMNS,
  ATTENDANCE_SORTS,
  buildAttendanceViewRows,
  formatMinutes,
  resolveJobTitle,
  type AttendanceLookups,
} from '@/lib/attendanceRows';
import { buildCsv } from '@/lib/csv';
import type { ClockEvent, JobTitle, Location, Shift, StaffProfile } from '@/types';

const TZ = 'Europe/London';

function staff(
  id: string,
  first: string,
  last: string,
  jobTitleId?: string,
): StaffProfile {
  return {
    id,
    org_id: 'org',
    user_id: null,
    email: null,
    first_name: first,
    last_name: last,
    job_title: 'Legacy text title',
    job_title_id: jobTitleId ?? null,
    department_id: null,
    contract_type: 'full_time',
    weekly_hours: 37.5,
    holiday_allowance: 28,
    payroll_id: null,
    phone: null,
    photo_url: null,
    skills: [],
    start_date: null,
    active: true,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

function title(id: string, name: string, colour: string | null, active = true): JobTitle {
  return {
    id,
    org_id: 'org',
    name,
    name_normalised: name.toLowerCase(),
    colour,
    active,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

const LOCATION: Location = {
  id: 'l1',
  org_id: 'org',
  name: 'Riverside House',
  address: null,
  timezone: TZ,
  geofence_radius_m: 100,
  location_type: null,
  status: 'active',
  latitude: null,
  longitude: null,
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

function lookups(overrides: Partial<AttendanceLookups> = {}): AttendanceLookups {
  return {
    staffById: new Map([['p', staff('p', 'Marcus', 'Webb', 't-nurse')]]),
    locationById: new Map([['l1', LOCATION]]),
    departmentById: new Map(),
    jobTitleById: new Map([['t-nurse', title('t-nurse', 'Registered Nurse', 'indigo')]]),
    fallbackTimezone: TZ,
    ...overrides,
  };
}

function shift(startsAt: string, endsAt: string, breakMinutes = 0): Shift {
  return {
    id: 's1',
    org_id: 'org',
    rota_id: 'r1',
    staff_profile_id: 'p',
    location_id: 'l1',
    department_id: null,
    shift_type_id: null,
    starts_at: startsAt,
    ends_at: endsAt,
    break_minutes: breakMinutes,
    notes: null,
    colour: null,
    status: 'assigned',
    created_at: startsAt,
    updated_at: startsAt,
  };
}

function event(type: ClockEvent['type'], at: string, id = `e-${at}`): ClockEvent {
  return {
    id,
    org_id: 'org',
    staff_profile_id: 'p',
    shift_id: null,
    type,
    event_at: at,
    event_at_reported: null,
    method: 'gps',
    location_name: 'Riverside House',
    latitude: null,
    longitude: null,
    accuracy: null,
    client_event_id: null,
    synced: true,
    created_at: at,
    updated_at: at,
  };
}

function view(
  shifts: Shift[],
  events: ClockEvent[],
  now: string,
): ReturnType<typeof buildAttendanceViewRows> {
  return buildAttendanceViewRows(
    buildAttendanceRows({
      shifts,
      events,
      now: new Date(now),
      timezone: TZ,
      windowFromIso: '2026-01-14T00:00:00.000Z',
      windowToIso: '2026-01-15T00:00:00.000Z',
    }),
    lookups(),
  );
}

describe('time labels', () => {
  it('prints the date beside an actual time that crosses midnight', () => {
    // "06:00" sitting to the right of "22:00" with nothing between them reads
    // as a morning gap, not an eight-hour night.
    const rows = view(
      [shift('2026-01-13T22:00:00.000Z', '2026-01-14T06:00:00.000Z')],
      [event('in', '2026-01-13T21:58:00.000Z'), event('out', '2026-01-14T06:02:00.000Z')],
      '2026-01-14T09:00:00.000Z',
    );
    expect(rows[0]?.plannedLabel).toBe('22:00 - 06:00 (14 Jan)');
    expect(rows[0]?.actualLabel).toBe('21:58 - 06:02 (14 Jan)');
  });

  it('does not print a date on a same-day shift', () => {
    const rows = view(
      [shift('2026-01-14T09:00:00.000Z', '2026-01-14T17:00:00.000Z')],
      [],
      '2026-01-14T18:00:00.000Z',
    );
    expect(rows[0]?.plannedLabel).toBe('09:00 - 17:00');
  });

  it('says "still in" rather than inventing a clock-out', () => {
    const rows = view(
      [shift('2026-01-14T09:00:00.000Z', '2026-01-14T17:00:00.000Z')],
      [event('in', '2026-01-14T09:00:00.000Z')],
      '2026-01-14T12:00:00.000Z',
    );
    expect(rows[0]?.actualLabel).toBe('09:00 - still in');
  });

  it('shows a dash for an unrecorded shift, not a zero', () => {
    const rows = view(
      [shift('2026-01-14T09:00:00.000Z', '2026-01-14T17:00:00.000Z')],
      [],
      '2026-01-14T18:00:00.000Z',
    );
    expect(rows[0]?.actualLabel).toBe('-');
    expect(rows[0]?.workedLabel).toBe('-');
    expect(rows[0]?.varianceLabel).toBe('-');
  });
});

describe('durations', () => {
  it('formats minutes, hours and both', () => {
    expect(formatMinutes(45)).toBe('45m');
    expect(formatMinutes(120)).toBe('2h');
    expect(formatMinutes(489)).toBe('8h 09m');
  });

  it('signs a variance and names an exact match', () => {
    const rows = view(
      [shift('2026-01-14T09:00:00.000Z', '2026-01-14T17:00:00.000Z')],
      [event('in', '2026-01-14T09:00:00.000Z'), event('out', '2026-01-14T17:00:00.000Z')],
      '2026-01-14T18:00:00.000Z',
    );
    expect(rows[0]?.varianceLabel).toBe('on time');
  });
});

describe('issue wording', () => {
  it('never calls an unrecorded shift an absence', () => {
    const rows = view(
      [shift('2026-01-14T09:00:00.000Z', '2026-01-14T17:00:00.000Z')],
      [],
      '2026-01-14T18:00:00.000Z',
    );
    expect(rows[0]?.issue).toContain('No clock events reached the server');
    expect(rows[0]?.issue?.toLowerCase()).not.toContain('absent');
    expect(rows[0]?.issue).toContain('offline');
  });

  it('says how late a late start is', () => {
    const rows = view(
      [shift('2026-01-14T09:00:00.000Z', '2026-01-14T17:00:00.000Z')],
      [],
      '2026-01-14T10:00:00.000Z',
    );
    expect(rows[0]?.issue).toContain('1h ago');
  });
});

describe('job titles', () => {
  it('prefers the catalogue entry over the legacy free text', () => {
    const resolved = resolveJobTitle(
      staff('p', 'Marcus', 'Webb', 't-nurse'),
      new Map([['t-nurse', title('t-nurse', 'Registered Nurse', 'indigo')]]),
    );
    expect(resolved.name).toBe('Registered Nurse');
    expect(resolved.colour).toBe('indigo');
  });

  it('falls back to the free text where no catalogue entry is set', () => {
    const resolved = resolveJobTitle(staff('p', 'Marcus', 'Webb'), new Map());
    expect(resolved.name).toBe('Legacy text title');
    expect(resolved.colour).toBeNull();
  });

  it('keeps rendering an archived title on the person who holds it', () => {
    const resolved = resolveJobTitle(
      staff('p', 'Marcus', 'Webb', 't-old'),
      new Map([['t-old', title('t-old', 'Ward Clerk', 'rose', false)]]),
    );
    expect(resolved.name).toBe('Ward Clerk');
  });

  it('carries a short code so the badge is not colour alone', () => {
    const rows = view(
      [shift('2026-01-14T09:00:00.000Z', '2026-01-14T17:00:00.000Z')],
      [],
      '2026-01-14T10:00:00.000Z',
    );
    expect(rows[0]?.jobTitleCode).toBe('RN');
  });
});

describe('sorting', () => {
  it('pushes rows with no planned start to the end rather than the front', () => {
    const rows = view(
      [shift('2026-01-14T09:00:00.000Z', '2026-01-14T17:00:00.000Z')],
      [
        event('in', '2026-01-14T02:00:00.000Z', 'stray-in'),
        event('out', '2026-01-14T04:00:00.000Z', 'stray-out'),
      ],
      '2026-01-14T18:00:00.000Z',
    );
    const spec = ATTENDANCE_SORTS.find((s) => s.id === 'expected')!;
    const sorted = [...rows].sort(spec.compare);
    expect(sorted[0]?.shiftId).toBe('s1');
    expect(sorted[sorted.length - 1]?.shiftId).toBeNull();
  });
});

describe('export', () => {
  it('dates a night shift by its start, matching the payroll allocation rule', () => {
    const rows = view(
      [shift('2026-01-13T22:00:00.000Z', '2026-01-14T06:00:00.000Z')],
      [],
      '2026-01-14T09:00:00.000Z',
    );
    const csv = buildCsv(rows, [...ATTENDANCE_CSV_COLUMNS]);
    expect(csv).toContain('2026-01-13');
  });

  it('names the timezone in every row', () => {
    const rows = view(
      [shift('2026-01-14T09:00:00.000Z', '2026-01-14T17:00:00.000Z')],
      [],
      '2026-01-14T18:00:00.000Z',
    );
    const csv = buildCsv(rows, [...ATTENDANCE_CSV_COLUMNS]);
    expect(csv).toContain('Europe/London');
  });
});
