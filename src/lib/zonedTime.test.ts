import { describe, expect, it } from 'vitest';
import {
  addDays,
  daysBetween,
  endDateFor,
  isoWeekday,
  localRange,
  mondayOf,
  todayIn,
  utcToZoned,
  zonedToUtc,
} from '@/lib/zonedTime';

// Ported from SiteRelay tests/time.test.ts and the calendar cases of tests/scheduling.test.ts (S11).
const LON = 'Europe/London';

describe('zoned time', () => {
  it('London winter time equals UTC, summer time is one hour ahead', () => {
    expect(zonedToUtc('2026-10-26', '09:00', LON)).toBe('2026-10-26T09:00:00Z');
    expect(zonedToUtc('2026-07-01', '09:00', LON)).toBe('2026-07-01T08:00:00Z');
    expect(zonedToUtc('2026-10-24', '09:00', LON)).toBe('2026-10-24T08:00:00Z'); // still BST the day before
  });

  it('other zones and a round trip', () => {
    expect(zonedToUtc('2026-07-01', '09:00', 'America/New_York')).toBe(
      '2026-07-01T13:00:00Z',
    );
    expect(zonedToUtc('2026-01-15', '09:00', 'Asia/Kolkata')).toBe(
      '2026-01-15T03:30:00Z',
    );
    for (const [d, t, tz] of [
      ['2026-07-01', '23:30', LON],
      ['2026-12-31', '00:15', 'Australia/Sydney'],
      ['2026-03-30', '07:45', LON],
    ] as const) {
      expect(utcToZoned(zonedToUtc(d, t, tz), tz)).toEqual({ date: d, time: t });
    }
  });

  it('an overnight local shift crosses the UTC date correctly', () => {
    expect(zonedToUtc('2026-07-01', '00:30', LON)).toBe('2026-06-30T23:30:00Z');
    expect(utcToZoned('2026-06-30T23:30:00Z', LON)).toEqual({
      date: '2026-07-01',
      time: '00:30',
    });
  });

  it('the clock changes: a skipped time moves on an hour; a repeated time is the second one', () => {
    // 29 Mar 2026: 01:00 GMT jumps to 02:00 BST, so 01:30 does not exist and becomes 02:30 BST.
    expect(zonedToUtc('2026-03-29', '01:30', LON)).toBe('2026-03-29T01:30:00Z');
    expect(zonedToUtc('2026-03-29', '06:00', LON)).toBe('2026-03-29T05:00:00Z');
    // 25 Oct 2026: 02:00 BST falls back to 01:00 GMT; 01:30 happens twice and resolves to GMT.
    expect(zonedToUtc('2026-10-25', '01:30', LON)).toBe('2026-10-25T01:30:00Z');
    expect(zonedToUtc('2026-10-25', '06:00', LON)).toBe('2026-10-25T06:00:00Z');
  });

  it('week helpers and a 7-day range across the autumn clock change', () => {
    expect(mondayOf('2026-10-28')).toBe('2026-10-26');
    expect(mondayOf('2026-10-25')).toBe('2026-10-19'); // Sunday belongs to the week from the Monday before
    expect(addDays('2026-10-30', 3)).toBe('2026-11-02');
    const r = localRange('2026-10-19', 7, LON); // contains 25 Oct: the range is 169 hours long
    expect(r.from).toBe('2026-10-18T23:00:00Z');
    expect(r.to).toBe('2026-10-26T00:00:00Z');
    expect((Date.parse(r.to) - Date.parse(r.from)) / 3_600_000).toBe(169);
  });

  it('calendar helpers: weekdays, day counts and the overnight end date', () => {
    expect(isoWeekday('2026-10-25')).toBe(7);
    expect(isoWeekday('2026-10-26')).toBe(1);
    expect(daysBetween('2026-10-19', '2026-10-26')).toBe(7); // across the change: still 7 calendar days
    expect(daysBetween('2026-11-01', '2026-10-31')).toBe(-1);
    expect(daysBetween('2026-03-28', '2026-03-30')).toBe(2);
    expect(endDateFor('2026-10-24', '22:00', '06:00')).toBe('2026-10-25');
    expect(endDateFor('2026-10-24', '09:00', '17:00')).toBe('2026-10-24');
  });

  it('a night across the autumn change is nine real hours', () => {
    const s = zonedToUtc('2026-10-24', '22:00', LON);
    const e = zonedToUtc('2026-10-25', '06:00', LON);
    expect(s).toBe('2026-10-24T21:00:00Z');
    expect(e).toBe('2026-10-25T06:00:00Z');
    expect((Date.parse(e) - Date.parse(s)) / 3_600_000).toBe(9);
    expect(utcToZoned(s, LON).date).toBe('2026-10-24'); // shown on the day it starts
  });

  it('today in a zone ahead of UTC', () => {
    expect(todayIn('Pacific/Auckland', Date.parse('2027-03-10T11:00:00Z'))).toBe(
      '2027-03-11',
    );
    expect(todayIn(LON, Date.parse('2026-10-24T23:30:00Z'))).toBe('2026-10-25');
  });
});
