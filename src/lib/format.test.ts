import { describe, expect, it } from 'vitest';
import { formatCount, formatDate, formatDateTime, formatTime } from '@/lib/format';

describe('formatDate', () => {
  it('prints the stored day for a date-only value', () => {
    expect(formatDate('2027-03-03')).toBe('3 March 2027');
  });

  it('does not slip a day across the clock change', () => {
    // 28 March 2027 is the spring-forward Sunday in Europe/London, where this
    // suite runs. A date-only value read as an instant would still print the
    // 28th here, but the guard is that it never depends on the zone at all.
    expect(formatDate('2027-03-28')).toBe('28 March 2027');
    expect(formatDate('2026-12-31')).toBe('31 December 2026');
  });

  it('returns an unparseable value unchanged rather than "Invalid Date"', () => {
    expect(formatDate('not a date')).toBe('not a date');
  });
});

describe('formatDateTime and formatTime', () => {
  it('formats an instant with day, month, year and time', () => {
    const out = formatDateTime('2027-03-03T14:05:00Z');
    expect(out).toContain('2027');
    expect(out).toMatch(/\d{2}:\d{2}/);
  });

  it('formats a time of day as hours and minutes', () => {
    expect(formatTime(new Date(2027, 2, 3, 9, 7))).toBe('09:07');
  });

  it('returns an unparseable instant unchanged', () => {
    expect(formatDateTime('nope')).toBe('nope');
    expect(formatTime('nope')).toBe('nope');
  });
});

describe('formatCount', () => {
  it('groups thousands', () => {
    expect(formatCount(12400)).toBe('12,400');
  });
});
