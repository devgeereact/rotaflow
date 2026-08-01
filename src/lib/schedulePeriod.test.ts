import { describe, expect, it } from 'vitest';
import { periodStart, resolvePeriod, stepPeriod } from '@/lib/schedulePeriod';

/**
 * `resolvePeriod` decides which window of time a schedule screen queries and
 * renders. If it returns the wrong window, shifts do not appear — and nothing
 * errors, because an empty result is indistinguishable from "nobody is
 * rostered". That silence is why this file exists.
 *
 * These run in Europe/London (see vitest.config.ts). The zone matters: the
 * DST cases below cannot fail under UTC, which is what CI pins for the build.
 */

// Europe/London DST boundaries. On 25 Oct 2026 the clocks go BACK, so that
// local day is 25 hours long; on 29 Mar 2026 they go forward and it is 23.
const CLOCKS_GO_BACK = '2026-10-25';
const CLOCKS_GO_FORWARD = '2026-03-29';

describe('resolvePeriod — DST day arithmetic', () => {
  it('covers a full 24h+ on the day the clocks go back', () => {
    const period = resolvePeriod('day', CLOCKS_GO_BACK, 'Europe/London');

    expect(period.dates).toEqual([CLOCKS_GO_BACK]);

    // The regression this suite was written for. `toIso` was computed as
    // local-midnight + 86_400_000 ms, but a fall-back day has 25 hours, so
    // midnight + 24h landed at 23:00 the SAME day and formatted back to the
    // same date — making `toIso === fromIso`. A zero-length window returns no
    // shifts, so the schedule rendered completely empty on that one day a
    // year, in RotaFlow's primary market, with no error anywhere.
    expect(period.toIso).not.toBe(period.fromIso);

    const spanHours = (Date.parse(period.toIso) - Date.parse(period.fromIso)) / 3_600_000;
    expect(spanHours).toBe(25);
  });

  it('covers exactly 23h on the day the clocks go forward', () => {
    const period = resolvePeriod('day', CLOCKS_GO_FORWARD, 'Europe/London');
    const spanHours = (Date.parse(period.toIso) - Date.parse(period.fromIso)) / 3_600_000;
    expect(spanHours).toBe(23);
  });

  it('covers a normal day in exactly 24h', () => {
    const period = resolvePeriod('day', '2026-06-15', 'Europe/London');
    const spanHours = (Date.parse(period.toIso) - Date.parse(period.fromIso)) / 3_600_000;
    expect(spanHours).toBe(24);
  });

  it('does not truncate a week that ends on the fall-back day', () => {
    // Week containing 25 Oct 2026 starts Monday 19 Oct and ends Sunday 25 Oct,
    // so the buggy `+ DAY_MS` cut the final day off the query window entirely —
    // the busiest handover day of that week, invisible.
    const period = resolvePeriod('week', CLOCKS_GO_BACK, 'Europe/London');

    expect(period.dates).toHaveLength(7);
    expect(period.dates[6]).toBe(CLOCKS_GO_BACK);

    // 6 normal days (144h) + one 25-hour day.
    const spanHours = (Date.parse(period.toIso) - Date.parse(period.fromIso)) / 3_600_000;
    expect(spanHours).toBe(169);
  });

  it('spans a whole month including its DST transition', () => {
    const period = resolvePeriod('month', '2026-10-10', 'Europe/London');
    expect(period.dates).toHaveLength(31);
    expect(period.dates[0]).toBe('2026-10-01');
    expect(period.dates[30]).toBe('2026-10-31');

    // October 2026 in London is 31 days but 745 hours, not 744.
    const spanHours = (Date.parse(period.toIso) - Date.parse(period.fromIso)) / 3_600_000;
    expect(spanHours).toBe(745);
  });
});

describe('resolvePeriod — the window is the location’s, not the browser’s', () => {
  it('starts a London day at London midnight', () => {
    // 15 June is BST (UTC+1), so local midnight is 23:00 UTC the day before.
    const period = resolvePeriod('day', '2026-06-15', 'Europe/London');
    expect(period.fromIso).toBe('2026-06-14T23:00:00.000Z');
  });

  it('starts a New York day at New York midnight, not London’s', () => {
    // RULES.md §9: a rota for a New York location viewed from a London laptop
    // must still start at midnight in New York. Same anchor date as above,
    // different instant — if these two were equal the timezone argument would
    // be doing nothing.
    const period = resolvePeriod('day', '2026-06-15', 'America/New_York');
    expect(period.fromIso).toBe('2026-06-15T04:00:00.000Z');

    const london = resolvePeriod('day', '2026-06-15', 'Europe/London');
    expect(period.fromIso).not.toBe(london.fromIso);
  });

  it('keeps a 24h span for a zone whose DST falls on a different date', () => {
    // US DST ends 1 Nov 2026, not 25 Oct — so on the UK's transition date a
    // New York schedule is an ordinary 24-hour day. This is what proves the
    // span is computed from the location's zone rather than the runner's.
    const period = resolvePeriod('day', CLOCKS_GO_BACK, 'America/New_York');
    const spanHours = (Date.parse(period.toIso) - Date.parse(period.fromIso)) / 3_600_000;
    expect(spanHours).toBe(24);
  });
});

describe('periodStart', () => {
  it('snaps a week to Monday', () => {
    // 15 Oct 2026 is a Thursday.
    expect(periodStart('week', '2026-10-15')).toBe('2026-10-12');
  });

  it('leaves a Monday alone', () => {
    expect(periodStart('week', '2026-10-12')).toBe('2026-10-12');
  });

  it('snaps a Sunday back to the Monday before, not forward', () => {
    // The off-by-one that `weekStartsOn: 1` exists to prevent: with the
    // default (Sunday) this returns 2026-10-18 and the whole grid shifts.
    expect(periodStart('week', '2026-10-18')).toBe('2026-10-12');
  });

  it('snaps a month to the 1st', () => {
    expect(periodStart('month', '2026-10-15')).toBe('2026-10-01');
  });

  it('leaves a day view on its anchor', () => {
    expect(periodStart('day', '2026-10-15')).toBe('2026-10-15');
  });
});

describe('stepPeriod', () => {
  it('steps a week across a DST boundary without losing a day', () => {
    // 19 Oct + 7 days crosses the fall-back. Naive ms arithmetic lands on
    // 25 Oct 23:00 and formats to 25 Oct — a 6-day week.
    expect(stepPeriod('week', '2026-10-19', 1)).toBe('2026-10-26');
  });

  it('steps a day across the fall-back', () => {
    expect(stepPeriod('day', CLOCKS_GO_BACK, 1)).toBe('2026-10-26');
  });

  it('steps back across the spring-forward', () => {
    expect(stepPeriod('day', CLOCKS_GO_FORWARD, -1)).toBe('2026-03-28');
  });

  it('steps a month from the 31st without skipping February', () => {
    // date-fns clamps rather than overflowing into March.
    expect(stepPeriod('month', '2026-01-31', 1)).toBe('2026-02-28');
  });

  it('round-trips forward then back', () => {
    const forward = stepPeriod('fortnight', '2026-10-12', 1);
    expect(stepPeriod('fortnight', forward, -1)).toBe('2026-10-12');
  });
});
