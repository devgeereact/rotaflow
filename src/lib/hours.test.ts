import { describe, expect, it } from 'vitest';
import {
  formatHours,
  pairClockEvents,
  segmentsNeedingReview,
  totalWorkedMinutes,
} from '@/lib/hours';
import type { ClockEvent } from '@/types';

/**
 * This module converts clock events into the hours a person is paid for.
 * It is the single highest-consequence piece of arithmetic in the codebase:
 * every bug here is a payslip that is wrong in someone's favour or, worse,
 * against them — and none of it throws, so nothing surfaces it.
 *
 * Cases are written from what actually happens on a ward or in a kitchen:
 * people forget to clock out, clock in twice, start a break and never end it,
 * and work through midnight.
 */

/**
 * First element, or a clear failure. `noUncheckedIndexedAccess` makes `[0]`
 * possibly-undefined; asserting here gives "expected at least one segment"
 * instead of a property-access error further down.
 */
function first<T>(items: T[]): T {
  const item = items[0];
  if (item === undefined) throw new Error('expected at least one segment, got none');
  return item;
}

function second<T>(items: T[]): T {
  const item = items[1];
  if (item === undefined) throw new Error('expected at least two segments');
  return item;
}

let seq = 0;
function event(type: string, at: string): ClockEvent {
  seq += 1;
  return {
    id: `evt-${seq}`,
    org_id: 'org-1',
    staff_profile_id: 'staff-1',
    shift_id: null,
    type,
    event_at: at,
    method: 'manual',
    latitude: null,
    longitude: null,
    accuracy: null,
    location_name: null,
    synced: true,
    created_at: at,
    updated_at: at,
  };
}

describe('pairClockEvents — the ordinary cases', () => {
  it('pairs a simple in/out into worked minutes', () => {
    const segments = pairClockEvents([
      event('in', '2026-06-15T09:00:00Z'),
      event('out', '2026-06-15T17:00:00Z'),
    ]);

    expect(segments).toHaveLength(1);
    expect(first(segments).minutes).toBe(480);
    expect(first(segments).breakMinutes).toBe(0);
    expect(first(segments).clockOut).not.toBeNull();
  });

  it('deducts a break', () => {
    const segments = pairClockEvents([
      event('in', '2026-06-15T09:00:00Z'),
      event('break_start', '2026-06-15T12:00:00Z'),
      event('break_end', '2026-06-15T12:30:00Z'),
      event('out', '2026-06-15T17:00:00Z'),
    ]);

    expect(first(segments).breakMinutes).toBe(30);
    expect(first(segments).minutes).toBe(450);
  });

  it('deducts several breaks in one shift', () => {
    const segments = pairClockEvents([
      event('in', '2026-06-15T09:00:00Z'),
      event('break_start', '2026-06-15T11:00:00Z'),
      event('break_end', '2026-06-15T11:15:00Z'),
      event('break_start', '2026-06-15T14:00:00Z'),
      event('break_end', '2026-06-15T14:30:00Z'),
      event('out', '2026-06-15T17:00:00Z'),
    ]);

    expect(first(segments).breakMinutes).toBe(45);
    expect(first(segments).minutes).toBe(435);
  });

  it('sorts an out-of-order stream before pairing', () => {
    // Offline replay lands events in whatever order the queue flushed.
    const segments = pairClockEvents([
      event('out', '2026-06-15T17:00:00Z'),
      event('in', '2026-06-15T09:00:00Z'),
    ]);

    expect(segments).toHaveLength(1);
    expect(first(segments).minutes).toBe(480);
  });

  it('does not mutate the array it is given', () => {
    const events = [
      event('out', '2026-06-15T17:00:00Z'),
      event('in', '2026-06-15T09:00:00Z'),
    ];
    const before = events.map((e) => e.id);
    pairClockEvents(events);
    expect(events.map((e) => e.id)).toEqual(before);
  });

  it('returns nothing for an empty stream', () => {
    expect(pairClockEvents([])).toEqual([]);
  });

  it('handles two separate shifts in one day', () => {
    const segments = pairClockEvents([
      event('in', '2026-06-15T06:00:00Z'),
      event('out', '2026-06-15T10:00:00Z'),
      event('in', '2026-06-15T18:00:00Z'),
      event('out', '2026-06-15T22:00:00Z'),
    ]);

    expect(segments).toHaveLength(2);
    expect(totalWorkedMinutes(segments)).toBe(480);
  });
});

