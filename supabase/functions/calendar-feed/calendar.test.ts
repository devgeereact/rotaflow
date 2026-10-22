import { describe, expect, it } from 'vitest';
import {
  RETRY_AFTER_SECONDS,
  buildCalendar,
  escapeText,
  fold,
  isRateLimited,
} from './calendar';

/**
 * The decision half of `calendar-feed` (CAP-063, GAP-052). The handler in
 * `index.ts` does the I/O; these are the parts that decide what a calendar
 * client receives.
 */
describe('isRateLimited', () => {
  it('is true only for the P0001 that consume_rate_limit raises (0158)', () => {
    expect(isRateLimited({ code: 'P0001' })).toBe(true);
    expect(isRateLimited({ code: '42501' })).toBe(false);
    expect(isRateLimited({})).toBe(false);
    expect(isRateLimited(null)).toBe(false);
  });

  it('asks a refused client to wait the whole window', () => {
    expect(RETRY_AFTER_SECONDS).toBe(3600);
  });
});

describe('buildCalendar', () => {
  it('gives a valid empty calendar for an unknown, revoked or idle token', () => {
    const ics = buildCalendar([]);
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true);
    expect(ics).not.toContain('BEGIN:VEVENT');
  });

  it('keys each event on the shift id so an amendment updates it in place', () => {
    const ics = buildCalendar([
      {
        shift_id: 'abc',
        starts_at: '2027-03-04T09:00:00Z',
        ends_at: '2027-03-04T17:00:00Z',
        shift_type: 'Early',
        location_name: 'Ward A',
        break_minutes: 30,
        notes: null,
      },
    ]);
    expect(ics).toContain('UID:abc@rotaflow');
    expect(ics).toContain('DTSTART:20270304T090000Z');
    expect(ics).toContain('DESCRIPTION:Break: 30 minutes');
  });
});

describe('escapeText and fold', () => {
  it('escapes backslashes before the characters it escapes with', () => {
    expect(escapeText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne');
  });

  it('folds long lines to 75 octets with a leading space', () => {
    const folded = fold('X'.repeat(160)).split('\r\n');
    expect(folded[0]).toHaveLength(75);
    expect(folded.slice(1).every((l) => l.startsWith(' ') && l.length <= 75)).toBe(true);
  });
});
