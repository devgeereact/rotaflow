import { describe, expect, it } from 'vitest';
import {
  buildTeamRows,
  buildTeamTiles,
  onTypeOfLeaveToday,
  sumRosteredHours,
  weekRangeIso,
} from '@/lib/teamRows';
import type { Department, LeaveRequest, Location, Shift, StaffProfile } from '@/types';

function mkStaff(overrides: Partial<StaffProfile> = {}): StaffProfile {
  return {
    id: 's1',
    org_id: 'org-1',
    user_id: null,
    email: null,
    first_name: 'Amara',
    last_name: 'Osei',
    job_title: 'Senior Carer',
    department_id: null,
    photo_url: null,
    phone: null,
    active: true,
    contract_type: null,
    holiday_allowance: 28,
    payroll_id: null,
    skills: [],
    start_date: null,
    weekly_hours: 37.5,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function mkShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'sh1',
    org_id: 'org-1',
    rota_id: 'r1',
    staff_profile_id: 's1',
    department_id: null,
    location_id: null,
    shift_type_id: null,
    starts_at: '2026-08-10T07:00:00.000Z',
    ends_at: '2026-08-10T15:00:00.000Z',
    notes: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  } as Shift;
}

function mkLeave(overrides: Partial<LeaveRequest> = {}): LeaveRequest {
  return {
    id: 'l1',
    org_id: 'org-1',
    staff_profile_id: 's1',
    type: 'sick',
    start_date: '2026-08-12',
    end_date: '2026-08-12',
    status: 'approved',
    reason: null,
    reviewed_by: null,
    reviewed_at: null,
    client_event_id: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('weekRangeIso', () => {
  it('starts the week on Monday and spans exactly 7 days', () => {
    // 12 Aug 2026 is a Wednesday.
    const { fromIso, toIso } = weekRangeIso(new Date('2026-08-12T12:00:00'));
    expect(new Date(fromIso).getDay()).toBe(1);
    expect(new Date(toIso).getTime() - new Date(fromIso).getTime()).toBe(7 * 86_400_000);
  });
});

describe('sumRosteredHours', () => {
  it('sums only the given staff member’s shifts', () => {
    const shifts = [
      mkShift({
        id: 'a',
        staff_profile_id: 's1',
        starts_at: '2026-08-10T07:00:00Z',
        ends_at: '2026-08-10T15:00:00Z',
      }),
      mkShift({
        id: 'b',
        staff_profile_id: 's1',
        starts_at: '2026-08-11T07:00:00Z',
        ends_at: '2026-08-11T19:30:00Z',
      }),
      mkShift({
        id: 'c',
        staff_profile_id: 's2',
        starts_at: '2026-08-10T07:00:00Z',
        ends_at: '2026-08-10T15:00:00Z',
      }),
    ];
    expect(sumRosteredHours(shifts, 's1')).toBe(20.5);
  });
});

describe('onTypeOfLeaveToday', () => {
  it('matches only approved leave of the given type covering today', () => {
    const leave = [
      mkLeave({ id: 'a', staff_profile_id: 's1', type: 'sick', status: 'approved' }),
      mkLeave({ id: 'b', staff_profile_id: 's2', type: 'holiday', status: 'approved' }),
      mkLeave({ id: 'c', staff_profile_id: 's3', type: 'sick', status: 'pending' }),
    ];
    const sickToday = onTypeOfLeaveToday(leave, '2026-08-12', (t) => t === 'sick');
    expect(sickToday).toEqual(new Set(['s1']));
  });
});

const DEPARTMENT: Department = {
  id: 'd1',
  org_id: 'org-1',
  location_id: 'loc1',
  name: 'Nursing',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

const LOCATION: Location = {
  id: 'loc1',
  org_id: 'org-1',
  name: 'Sunnyvale House',
  address: null,
  timezone: 'Europe/London',
  latitude: null,
  longitude: null,
  geofence_radius_m: 150,
  location_type: null,
  status: 'active',
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
};

describe('buildTeamRows', () => {
  it('resolves department, location, contract and rostered hours', () => {
    const staff = [mkStaff({ id: 's1', department_id: 'd1', weekly_hours: 37.5 })];
    const rows = buildTeamRows(staff, {
      departments: [DEPARTMENT],
      locations: [LOCATION],
      shiftsThisWeek: [
        mkShift({
          staff_profile_id: 's1',
          starts_at: '2026-08-10T07:00:00Z',
          ends_at: '2026-08-10T15:00:00Z',
        }),
      ],
      onShiftToday: new Set(['s1']),
      absentToday: new Set(),
    });
    expect(rows[0]).toMatchObject({
      department: 'Nursing',
      location: 'Sunnyvale House',
      contractHoursLabel: '37.5h',
      rosteredHoursLabel: '8.0h',
      todayStatus: 'on_shift',
    });
  });

  it('prioritises absent over on-shift', () => {
    const staff = [mkStaff({ id: 's1' })];
    const rows = buildTeamRows(staff, {
      departments: [],
      locations: [],
      shiftsThisWeek: [],
      onShiftToday: new Set(['s1']),
      absentToday: new Set(['s1']),
    });
    expect(rows[0]?.todayStatus).toBe('absent');
  });

  it('falls back to "off" with no shift or absence', () => {
    const staff = [mkStaff({ id: 's1' })];
    const rows = buildTeamRows(staff, {
      departments: [],
      locations: [],
      shiftsThisWeek: [],
      onShiftToday: new Set(),
      absentToday: new Set(),
    });
    expect(rows[0]?.todayStatus).toBe('off');
  });
});

describe('buildTeamTiles', () => {
  it('counts active staff only', () => {
    const staff = [
      mkStaff({ id: 's1', active: true }),
      mkStaff({ id: 's2', active: false }),
    ];
    const tiles = buildTeamTiles(
      staff,
      new Set(['s1']),
      new Set(),
      new Set(['s2']),
      3,
      2,
    );
    expect(tiles).toEqual({
      teamMembers: 1,
      onShiftToday: 1,
      absentToday: 0,
      onLeaveToday: 0,
      documentsExpiring: 3,
      invitesOutstanding: 2,
    });
  });
});
