import { describe, expect, it } from 'vitest';
import {
  buildTimesheetDayRows,
  lateToleranceFor,
  minutesOverThreshold,
  payrollCutOffLabel,
  type TimesheetDayRow,
  weekTotalsForStaff,
} from '@/lib/timesheetDayRows';
import type { WorkedSegment } from '@/lib/hours';
import type { ClockEvent, Location, Shift } from '@/types';

const TZ = 'Europe/London';

function mkShift(overrides: Partial<Shift> = {}): Shift {
  return {
    id: 'shift-1',
    org_id: 'org-1',
    rota_id: 'rota-1',
    location_id: 'loc-1',
    department_id: null,
    staff_profile_id: 'staff-1',
    shift_type_id: null,
    starts_at: '2026-08-11T07:00:00.000Z',
    ends_at: '2026-08-11T15:00:00.000Z',
    break_minutes: 30,
    status: 'confirmed',
    colour: null,
    notes: null,
    created_at: '2026-08-01T00:00:00.000Z',
    updated_at: '2026-08-01T00:00:00.000Z',
    ...overrides,
  };
}

function mkEvent(overrides: Partial<ClockEvent> = {}): ClockEvent {
  return {
    id: 'evt-1',
    org_id: 'org-1',
    staff_profile_id: 'staff-1',
    shift_id: 'shift-1',
    type: 'in',
    event_at: '2026-08-11T07:00:00.000Z',
    method: 'gps',
    latitude: null,
    longitude: null,
    accuracy: null,
    location_name: null,
    event_at_reported: null,
    client_event_id: null,
    synced: true,
    created_at: '2026-08-11T07:00:00.000Z',
    updated_at: '2026-08-11T07:00:00.000Z',
    ...overrides,
  };
}

const LOCATIONS = new Map<string, Location>([
  [
    'loc-1',
    {
      id: 'loc-1',
      org_id: 'org-1',
      name: 'Sunnyvale House',
      address: null,
      latitude: null,
      longitude: null,
      timezone: TZ,
      geofence_radius_m: 100,
      location_type: null,
      status: 'active',
      created_at: '2026-08-01T00:00:00.000Z',
      updated_at: '2026-08-01T00:00:00.000Z',
    },
  ],
]);

