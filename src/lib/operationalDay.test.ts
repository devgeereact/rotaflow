import { describe, expect, it } from 'vitest';
import {
  dayWindow,
  millisecondsUntilNextLocalMidnight,
  nextDay,
  operationalDate,
  operationalWindow,
  resolveReportingTimezone,
} from '@/lib/operationalDay';
import type { Location } from '@/types';

function location(name: string, timezone: string, id = name): Location {
  return {
    id,
    org_id: 'org',
    name,
    address: null,
    timezone,
    geofence_radius_m: 100,
    location_type: null,
    status: 'active',
    latitude: null,
    longitude: null,
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
  };
}

describe('operationalDate', () => {
  it('is the date in the site timezone, not the reader browser one', () => {
    // 23:30 UTC on 14 January is already the 15th in Sydney and still the
    // 14th in New York. The board must follow the work, not the laptop.
    const at = new Date('2026-01-14T23:30:00.000Z');
    expect(operationalDate(at, 'Europe/London')).toBe('2026-01-14');
    expect(operationalDate(at, 'Australia/Sydney')).toBe('2026-01-15');
    expect(operationalDate(at, 'America/New_York')).toBe('2026-01-14');
  });

  it('is correct on the far side of a DST transition', () => {
    // 00:30 BST on 30 March 2026 is 23:30Z on the 29th.
    expect(operationalDate(new Date('2026-03-29T23:30:00.000Z'), 'Europe/London')).toBe(
      '2026-03-30',
    );
  });
});

describe('nextDay', () => {
  /**
   * The four days a week-array index gets wrong.
   *
   * The dashboard used to take "tomorrow" from the current week's `dates`
   * array. On a Sunday that index is past the end, and the lookup returns
   * `undefined` — which renders as an empty table that reads exactly like
   * "nobody is rostered".
   */
  it('crosses a Sunday into the next week', () => {
    expect(nextDay('2026-01-18')).toBe('2026-01-19'); // Sunday → Monday
  });

  it('crosses a month end', () => {
    expect(nextDay('2026-01-31')).toBe('2026-02-01');
  });

  it('crosses a year end', () => {
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
  });

  it('handles a leap day', () => {
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
    expect(nextDay('2028-02-29')).toBe('2028-03-01');
  });
});

describe('dayWindow', () => {
  it('is 24 hours on an ordinary day', () => {
    const window = dayWindow('2026-01-14', 'Europe/London');
    const hours =
      (new Date(window.toIso).getTime() - new Date(window.fromIso).getTime()) / 3_600_000;
    expect(hours).toBe(24);
  });

  it('is 23 hours on the spring transition and 25 on the autumn one', () => {
    const spring = dayWindow('2026-03-29', 'Europe/London');
    const autumn = dayWindow('2026-10-25', 'Europe/London');
    const hoursOf = (w: { fromIso: string; toIso: string }): number =>
      (new Date(w.toIso).getTime() - new Date(w.fromIso).getTime()) / 3_600_000;
    expect(hoursOf(spring)).toBe(23);
    expect(hoursOf(autumn)).toBe(25);
    // And neither collapses to zero, which is what a `+ 86_400_000` did.
    expect(spring.toIso).not.toBe(spring.fromIso);
    expect(autumn.toIso).not.toBe(autumn.fromIso);
  });
});

describe('operationalWindow', () => {
  it('widens by 24 hours either side for boundary context', () => {
    const window = operationalWindow('2026-01-14', 'Europe/London');
    expect(window.contextFromIso).toBe('2026-01-13T00:00:00.000Z');
    expect(window.contextToIso).toBe('2026-01-16T00:00:00.000Z');
  });
});

describe('resolveReportingTimezone', () => {
  const london = location('Riverside House', 'Europe/London', 'l1');
  const sydney = location('Harbour Court', 'Australia/Sydney', 'l2');

  it('uses the selected site own clock', () => {
    const resolved = resolveReportingTimezone([london, sydney], 'l2', 'Europe/London');
    expect(resolved.timezone).toBe('Australia/Sydney');
    expect(resolved.label).toBe('Harbour Court');
    expect(resolved.mixed).toBe(false);
  });

  it('uses the organisation clock for an all-sites view, never the first site', () => {
    // The bug this replaces: `locations[0]?.timezone` silently made whichever
    // site sorted first stand in for every other one.
    const resolved = resolveReportingTimezone([sydney, london], null, 'Europe/London');
    expect(resolved.timezone).toBe('Europe/London');
    expect(resolved.mixed).toBe(true);
  });

  it('does not claim a mix when every site shares a clock', () => {
    expect(resolveReportingTimezone([london], null, 'Europe/London').mixed).toBe(false);
  });

  it('falls back to a site clock when the organisation has none recorded', () => {
    expect(resolveReportingTimezone([sydney], null, null).timezone).toBe(
      'Australia/Sydney',
    );
  });

  it('falls back to the documented default with nothing at all', () => {
    expect(resolveReportingTimezone([], null, null).timezone).toBe('Europe/London');
  });
});

describe('millisecondsUntilNextLocalMidnight', () => {
  it('counts to the next local midnight, not to a fixed 24 hours', () => {
    const at = new Date('2026-01-14T22:00:00.000Z');
    expect(millisecondsUntilNextLocalMidnight(at, 'Europe/London')).toBe(2 * 3_600_000);
  });

  it('never returns zero or a negative delay', () => {
    // A clock skew putting `now` a hair past midnight must not spin a timer.
    const at = new Date('2026-01-15T00:00:00.000Z');
    expect(millisecondsUntilNextLocalMidnight(at, 'Europe/London')).toBeGreaterThan(0);
  });
});
