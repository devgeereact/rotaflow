import { describe, expect, it } from 'vitest';
import { findMissedClockIns } from '@/lib/clockInAlerts';
import type { ClockEvent, Shift } from '@/types';

const NOW = new Date('2026-08-04T09:00:00.000Z');

function mkShift(id: string, staffProfileId: string | null, startsAt: string): Shift {
  return {
    id,
    org_id: 'org-1',
    rota_id: 'rota-1',
    location_id: null,
    department_id: null,
    shift_type_id: null,
    staff_profile_id: staffProfileId,
    starts_at: startsAt,
    ends_at: new Date(new Date(startsAt).getTime() + 8 * 3_600_000).toISOString(),
    break_minutes: 0,
    colour: null,
    notes: null,
    status: 'published',
    created_at: startsAt,
    updated_at: startsAt,
  };
}

function mkEvent(staffProfileId: string, type: string, eventAt: string): ClockEvent {
  return {
    id: `evt-${staffProfileId}-${eventAt}`,
    org_id: 'org-1',
    staff_profile_id: staffProfileId,
    shift_id: null,
    type,
    event_at: eventAt,
    method: 'manual',
    latitude: null,
    longitude: null,
    accuracy: null,
    location_name: null,
    event_at_reported: null,
    client_event_id: null,
    synced: true,
    created_at: eventAt,
    updated_at: eventAt,
  };
}

describe('findMissedClockIns', () => {
  it('flags an assigned shift that started 47 minutes ago with no clock-in', () => {
    const shifts = [mkShift('s1', 'staff-1', '2026-08-04T08:13:00.000Z')];
    const result = findMissedClockIns(shifts, [], NOW);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ staffProfileId: 'staff-1', minutesLate: 47 });
  });

  it('does not flag a shift within the grace period', () => {
    const shifts = [mkShift('s1', 'staff-1', '2026-08-04T08:45:00.000Z')];
    expect(findMissedClockIns(shifts, [], NOW)).toHaveLength(0);
  });

  it('does not flag someone who clocked in', () => {
    const shifts = [mkShift('s1', 'staff-1', '2026-08-04T08:00:00.000Z')];
    const events = [mkEvent('staff-1', 'in', '2026-08-04T08:02:00.000Z')];
    expect(findMissedClockIns(shifts, events, NOW)).toHaveLength(0);
  });

  it('ignores an unassigned shift', () => {
    const shifts = [mkShift('s1', null, '2026-08-04T08:00:00.000Z')];
    expect(findMissedClockIns(shifts, [], NOW)).toHaveLength(0);
  });

  it('does not flag a shift more than 12 hours late', () => {
    const shifts = [mkShift('s1', 'staff-1', '2026-08-03T20:00:00.000Z')];
    expect(findMissedClockIns(shifts, [], NOW)).toHaveLength(0);
  });

  it('sorts the latest-starting-first by minutes late, worst first', () => {
    const shifts = [
      mkShift('s1', 'staff-1', '2026-08-04T08:30:00.000Z'),
      mkShift('s2', 'staff-2', '2026-08-04T07:00:00.000Z'),
    ];
    const result = findMissedClockIns(shifts, [], NOW);
    expect(result.map((r) => r.staffProfileId)).toEqual(['staff-2', 'staff-1']);
  });
});