describe('buildTimesheetDayRows', () => {
  it('marks a shift with no matching clock-in as absent', () => {
    const shift = mkShift();
    const rows = buildTimesheetDayRows([shift], new Map(), LOCATIONS, TZ);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      status: 'absent',
      actualLabel: '-',
      paidMinutes: null,
      flag: 'No clock-in recorded',
    });
  });

  it('marks a still-open segment as on_shift, paid minutes withheld', () => {
    const shift = mkShift();
    const segments = new Map([
      [
        'staff-1',
        [
          {
            clockIn: mkEvent({ event_at: '2026-08-11T07:00:00.000Z' }),
            clockOut: null,
            breakMinutes: 0,
            minutes: 120,
            reviewReason: null,
            openBreakSince: null,
          },
        ],
      ],
    ]);
    const rows = buildTimesheetDayRows([shift], segments, LOCATIONS, TZ);
    expect(rows[0]).toMatchObject({
      status: 'on_shift',
      paidMinutes: null,
      flag: 'Still clocked in',
    });
    expect(rows[0]!.actualLabel).toBe('08:00, -');
  });

  it('marks a clock-in more than 5 minutes after the shift start as late', () => {
    const shift = mkShift();
    const segments = new Map([
      [
        'staff-1',
        [
          {
            clockIn: mkEvent({ event_at: '2026-08-11T07:12:00.000Z' }),
            clockOut: mkEvent({
              type: 'out',
              event_at: '2026-08-11T15:02:00.000Z',
            }),
            breakMinutes: 30,
            minutes: 440,
            reviewReason: null,
            openBreakSince: null,
          },
        ],
      ],
    ]);
    const rows = buildTimesheetDayRows([shift], segments, LOCATIONS, TZ);
    expect(rows[0]).toMatchObject({
      status: 'late',
      flag: '12 min late',
      paidMinutes: 440,
    });
  });

  it('marks an on-time, closed segment as complete', () => {
    const shift = mkShift();
    const segments = new Map([
      [
        'staff-1',
        [
          {
            clockIn: mkEvent({ event_at: '2026-08-11T06:59:00.000Z' }),
            clockOut: mkEvent({
              type: 'out',
              event_at: '2026-08-11T15:00:00.000Z',
            }),
            breakMinutes: 30,
            minutes: 451,
            reviewReason: null,
            openBreakSince: null,
          },
        ],
      ],
    ]);
    const rows = buildTimesheetDayRows([shift], segments, LOCATIONS, TZ);
    expect(rows[0]).toMatchObject({ status: 'complete', flag: null, paidMinutes: 451 });
  });

  it('picks the segment closest to the shift start when more than one is in range', () => {
    const shift = mkShift();
    const far = {
      clockIn: mkEvent({ id: 'far', event_at: '2026-08-11T05:00:00.000Z' }),
      clockOut: mkEvent({ type: 'out', event_at: '2026-08-11T06:00:00.000Z' }),
      breakMinutes: 0,
      minutes: 60,
      reviewReason: null,
      openBreakSince: null,
    };
    const near = {
      clockIn: mkEvent({ id: 'near', event_at: '2026-08-11T07:01:00.000Z' }),
      clockOut: mkEvent({ type: 'out', event_at: '2026-08-11T15:00:00.000Z' }),
      breakMinutes: 30,
      minutes: 449,
      reviewReason: null,
      openBreakSince: null,
    };
    const segments = new Map([['staff-1', [far, near]]]);
    const rows = buildTimesheetDayRows([shift], segments, LOCATIONS, TZ);
    expect(rows[0]!.paidMinutes).toBe(449);
  });

  it('ignores a segment that starts hours outside the shift window', () => {
    const shift = mkShift();
    const segments = new Map([
      [
        'staff-1',
        [
          {
            clockIn: mkEvent({ event_at: '2026-08-11T00:00:00.000Z' }),
            clockOut: mkEvent({ type: 'out', event_at: '2026-08-11T01:00:00.000Z' }),
            breakMinutes: 0,
            minutes: 60,
            reviewReason: null,
            openBreakSince: null,
          },
        ],
      ],
    ]);
    const rows = buildTimesheetDayRows([shift], segments, LOCATIONS, TZ);
    expect(rows[0]!.status).toBe('absent');
  });

  it('reads the shift location timezone, not the fallback, when both differ', () => {
    const paris = new Map<string, Location>([
      ['loc-1', { ...LOCATIONS.get('loc-1')!, timezone: 'Europe/Paris' }],
    ]);
    const shift = mkShift();
    const rows = buildTimesheetDayRows([shift], new Map(), paris, TZ);
    // 07:00 UTC in August is 09:00 in Paris (CEST, UTC+2) vs 08:00 in London.
    expect(rows[0]!.plannedLabel.startsWith('09:00')).toBe(true);
  });

  it('drops shifts with no assigned staff', () => {
    const shift = mkShift({ staff_profile_id: null });
    const rows = buildTimesheetDayRows([shift], new Map(), LOCATIONS, TZ);
    expect(rows).toHaveLength(0);
  });
});

/**
 * Owner decision (31 Oct 2026): with `timesheet_tools` on the page passes the organisation's
 * tolerance and "Late" is the server's rule (whole minutes, floor, more than the tolerance);
 * with it off nothing is passed and the old rule (rounded, more than 5) stands unchanged.
 */