describe('pairClockEvents — night shifts and DST', () => {
  it('counts a shift that crosses midnight', () => {
    const segments = pairClockEvents([
      event('in', '2026-06-15T22:00:00Z'),
      event('out', '2026-06-16T06:00:00Z'),
    ]);

    expect(segments).toHaveLength(1);
    expect(first(segments).minutes).toBe(480);
  });

  it('pays the extra hour on a night shift through the fall-back', () => {
    // 25 Oct 2026, London clocks go back at 02:00 BST -> 01:00 GMT. A nurse who
    // starts at 22:00 and leaves at 06:00 wall-clock is on the ward for NINE
    // hours, not eight, and must be paid for nine.
    //
    // These are absolute instants, which is exactly why this works: 21:00Z to
    // 06:00Z is nine hours no matter what the local clock did in between.
    const segments = pairClockEvents([
      event('in', '2026-10-24T21:00:00Z'), // 22:00 BST
      event('out', '2026-10-25T06:00:00Z'), // 06:00 GMT
    ]);

    expect(first(segments).minutes).toBe(540);
    expect(formatHours(first(segments).minutes)).toBe('9.0');
  });

  it('pays only seven hours through the spring-forward', () => {
    // 29 Mar 2026: 01:00 GMT jumps to 02:00 BST. 22:00 to 06:00 wall-clock is
    // seven real hours. Paying eight would be paying for an hour nobody worked.
    const segments = pairClockEvents([
      event('in', '2026-03-28T22:00:00Z'), // 22:00 GMT
      event('out', '2026-03-29T05:00:00Z'), // 06:00 BST
    ]);

    expect(first(segments).minutes).toBe(420);
  });
});

describe('pairClockEvents — the messy cases that cost money', () => {
  it('keeps an ongoing shift open against `now` rather than dropping it', () => {
    const segments = pairClockEvents(
      [event('in', '2026-06-15T09:00:00Z')],
      new Date('2026-06-15T12:00:00Z'),
    );

    expect(segments).toHaveLength(1);
    expect(first(segments).clockOut).toBeNull();
    expect(first(segments).minutes).toBe(180);
  });

  it('ignores an `out` with no matching `in`', () => {
    // A correction row, or an offline `out` whose `in` was rejected. It must
    // not produce a segment starting at the epoch.
    const segments = pairClockEvents([event('out', '2026-06-15T17:00:00Z')]);
    expect(segments).toEqual([]);
  });

  it('ignores a break that starts before any clock-in', () => {
    const segments = pairClockEvents([
      event('break_start', '2026-06-15T08:00:00Z'),
      event('break_end', '2026-06-15T08:30:00Z'),
      event('in', '2026-06-15T09:00:00Z'),
      event('out', '2026-06-15T17:00:00Z'),
    ]);

    expect(first(segments).breakMinutes).toBe(0);
    expect(first(segments).minutes).toBe(480);
  });

  it('never reports negative minutes, whatever the stream looks like', () => {
    // A negative would subtract from the week's total and quietly reduce the
    // org-wide hours figure too, so the invariant matters more than any one
    // case. These are all real shapes: a stray break_end from another day, an
    // out before its in, duplicated events, breaks with no end.
    const contradictory: ClockEvent[][] = [
      [
        event('in', '2026-06-15T09:00:00Z'),
        event('break_start', '2026-06-15T09:30:00Z'),
        event('break_end', '2026-06-15T23:00:00Z'),
        event('out', '2026-06-15T10:00:00Z'),
      ],
      [event('out', '2026-06-15T08:00:00Z'), event('in', '2026-06-15T09:00:00Z')],
      [
        event('in', '2026-06-15T09:00:00Z'),
        event('in', '2026-06-15T09:00:00Z'),
        event('out', '2026-06-15T09:00:00Z'),
      ],
      [
        event('in', '2026-06-15T09:00:00Z'),
        event('break_start', '2026-06-15T09:00:00Z'),
        event('out', '2026-06-15T09:00:00Z'),
      ],
      [
        event('break_end', '2026-06-15T07:00:00Z'),
        event('in', '2026-06-15T09:00:00Z'),
        event('out', '2026-06-15T17:00:00Z'),
      ],
    ];

    for (const events of contradictory) {
      const segments = pairClockEvents(events, new Date('2026-06-15T18:00:00Z'));
      for (const segment of segments) {
        expect(segment.minutes).toBeGreaterThanOrEqual(0);
        expect(segment.breakMinutes).toBeGreaterThanOrEqual(0);
      }
      expect(totalWorkedMinutes(segments)).toBeGreaterThanOrEqual(0);
    }
  });

  it('deducts an unclosed break only as far as the clock-out', () => {
    // The break cannot be longer than the shift that contains it.
    const segments = pairClockEvents([
      event('in', '2026-06-15T09:00:00Z'),
      event('break_start', '2026-06-15T09:30:00Z'),
      event('out', '2026-06-15T10:00:00Z'),
    ]);

    expect(first(segments).breakMinutes).toBe(30);
    expect(first(segments).minutes).toBe(30);
  });

  it('counts an unclosed break rather than paying through it', () => {
    // Someone starts a break and clocks out without ending it — common when a
    // shift is cut short. The break time is real: they were not working. Paying
    // the full 09:00-17:00 would be paying for a break they took.
    const segments = pairClockEvents([
      event('in', '2026-06-15T09:00:00Z'),
      event('break_start', '2026-06-15T12:00:00Z'),
      event('out', '2026-06-15T17:00:00Z'),
    ]);

    expect(first(segments).breakMinutes).toBe(300);
    expect(first(segments).minutes).toBe(180);
  });

  it('does not silently discard a shift when someone forgets to clock out', () => {
    // Monday: in at 09:00, forgot to clock out. Tuesday: in at 09:00, out at
    // 17:00. The Monday shift must not vanish — the person worked it, and an
    // unpaid day is the single worst outcome this module can produce.
    const segments = pairClockEvents([
      event('in', '2026-06-15T09:00:00Z'),
      event('in', '2026-06-16T09:00:00Z'),
      event('out', '2026-06-16T17:00:00Z'),
    ]);

    expect(segments).toHaveLength(2);
    expect(second(segments).minutes).toBe(480);

    // The abandoned Monday segment is surfaced with no clock-out so the
    // timesheet screen can flag it for a manager, not paid at some invented
    // length.
    expect(first(segments).clockOut).toBeNull();
    expect(first(segments).minutes).toBe(0);
  });
});

