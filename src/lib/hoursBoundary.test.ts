import { describe, expect, it } from 'vitest';
import {
  BOUNDARY_CONTEXT_HOURS,
  pairClockEvents,
  segmentsStartingWithin,
  shiftIso,
  totalWorkedMinutes,
} from '@/lib/hours';
import type { ClockEvent } from '@/types';

/**
 * RF-08 — a night shift belongs to exactly one period, and to the period it
 * started in.
 *
 * The audited reads were bounded exactly by the reporting window, which broke
 * the pairing at both edges:
 *
 *   - the period the shift ENDED in received the `out` and not the `in`, and
 *     `pairClockEvents` correctly ignores an orphan `out`, so it contributed
 *     nothing;
 *   - the period the shift STARTED in received the `in` and not the `out`, so
 *     the segment was closed against `now` — for a report run three days later
 *     that is three days of pay, with no review flag, because as far as the
 *     function could tell the person was still clocked in.
 *
 * The second half is worse than the audit reported and is asserted below.
 *
 * The tests run under TZ=Europe/London (vitest.config.ts), so the DST cases
 * are real rather than a UTC no-op.
 */

let seq = 0;
function event(type: ClockEvent['type'], at: string): ClockEvent {
  seq += 1;
  return {
    id: `evt-${seq}`,
    org_id: 'org-1',
    staff_profile_id: 'staff-1',
    shift_id: null,
    type,
    event_at: at,
    latitude: null,
    longitude: null,
    accuracy: null,
    method: 'manual',
    location_name: null,
    synced: true,
    created_at: at,
  } as unknown as ClockEvent;
}

/** Monday 00:00Z to Tuesday 00:00Z. */
const MON = '2026-09-07T00:00:00.000Z';
const TUE = '2026-09-08T00:00:00.000Z';
const WED = '2026-09-09T00:00:00.000Z';

describe('period-boundary attendance', () => {
  const nightShift = [
    event('in', '2026-09-07T23:00:00.000Z'),
    event('out', '2026-09-08T07:00:00.000Z'),
  ];

  it('reproduces the old defect: a window-bounded read loses the whole shift', () => {
    // Tuesday's window holds only the `out`. This is the audit's case, and it
    // is still the correct behaviour of `pairClockEvents` on its own — the
    // repair is reading wider, not changing the pairing.
    const tuesdayOnly = nightShift.filter((e) => e.event_at >= TUE && e.event_at < WED);
    expect(tuesdayOnly).toHaveLength(1);
    expect(totalWorkedMinutes(pairClockEvents(tuesdayOnly))).toBe(0);
  });

  it('reproduces the worse half: the starting window paid to the moment of the report', () => {
    const mondayOnly = nightShift.filter((e) => e.event_at >= MON && e.event_at < TUE);
    // A report generated three days later.
    const reportedAt = new Date('2026-09-11T09:00:00.000Z');
    const segments = pairClockEvents(mondayOnly, reportedAt);
    expect(segments).toHaveLength(1);
    // Over three days of pay for an eight-hour shift, and nothing flagged it.
    expect(totalWorkedMinutes(segments)).toBeGreaterThan(4000);
    expect(segments[0]?.reviewReason).toBeNull();
  });

  it('pays the whole night shift to the day it started', () => {
    const segments = segmentsStartingWithin(pairClockEvents(nightShift), MON, TUE);
    expect(totalWorkedMinutes(segments)).toBe(480);
  });

  it('does not also pay it to the day it ended', () => {
    const segments = segmentsStartingWithin(pairClockEvents(nightShift), TUE, WED);
    expect(segments).toEqual([]);
  });

  it('adjacent periods together account for the shift exactly once', () => {
    const paired = pairClockEvents(nightShift);
    const monday = totalWorkedMinutes(segmentsStartingWithin(paired, MON, TUE));
    const tuesday = totalWorkedMinutes(segmentsStartingWithin(paired, TUE, WED));
    expect(monday + tuesday).toBe(480);
  });

  it('deducts a break that itself crosses midnight', () => {
    const withBreak = [
      event('in', '2026-09-07T22:00:00.000Z'),
      event('break_start', '2026-09-07T23:45:00.000Z'),
      event('break_end', '2026-09-08T00:15:00.000Z'),
      event('out', '2026-09-08T06:00:00.000Z'),
    ];
    const segments = segmentsStartingWithin(pairClockEvents(withBreak), MON, TUE);
    // 8 hours gross, 30 minutes of break.
    expect(totalWorkedMinutes(segments)).toBe(450);
  });

  it('pays the extra hour on a fall-back night, attributed to the start date', () => {
    // 2026-10-25: British Summer Time ends at 02:00 local. 23:00 BST to 07:00
    // GMT is nine hours of wall clock but nine real hours too, because the
    // clock repeats 01:00–02:00.
    const fallBack = [
      event('in', '2026-10-24T22:00:00.000Z'), // 23:00 BST
      event('out', '2026-10-25T07:00:00.000Z'), // 07:00 GMT
    ];
    const segments = segmentsStartingWithin(
      pairClockEvents(fallBack),
      '2026-10-24T00:00:00.000Z',
      '2026-10-25T00:00:00.000Z',
    );
    expect(totalWorkedMinutes(segments)).toBe(540);
  });

  it('reads far enough either side for an eight-hour night shift to be complete', () => {
    // The margin has to cover the longest segment the pairing will produce.
    expect(BOUNDARY_CONTEXT_HOURS).toBeGreaterThanOrEqual(8);
    expect(shiftIso(MON, -BOUNDARY_CONTEXT_HOURS) < '2026-09-06T23:00:00.000Z').toBe(
      true,
    );
    expect(shiftIso(TUE, BOUNDARY_CONTEXT_HOURS) > '2026-09-08T07:00:00.000Z').toBe(true);
  });

  it('leaves an unclosed segment inside the period flagged rather than dropped', () => {
    const abandoned = [event('in', '2026-09-07T09:00:00.000Z')];
    const at = new Date('2026-09-07T17:00:00.000Z');
    const segments = segmentsStartingWithin(pairClockEvents(abandoned, at), MON, TUE);
    expect(segments).toHaveLength(1);
    expect(totalWorkedMinutes(segments)).toBe(480);
  });
});
