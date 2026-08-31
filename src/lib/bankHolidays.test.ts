import { describe, expect, it } from 'vitest';
import {
  bankHolidays,
  bankHolidaysBetween,
  easterSunday,
  type BankHolidayRegion,
} from '@/lib/bankHolidays';

/**
 * UK bank holidays, computed rather than listed (CAP-009).
 *
 * Checked against the published dates on gov.uk. The point of computing them
 * is that the product does not silently stop knowing in the December before
 * the year everybody is planning, so several years are asserted rather than
 * only the next one.
 */

function dates(year: number, region: BankHolidayRegion): string[] {
  return bankHolidays(year, region).map((h) => h.date);
}

describe('easterSunday', () => {
  it('matches the published dates', () => {
    expect(easterSunday(2026).toISOString().slice(0, 10)).toBe('2026-04-05');
    expect(easterSunday(2027).toISOString().slice(0, 10)).toBe('2027-03-28');
    expect(easterSunday(2028).toISOString().slice(0, 10)).toBe('2028-04-16');
    // A wide spread, because the algorithm's edges are decades apart.
    expect(easterSunday(2000).toISOString().slice(0, 10)).toBe('2000-04-23');
    expect(easterSunday(2038).toISOString().slice(0, 10)).toBe('2038-04-25');
  });
});

describe('bankHolidays, England and Wales', () => {
  it('lists 2026', () => {
    expect(dates(2026, 'england-and-wales')).toEqual([
      '2026-01-01',
      '2026-04-03',
      '2026-04-06',
      '2026-05-04',
      '2026-05-25',
      '2026-08-31',
      '2026-12-25',
      '2026-12-28',
    ]);
  });

  it('moves Boxing Day clear of a substituted Christmas', () => {
    // 25 December 2027 is a Saturday. Christmas moves to Monday the 27th,
    // and Boxing Day must move to the Tuesday rather than landing on top of
    // it — the bug that produces a year with one holiday instead of two, in
    // the week a rota can least afford to be wrong.
    const december = dates(2027, 'england-and-wales').filter((d) =>
      d.startsWith('2027-12'),
    );
    expect(december).toEqual(['2027-12-27', '2027-12-28']);
  });

  it('marks a substitute day as one', () => {
    const boxing = bankHolidays(2027, 'england-and-wales').find(
      (h) => h.date === '2027-12-28',
    );
    expect(boxing?.substitute).toBe(true);
    expect(boxing?.name).toContain('substitute');
  });

  it("moves New Year's Day when it falls at a weekend", () => {
    // 1 January 2028 is a Saturday.
    expect(dates(2028, 'england-and-wales')[0]).toBe('2028-01-03');
  });

  it('takes the LAST Monday in August', () => {
    expect(dates(2026, 'england-and-wales')).toContain('2026-08-31');
  });
});

describe('bankHolidays, Scotland', () => {
  it('has no Easter Monday', () => {
    // Rostering one in Scotland is a day of cover nobody asked for.
    expect(dates(2026, 'scotland')).not.toContain('2026-04-06');
    expect(dates(2026, 'scotland')).toContain('2026-04-03');
  });

  it('takes the FIRST Monday in August, not the last', () => {
    expect(dates(2026, 'scotland')).toContain('2026-08-03');
    expect(dates(2026, 'scotland')).not.toContain('2026-08-31');
  });

  it('has 2 January and St Andrew’s Day', () => {
    expect(dates(2026, 'scotland')).toContain('2026-01-02');
    expect(dates(2026, 'scotland')).toContain('2026-11-30');
  });
});

describe('bankHolidays, Northern Ireland', () => {
  it("adds St Patrick's Day and the Twelfth", () => {
    expect(dates(2026, 'northern-ireland')).toContain('2026-03-17');
    expect(dates(2026, 'northern-ireland')).toContain('2026-07-13'); // 12th is a Sunday
  });

  it('keeps Easter Monday, unlike Scotland', () => {
    expect(dates(2026, 'northern-ireland')).toContain('2026-04-06');
  });
});

describe('bankHolidaysBetween', () => {
  it('finds one inside a range', () => {
    const found = bankHolidaysBetween('2026-05-01', '2026-05-31', 'england-and-wales');
    expect(found.map((h) => h.date)).toEqual(['2026-05-04', '2026-05-25']);
  });

  it('crosses a year boundary', () => {
    // A leave request over New Year spans two years, and looking only at the
    // start year would miss the 1st of January — the single most requested
    // day off there is.
    const found = bankHolidaysBetween('2026-12-20', '2027-01-05', 'england-and-wales');
    expect(found.map((h) => h.date)).toEqual(['2026-12-25', '2026-12-28', '2027-01-01']);
  });

  it('is inclusive of both ends', () => {
    expect(
      bankHolidaysBetween('2026-12-25', '2026-12-25', 'england-and-wales'),
    ).toHaveLength(1);
  });

  it('returns nothing for an ordinary week', () => {
    expect(bankHolidaysBetween('2026-06-01', '2026-06-07', 'england-and-wales')).toEqual(
      [],
    );
  });
});
