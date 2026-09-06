import { describe, expect, it } from 'vitest';
import {
  attendanceExceptions,
  buildAttendanceRows,
  countOpenShifts,
  matchSegmentsToShifts,
  summariseAttendance,
  type AttendanceRow,
} from '@/lib/attendance';
import { pairClockEvents } from '@/lib/hours';
import type { ClockEvent, Shift } from '@/types';

/**
 * The suite runs in `Europe/London` (`vitest.config.ts`), deliberately, so the
 * DST cases below exercise a real 23- and 25-hour day rather than UTC's
 * uniform ones. Instants are written as explicit `Z` values so the fixtures
 * say what they mean regardless of where they are read.
 */

const TZ = 'Europe/London';

let sequence = 0;

function shift(input: {
  id?: string;
  staff: string | null;
  startsAt: string;
  endsAt: string;
  breakMinutes?: number;
  locationId?: string | null;
}): Shift {
  sequence += 1;
  return {
    id: input.id ?? `shift-${sequence}`,
    org_id: 'org',
    rota_id: 'rota',
    staff_profile_id: input.staff,
    location_id: input.locationId ?? 'loc-1',
    department_id: null,
    shift_type_id: null,
    starts_at: input.startsAt,
    ends_at: input.endsAt,
    break_minutes: input.breakMinutes ?? 0,
    notes: null,
    colour: null,
    status: 'assigned',
    created_at: input.startsAt,
    updated_at: input.startsAt,
  };
}

function event(input: {
  id?: string;
  staff: string;
  type: ClockEvent['type'];
  at: string;
  shiftId?: string | null;
  method?: string;
}): ClockEvent {
  sequence += 1;
  return {
    id: input.id ?? `event-${sequence}`,
    org_id: 'org',
    staff_profile_id: input.staff,
    shift_id: input.shiftId ?? null,
    type: input.type,
    event_at: input.at,
    event_at_reported: null,
    method: input.method ?? 'gps',
    location_name: 'Riverside House',
    latitude: null,
    longitude: null,
    accuracy: null,
    client_event_id: null,
    synced: true,
    created_at: input.at,
    updated_at: input.at,
  };
}

function build(
  shifts: Shift[],
  events: ClockEvent[],
  now: string,
  window: [string, string],
): AttendanceRow[] {
  return buildAttendanceRows({
    shifts,
    events,
    now: new Date(now),
    timezone: TZ,
    windowFromIso: window[0],
    windowToIso: window[1],
  });
}

/** A whole winter day in London, where local time is UTC. */
const DAY: [string, string] = ['2026-01-14T00:00:00.000Z', '2026-01-15T00:00:00.000Z'];

