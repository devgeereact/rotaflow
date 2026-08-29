import { describe, expect, it } from 'vitest';
import {
  buildTimesheetDayRows,
  payrollCutOffLabel,
  weekTotalsForStaff,
} from '@/lib/timesheetDayRows';
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
    };
    const near = {
      clockIn: mkEvent({ id: 'near', event_at: '2026-08-11T07:01:00.000Z' }),
      clockOut: mkEvent({ type: 'out', event_at: '2026-08-11T15:00:00.000Z' }),
      breakMinutes: 30,
      minutes: 449,
      reviewReason: null,
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