describe('reviewReason — ambiguity is surfaced, never guessed silently', () => {
  it('leaves a complete shift unflagged', () => {
    const segments = pairClockEvents([
      event('in', '2026-06-15T09:00:00Z'),
      event('break_start', '2026-06-15T12:00:00Z'),
      event('break_end', '2026-06-15T12:30:00Z'),
      event('out', '2026-06-15T17:00:00Z'),
    ]);

    expect(first(segments).reviewReason).toBeNull();
    expect(segmentsNeedingReview(segments)).toHaveLength(0);
  });

  it('leaves an ongoing shift unflagged — still clocked in is not an error', () => {
    const segments = pairClockEvents(
      [event('in', '2026-06-15T09:00:00Z')],
      new Date('2026-06-15T12:00:00Z'),
    );

    expect(first(segments).reviewReason).toBeNull();
  });

  it('flags a shift that was never clocked out', () => {
    const segments = pairClockEvents([
      event('in', '2026-06-15T09:00:00Z'),
      event('in', '2026-06-16T09:00:00Z'),
      event('out', '2026-06-16T17:00:00Z'),
    ]);

    expect(first(segments).reviewReason).toBe('missing_clock_out');
    expect(second(segments).reviewReason).toBeNull();
    expect(segmentsNeedingReview(segments)).toHaveLength(1);
  });

  it('flags an unclosed break', () => {
    const segments = pairClockEvents([
      event('in', '2026-06-15T09:00:00Z'),
      event('break_start', '2026-06-15T12:00:00Z'),
      event('out', '2026-06-15T17:00:00Z'),
    ]);

    expect(first(segments).reviewReason).toBe('unclosed_break');
  });

  it('flags an unclosed break on a shift that is still running', () => {
    const segments = pairClockEvents(
      [event('in', '2026-06-15T09:00:00Z'), event('break_start', '2026-06-15T12:00:00Z')],
      new Date('2026-06-15T13:00:00Z'),
    );

    expect(first(segments).reviewReason).toBe('unclosed_break');
    expect(first(segments).breakMinutes).toBe(60);
    expect(first(segments).minutes).toBe(180);
  });

  it('does not let a flagged zero-minute segment inflate the total', () => {
    const segments = pairClockEvents([
      event('in', '2026-06-15T09:00:00Z'),
      event('in', '2026-06-16T09:00:00Z'),
      event('out', '2026-06-16T17:00:00Z'),
    ]);

    expect(totalWorkedMinutes(segments)).toBe(480);
  });
});

describe('totalWorkedMinutes / formatHours', () => {
  it('sums an empty week to zero', () => {
    expect(totalWorkedMinutes([])).toBe(0);
  });

  it('sums several segments', () => {
    const segments = pairClockEvents([
      event('in', '2026-06-15T09:00:00Z'),
      event('out', '2026-06-15T17:00:00Z'),
      event('in', '2026-06-16T09:00:00Z'),
      event('out', '2026-06-16T12:30:00Z'),
    ]);

    expect(totalWorkedMinutes(segments)).toBe(690);
    expect(formatHours(totalWorkedMinutes(segments))).toBe('11.5');
  });

  it('formats to one decimal place', () => {
    expect(formatHours(0)).toBe('0.0');
    expect(formatHours(90)).toBe('1.5');
    expect(formatHours(455)).toBe('7.6'); // 7.583 -> 7.6
  });
});
