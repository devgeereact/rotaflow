import { describe, expect, it } from 'vitest';
import {
  CANVAS_WEEKS,
  anchorWeekDates,
  canvasDates,
  canvasStart,
  isInAnchorWeek,
  isWeekStart,
  isWeekend,
  rotaGridTemplate,
  weekSpans,
  weekStartOf,
} from '@/lib/rotaCanvas';

/** Monday 12 January 2026. */
const ANCHOR = '2026-01-12';

describe('the canvas axis', () => {
  it('starts a week before the anchor and runs three weeks', () => {
    expect(canvasStart(ANCHOR)).toBe('2026-01-05');
    const dates = canvasDates(ANCHOR);
    expect(dates).toHaveLength(CANVAS_WEEKS * 7);
    expect(dates[0]).toBe('2026-01-05');
    expect(dates[dates.length - 1]).toBe('2026-01-25');
  });

  it('is continuous, with no gap or duplicate at a week boundary', () => {
    const dates = canvasDates(ANCHOR);
    expect(new Set(dates).size).toBe(dates.length);
    for (let i = 1; i < dates.length; i += 1) {
      const previous = new Date(`${dates[i - 1]!}T00:00:00Z`).getTime();
      const current = new Date(`${dates[i]!}T00:00:00Z`).getTime();
      expect(current - previous).toBe(86_400_000);
    }
  });

  it('crosses a month and a year boundary without a break', () => {
    const across = canvasDates('2026-12-28');
    expect(across).toContain('2026-12-31');
    expect(across).toContain('2027-01-01');
    expect(new Set(across).size).toBe(across.length);
  });

  it('spans a DST transition without losing or repeating a day', () => {
    // The clocks go back on 25 October 2026. Day arithmetic that added a
    // fixed 86,400,000 ms would land back on the same local date.
    const across = canvasDates('2026-10-19');
    expect(across).toContain('2026-10-24');
    expect(across).toContain('2026-10-25');
    expect(across).toContain('2026-10-26');
    expect(new Set(across).size).toBe(across.length);
  });
});

describe('week grouping', () => {
  it('produces one labelled span per week, marking the anchor', () => {
    const spans = weekSpans(canvasDates(ANCHOR), ANCHOR);
    expect(spans).toHaveLength(CANVAS_WEEKS);
    expect(spans.map((s) => s.startDate)).toEqual([
      '2026-01-05',
      '2026-01-12',
      '2026-01-19',
    ]);
    expect(spans.every((s) => s.length === 7)).toBe(true);
    expect(spans.filter((s) => s.isCurrent).map((s) => s.startDate)).toEqual([ANCHOR]);
    expect(spans[1]?.label).toBe('w/c 12 Jan');
  });

  it('marks no span as current when no anchor is given', () => {
    expect(weekSpans(canvasDates(ANCHOR)).some((s) => s.isCurrent)).toBe(false);
  });
});

describe('boundaries and markers', () => {
  it('marks Mondays as week starts and Saturday/Sunday as weekend', () => {
    expect(isWeekStart('2026-01-12')).toBe(true);
    expect(isWeekStart('2026-01-13')).toBe(false);
    expect(isWeekend('2026-01-17')).toBe(true);
    expect(isWeekend('2026-01-18')).toBe(true);
    expect(isWeekend('2026-01-16')).toBe(false);
  });

  it('resolves any date to its Monday', () => {
    expect(weekStartOf('2026-01-18')).toBe('2026-01-12'); // Sunday
    expect(weekStartOf('2026-01-12')).toBe('2026-01-12'); // Monday
  });
});

describe('display scope versus action scope', () => {
  /**
   * The rule the whole widening rests on: the grid shows three weeks and the
   * toolbar's actions apply to one. A publish taken while looking at next
   * week's columns must still be about the week the toolbar names.
   */
  it('the anchor week is seven dates however wide the canvas is', () => {
    expect(anchorWeekDates(ANCHOR)).toHaveLength(7);
    expect(anchorWeekDates(ANCHOR)[0]).toBe(ANCHOR);
  });

  it('knows which canvas dates belong to the anchor week', () => {
    expect(isInAnchorWeek('2026-01-14', ANCHOR)).toBe(true);
    expect(isInAnchorWeek('2026-01-18', ANCHOR)).toBe(true);
    expect(isInAnchorWeek('2026-01-19', ANCHOR)).toBe(false);
    expect(isInAnchorWeek('2026-01-11', ANCHOR)).toBe(false);
  });
});

describe('the column template', () => {
  it('gives every day a minimum width so a wide canvas scrolls', () => {
    expect(rotaGridTemplate(7)).toBe(
      'minmax(0,11rem) repeat(7, minmax(6.5rem,1fr)) 3.5rem',
    );
    expect(rotaGridTemplate(21)).toContain('repeat(21,');
  });
});