describe('buildTimesheetDayRows: Late and the tolerance', () => {
  const closedAt = (clockIn: string): Map<string, WorkedSegment[]> =>
    new Map([
      [
        'staff-1',
        [
          {
            clockIn: mkEvent({ event_at: clockIn }),
            clockOut: mkEvent({ type: 'out', event_at: '2026-08-11T15:00:00.000Z' }),
            breakMinutes: 30,
            minutes: 400,
            reviewReason: null,
            openBreakSince: null,
          },
        ],
      ],
    ]);
  const row = (clockIn: string, tolerance?: number): TimesheetDayRow =>
    buildTimesheetDayRows([mkShift()], closedAt(clockIn), LOCATIONS, TZ, tolerance)[0]!;

  it('flag off (no tolerance passed): exactly the old rule, rounded minutes more than 5', () => {
    expect(row('2026-08-11T07:05:00.000Z')).toMatchObject({
      status: 'complete',
      flag: null,
    });
    // 5 min 30 s rounds to 6: late under the old rule, and its label is the rounded figure.
    expect(row('2026-08-11T07:05:30.000Z')).toMatchObject({
      status: 'late',
      flag: '6 min late',
    });
    expect(row('2026-08-11T07:08:00.000Z')).toMatchObject({
      status: 'late',
      flag: '8 min late',
    });
    expect(row('2026-08-11T07:12:00.000Z')).toMatchObject({
      status: 'late',
      flag: '12 min late',
    });
  });

  it('flag on, default 10: 8 minutes is on time, 10:59 is 10 (not late), 11 is late', () => {
    expect(row('2026-08-11T07:08:00.000Z', 10)).toMatchObject({
      status: 'complete',
      flag: null,
    });
    expect(row('2026-08-11T07:10:00.000Z', 10).status).toBe('complete');
    expect(row('2026-08-11T07:10:59.000Z', 10).status).toBe('complete');
    expect(row('2026-08-11T07:11:00.000Z', 10)).toMatchObject({
      status: 'late',
      flag: '11 min late',
    });
  });

  it('flag on: the label is whole minutes (floor), the same figure as the late chip', () => {
    expect(row('2026-08-11T07:12:59.000Z', 10)).toMatchObject({
      status: 'late',
      flag: '12 min late',
    });
  });

  it('the page passes the tolerance only with the flag on', () => {
    expect(lateToleranceFor(false, 15)).toBeUndefined();
    expect(lateToleranceFor(true, 15)).toBe(15);
    expect(lateToleranceFor(true, 0)).toBe(0);
    // Flag off with a tolerance of 15 set: 8 minutes is still late, as before.
    expect(row('2026-08-11T07:08:00.000Z', lateToleranceFor(false, 15)).status).toBe(
      'late',
    );
    expect(row('2026-08-11T07:08:00.000Z', lateToleranceFor(true, 15)).status).toBe(
      'complete',
    );
  });

  it('flag on follows the organisation: 15 clears 12, 0 flags one minute, never early', () => {
    expect(row('2026-08-11T07:12:00.000Z', 15).status).toBe('complete');
    expect(row('2026-08-11T07:16:00.000Z', 15).status).toBe('late');
    expect(row('2026-08-11T07:00:59.000Z', 0).status).toBe('complete');
    expect(row('2026-08-11T07:01:00.000Z', 0).status).toBe('late');
    expect(row('2026-08-11T06:30:00.000Z', 0).status).toBe('complete');
  });
});

describe('weekTotalsForStaff', () => {
  it('sums net scheduled minutes and worked minutes independently', () => {
    const shifts = [mkShift(), mkShift({ id: 'shift-2' })];
    const segments = [
      {
        clockIn: mkEvent(),
        clockOut: mkEvent({ type: 'out', event_at: '2026-08-11T15:00:00.000Z' }),
        breakMinutes: 30,
        minutes: 450,
        reviewReason: null,
        openBreakSince: null,
      },
    ];
    const totals = weekTotalsForStaff(shifts, segments);
    // Each shift is 8h gross minus 30m break = 450m net; two shifts = 900m.
    expect(totals.scheduledMinutes).toBe(900);
    expect(totals.workedMinutes).toBe(450);
  });
});

describe('payrollCutOffLabel', () => {
  it('returns the Friday of the week containing the given date', () => {
    // 2026-08-11 is a Tuesday.
    const label = payrollCutOffLabel(new Date('2026-08-11T12:00:00.000Z'));
    expect(label).toBe('Fri 14 Aug');
  });
});

describe('minutesOverThreshold', () => {
  it('changes with the overtime threshold: 40 hours worked', () => {
    const worked = 40 * 60;
    // The default 37.5h threshold highlights 2.5 hours.
    expect(minutesOverThreshold(worked, 37.5)).toBe(150);
    // Raise it to 40 and nothing is highlighted.
    expect(minutesOverThreshold(worked, 40)).toBe(0);
    // Lower it to 35 and five hours are.
    expect(minutesOverThreshold(worked, 35)).toBe(300);
  });
});