describe('attendance states at a single moment', () => {
  /**
   * The scenario the request names: at 10:00, five people in five different
   * situations. Every one of them was reported as one of two states before
   * this module existed — "on shift" from the roster, or "not yet clocked in"
   * — and four of the five readings were wrong.
   */
  const shifts = [
    shift({
      id: 's-working',
      staff: 'p-working',
      startsAt: '2026-01-14T07:00:00.000Z',
      endsAt: '2026-01-14T19:00:00.000Z',
    }),
    shift({
      id: 's-break',
      staff: 'p-break',
      startsAt: '2026-01-14T08:00:00.000Z',
      endsAt: '2026-01-14T16:00:00.000Z',
    }),
    shift({
      id: 's-done',
      staff: 'p-done',
      startsAt: '2026-01-14T06:00:00.000Z',
      endsAt: '2026-01-14T09:30:00.000Z',
    }),
    shift({
      id: 's-later',
      staff: 'p-later',
      startsAt: '2026-01-14T14:00:00.000Z',
      endsAt: '2026-01-14T22:00:00.000Z',
    }),
    shift({
      id: 's-late',
      staff: 'p-late',
      startsAt: '2026-01-14T09:00:00.000Z',
      endsAt: '2026-01-14T17:00:00.000Z',
    }),
  ];

  const events = [
    event({ staff: 'p-working', type: 'in', at: '2026-01-14T06:58:00.000Z' }),
    event({ staff: 'p-break', type: 'in', at: '2026-01-14T07:59:00.000Z' }),
    event({ staff: 'p-break', type: 'break_start', at: '2026-01-14T09:45:00.000Z' }),
    event({ staff: 'p-done', type: 'in', at: '2026-01-14T05:57:00.000Z' }),
    event({ staff: 'p-done', type: 'out', at: '2026-01-14T09:32:00.000Z' }),
  ];

  const rows = build(shifts, events, '2026-01-14T10:00:00.000Z', DAY);
  const statusOf = (shiftId: string): string =>
    rows.find((row) => row.shiftId === shiftId)?.status ?? 'missing';

  it('distinguishes working, on break and completed', () => {
    expect(statusOf('s-working')).toBe('working');
    expect(statusOf('s-break')).toBe('on_break');
    expect(statusOf('s-done')).toBe('completed');
  });

  it('calls a future start Scheduled, not Late', () => {
    expect(statusOf('s-later')).toBe('scheduled');
  });

  it('calls an overdue start with no clock-in Late, with how late', () => {
    expect(statusOf('s-late')).toBe('late');
    expect(rows.find((r) => r.shiftId === 's-late')?.minutesLate).toBe(60);
  });

  it('counts people and shifts separately, and only counts open segments as present', () => {
    const counts = summariseAttendance(rows, shifts);
    expect(counts.scheduledPeople).toBe(5);
    expect(counts.scheduledShifts).toBe(5);
    // Not 5, and not 2: one person is on the floor and one is on a break.
    expect(counts.workingNow).toBe(1);
    expect(counts.onBreak).toBe(1);
    expect(counts.completed).toBe(1);
    expect(counts.late).toBe(1);
  });

  it('does not count a person who has finished as not yet started', () => {
    // The old schedule screen subtracted "has an open segment" from
    // "scheduled today", so a completed shift was reported as an outstanding
    // clock-in for the rest of the day.
    expect(statusOf('s-done')).not.toBe('late');
    expect(statusOf('s-done')).not.toBe('not_recorded');
  });

  /**
   * The defect, reproduced against the formula that shipped.
   *
   * `ManagerSchedule` computed "not yet clocked in" as *everyone rostered
   * today* minus *everyone with an open clock segment*. That is written out
   * literally below, run against the same fixtures, and it disagrees with the
   * evidence in two directions at once — which is why this module exists and
   * why the old helper was deleted rather than adjusted.
   */
  it('the legacy roster-minus-open-segment formula reports two people wrongly', () => {
    const rosteredToday = new Set(
      shifts.map((s) => s.staff_profile_id).filter((id): id is string => id !== null),
    );
    const openSegments = new Set<string>();
    for (const staffId of rosteredToday) {
      const segments = pairClockEvents(
        events.filter((e) => e.staff_profile_id === staffId),
        new Date('2026-01-14T10:00:00.000Z'),
      );
      const last = segments[segments.length - 1];
      if (last && last.clockOut === null) openSegments.add(staffId);
    }
    const legacyNotYetClockedIn = [...rosteredToday].filter(
      (id) => !openSegments.has(id),
    );

    // Three, by that formula: the person who finished at 09:32, the person
    // not due until 14:00, and the genuinely late one.
    expect(legacyNotYetClockedIn).toHaveLength(3);
    expect(legacyNotYetClockedIn).toContain('p-done');
    expect(legacyNotYetClockedIn).toContain('p-later');

    // One, by the evidence. The other two have their own states.
    expect(summariseAttendance(rows, shifts).late).toBe(1);
    expect(statusOf('s-done')).toBe('completed');
    expect(statusOf('s-later')).toBe('scheduled');

    // And the same formula counted the person on their break as present,
    // because an open segment is an open segment either way.
    expect(openSegments.has('p-break')).toBe(true);
    expect(summariseAttendance(rows, shifts).workingNow).toBe(1);
  });

  it('is inside the grace period immediately after a start', () => {
    const grace = build(shifts, events, '2026-01-14T09:10:00.000Z', DAY);
    expect(grace.find((r) => r.shiftId === 's-late')?.status).toBe('scheduled');
  });
});

describe('a shift that has ended', () => {
  const s = shift({
    id: 's-ended',
    staff: 'p',
    startsAt: '2026-01-14T09:00:00.000Z',
    endsAt: '2026-01-14T17:00:00.000Z',
  });

  it('with no events is Not recorded, never Absent', () => {
    const rows = build([s], [], '2026-01-14T18:00:00.000Z', DAY);
    expect(rows[0]?.status).toBe('not_recorded');
    // The wording matters as much as the state: the server cannot see an
    // unsynchronised offline clock-in, so it must not assert absence.
    expect(rows[0]?.workedMinutes).toBeNull();
  });

  it('with an open clock-in needs a clock-out', () => {
    const rows = build(
      [s],
      [event({ staff: 'p', type: 'in', at: '2026-01-14T09:02:00.000Z' })],
      '2026-01-14T18:00:00.000Z',
      DAY,
    );
    expect(rows[0]?.status).toBe('missing_clock_out');
  });
});

describe('overnight work', () => {
  const night = shift({
    id: 's-night',
    staff: 'p',
    startsAt: '2026-01-13T22:00:00.000Z',
    endsAt: '2026-01-14T06:00:00.000Z',
  });

  it('is still visible and Working at 01:00 the next morning', () => {
    const rows = build(
      [night],
      [event({ staff: 'p', type: 'in', at: '2026-01-13T21:55:00.000Z' })],
      '2026-01-14T01:00:00.000Z',
      DAY,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('working');
    expect(rows[0]?.crossesMidnight).toBe(true);
  });

  it('stays visible after the clock-out, with the worked total closed', () => {
    const rows = build(
      [night],
      [
        event({ staff: 'p', type: 'in', at: '2026-01-13T21:55:00.000Z' }),
        event({ staff: 'p', type: 'out', at: '2026-01-14T06:04:00.000Z' }),
      ],
      '2026-01-14T09:00:00.000Z',
      DAY,
    );
    expect(rows[0]?.status).toBe('completed');
    expect(rows[0]?.workedMinutes).toBe(489);
    // Closed on both sides, so a variance is meaningful. 8h09m worked against
    // an 8h shift.
    expect(rows[0]?.varianceMinutes).toBe(9);
  });

  it('reports no variance while the shift is still running', () => {
    const rows = build(
      [night],
      [event({ staff: 'p', type: 'in', at: '2026-01-13T21:55:00.000Z' })],
      '2026-01-14T01:00:00.000Z',
      DAY,
    );
    // Half way through a shift, "minus four hours" is not a variance, it is
    // the shift not being over.
    expect(rows[0]?.varianceMinutes).toBeNull();
  });
});

describe('daylight saving', () => {
  /**
   * 25 October 2026: the clocks go back at 02:00 local, so the day is 25
   * hours long. A night shift crossing the transition must still be reported
   * as one shift on one day, and `crossesMidnight` must be decided by local
   * calendar dates rather than by adding a fixed 24 hours.
   */
  it('handles a shift across the autumn transition', () => {
    const s = shift({
      id: 's-dst',
      staff: 'p',
      // 22:00 BST on the 24th = 21:00Z; 06:00 GMT on the 25th = 06:00Z.
      startsAt: '2026-10-24T21:00:00.000Z',
      endsAt: '2026-10-25T06:00:00.000Z',
    });
    const rows = build(
      [s],
      [
        event({ staff: 'p', type: 'in', at: '2026-10-24T21:00:00.000Z' }),
        event({ staff: 'p', type: 'out', at: '2026-10-25T06:00:00.000Z' }),
      ],
      '2026-10-25T09:00:00.000Z',
      ['2026-10-24T23:00:00.000Z', '2026-10-26T00:00:00.000Z'],
    );
    expect(rows[0]?.crossesMidnight).toBe(true);
    // Nine hours of wall clock; the extra hour of the 25-hour day is real
    // time worked and is counted.
    expect(rows[0]?.workedMinutes).toBe(540);
  });

  it('does not report a same-day shift as crossing midnight', () => {
    const s = shift({
      id: 's-same-day',
      staff: 'p',
      startsAt: '2026-06-10T07:00:00.000Z',
      endsAt: '2026-06-10T18:00:00.000Z',
    });
    const rows = build([s], [], '2026-06-10T20:00:00.000Z', [
      '2026-06-09T23:00:00.000Z',
      '2026-06-10T23:00:00.000Z',
    ]);
    expect(rows[0]?.crossesMidnight).toBe(false);
  });
});

describe('linking events to shifts', () => {
  it('prefers the shift the event names over the nearest one', () => {
    const early = shift({
      id: 'a',
      staff: 'p',
      startsAt: '2026-01-14T07:00:00.000Z',
      endsAt: '2026-01-14T12:00:00.000Z',
    });
    const late = shift({
      id: 'b',
      staff: 'p',
      startsAt: '2026-01-14T13:00:00.000Z',
      endsAt: '2026-01-14T18:00:00.000Z',
    });
    const events = [
      // Arrives closer to the second shift's start, but says it is the first.
      event({ staff: 'p', type: 'in', at: '2026-01-14T12:40:00.000Z', shiftId: 'a' }),
      event({ staff: 'p', type: 'out', at: '2026-01-14T17:00:00.000Z' }),
    ];
    const rows = build([early, late], events, '2026-01-14T19:00:00.000Z', DAY);
    expect(rows.find((r) => r.shiftId === 'a')?.status).toBe('completed');
    expect(rows.find((r) => r.shiftId === 'a')?.matchedByProximity).toBe(false);
    expect(rows.find((r) => r.shiftId === 'b')?.status).toBe('not_recorded');
  });

  it('gives two shifts on one day their own segments rather than sharing the last event', () => {
    const morning = shift({
      id: 'am',
      staff: 'p',
      startsAt: '2026-01-14T07:00:00.000Z',
      endsAt: '2026-01-14T11:00:00.000Z',
    });
    const evening = shift({
      id: 'pm',
      staff: 'p',
      startsAt: '2026-01-14T17:00:00.000Z',
      endsAt: '2026-01-14T21:00:00.000Z',
    });
    const events = [
      event({ staff: 'p', type: 'in', at: '2026-01-14T06:58:00.000Z' }),
      event({ staff: 'p', type: 'out', at: '2026-01-14T11:03:00.000Z' }),
      event({ staff: 'p', type: 'in', at: '2026-01-14T16:57:00.000Z' }),
      event({ staff: 'p', type: 'out', at: '2026-01-14T21:05:00.000Z' }),
    ];
    const rows = build([morning, evening], events, '2026-01-14T22:00:00.000Z', DAY);
    expect(rows.find((r) => r.shiftId === 'am')?.actualInIso).toBe(
      '2026-01-14T06:58:00.000Z',
    );
    expect(rows.find((r) => r.shiftId === 'pm')?.actualInIso).toBe(
      '2026-01-14T16:57:00.000Z',
    );
  });

  it('never assigns one segment to two shifts', () => {
    const a = shift({
      id: 'a',
      staff: 'p',
      startsAt: '2026-01-14T09:00:00.000Z',
      endsAt: '2026-01-14T13:00:00.000Z',
    });
    const b = shift({
      id: 'b',
      staff: 'p',
      startsAt: '2026-01-14T10:00:00.000Z',
      endsAt: '2026-01-14T14:00:00.000Z',
    });
    const segments = pairClockEvents([
      event({ staff: 'p', type: 'in', at: '2026-01-14T09:30:00.000Z' }),
      event({ staff: 'p', type: 'out', at: '2026-01-14T13:30:00.000Z' }),
    ]);
    const matched = matchSegmentsToShifts([a, b], segments);
    expect(matched.size).toBe(1);
    expect([...matched.values()]).toEqual([0]);
  });

  it('reports a segment matching no shift as unscheduled rather than folding it in', () => {
    const rows = build(
      [],
      [
        event({ staff: 'p', type: 'in', at: '2026-01-14T09:00:00.000Z' }),
        event({ staff: 'p', type: 'out', at: '2026-01-14T12:00:00.000Z' }),
      ],
      '2026-01-14T13:00:00.000Z',
      DAY,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('unscheduled');
    expect(rows[0]?.shiftId).toBeNull();
  });

  it('ignores boundary-context segments that belong to another day', () => {
    // Read with 24 hours of context either side, a clock-in from yesterday is
    // in the stream so that today's clock-out can be paired. It must not then
    // appear as today's unscheduled exception.
    const rows = build(
      [],
      [
        event({ staff: 'p', type: 'in', at: '2026-01-13T09:00:00.000Z' }),
        event({ staff: 'p', type: 'out', at: '2026-01-13T17:00:00.000Z' }),
      ],
      '2026-01-14T13:00:00.000Z',
      DAY,
    );
    expect(rows).toHaveLength(0);
  });
});

describe('bad event streams do not invent hours', () => {
  it('a duplicate clock-in produces a flagged zero-minute segment, not a doubled day', () => {
    const s = shift({
      id: 's',
      staff: 'p',
      startsAt: '2026-01-14T09:00:00.000Z',
      endsAt: '2026-01-14T17:00:00.000Z',
    });
    const rows = build(
      [s],
      [
        event({ staff: 'p', type: 'in', at: '2026-01-14T09:00:00.000Z' }),
        // The same clock-in replayed from an offline queue a second later.
        event({ staff: 'p', type: 'in', at: '2026-01-14T09:00:01.000Z' }),
        event({ staff: 'p', type: 'out', at: '2026-01-14T17:02:00.000Z' }),
      ],
      '2026-01-14T18:00:00.000Z',
      DAY,
    );
    const total = rows.reduce((sum, row) => sum + (row.workedMinutes ?? 0), 0);
    // One day's work, not two. The flagged 0-minute segment surfaces as an
    // unscheduled exception for somebody to clear.
    expect(total).toBe(482);
    expect(rows.some((row) => row.reviewReason === 'missing_clock_out')).toBe(true);
  });

  it('an out with no in is ignored rather than paired with the epoch', () => {
    const s = shift({
      id: 's',
      staff: 'p',
      startsAt: '2026-01-14T09:00:00.000Z',
      endsAt: '2026-01-14T17:00:00.000Z',
    });
    const rows = build(
      [s],
      [event({ staff: 'p', type: 'out', at: '2026-01-14T17:00:00.000Z' })],
      '2026-01-14T18:00:00.000Z',
      DAY,
    );
    expect(rows[0]?.status).toBe('not_recorded');
    expect(rows[0]?.workedMinutes).toBeNull();
  });

  it('an unclosed break is deducted and flagged', () => {
    const s = shift({
      id: 's',
      staff: 'p',
      startsAt: '2026-01-14T09:00:00.000Z',
      endsAt: '2026-01-14T17:00:00.000Z',
    });
    const rows = build(
      [s],
      [
        event({ staff: 'p', type: 'in', at: '2026-01-14T09:00:00.000Z' }),
        event({ staff: 'p', type: 'break_start', at: '2026-01-14T13:00:00.000Z' }),
        event({ staff: 'p', type: 'out', at: '2026-01-14T17:00:00.000Z' }),
      ],
      '2026-01-14T18:00:00.000Z',
      DAY,
    );
    expect(rows[0]?.reviewReason).toBe('unclosed_break');
    expect(rows[0]?.breakMinutes).toBe(240);
    expect(rows[0]?.workedMinutes).toBe(240);
  });

  it('events arriving out of order are sorted before pairing', () => {
    const s = shift({
      id: 's',
      staff: 'p',
      startsAt: '2026-01-14T09:00:00.000Z',
      endsAt: '2026-01-14T17:00:00.000Z',
    });
    const inEvent = event({ staff: 'p', type: 'in', at: '2026-01-14T09:00:00.000Z' });
    const outEvent = event({ staff: 'p', type: 'out', at: '2026-01-14T17:00:00.000Z' });
    const rows = build([s], [outEvent, inEvent], '2026-01-14T18:00:00.000Z', DAY);
    expect(rows[0]?.status).toBe('completed');
    expect(rows[0]?.workedMinutes).toBe(480);
  });
});

describe('open shifts and exceptions', () => {
  it('counts an unassigned shift as an open shift and gives it no attendance row', () => {
    const open = shift({
      id: 'open',
      staff: null,
      startsAt: '2026-01-14T09:00:00.000Z',
      endsAt: '2026-01-14T17:00:00.000Z',
    });
    const rows = build([open], [], '2026-01-14T10:00:00.000Z', DAY);
    expect(rows).toHaveLength(0);
    expect(countOpenShifts([open])).toBe(1);
    expect(summariseAttendance(rows, [open]).openShifts).toBe(1);
  });

  it('orders exceptions by severity', () => {
    const s1 = shift({
      id: 'late',
      staff: 'a',
      startsAt: '2026-01-14T07:00:00.000Z',
      endsAt: '2026-01-14T15:00:00.000Z',
    });
    const s2 = shift({
      id: 'open-clock',
      staff: 'b',
      startsAt: '2026-01-14T06:00:00.000Z',
      endsAt: '2026-01-14T09:00:00.000Z',
    });
    const rows = build(
      [s1, s2],
      [event({ staff: 'b', type: 'in', at: '2026-01-14T06:00:00.000Z' })],
      '2026-01-14T10:00:00.000Z',
      DAY,
    );
    const ordered = attendanceExceptions(rows).map((row) => row.status);
    expect(ordered[0]).toBe('missing_clock_out');
    expect(ordered).toContain('late');
  });
});
