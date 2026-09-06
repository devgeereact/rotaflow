/**
 * The continuous multiweek date axis the rota planner is drawn on.
 *
 * ## Why the builder stopped being one week wide
 *
 * `RotaBuilderPage` rendered exactly `getWeekDates(weekStart)` — seven
 * columns — and the "Fortnight" tab beside it showed a toast saying fortnight
 * and month views "use the same grid at lower density", which they did not,
 * because there was no such grid. Moving between weeks meant pressing Next,
 * which replaced the whole view: you could not see that Monday was short while
 * looking at the Friday before it, and copying a pattern forward meant
 * remembering what you had just left.
 *
 * A rota is planned across a boundary far more often than within one. So the
 * axis is continuous: the previous week, the current week and the next week
 * are one scrolling strip of dates, with the week boundaries drawn and each
 * block labelled. The Previous/Next/Today controls stay — they are the fast
 * way to jump — but they are no longer the only way to see two weeks at once.
 *
 * ## Why the previous week is included at all
 *
 * "Scroll back to last week without losing this week" is the specific thing a
 * manager does: last week's pattern is what this week is copied from. Loading
 * it costs one wider query rather than a second round trip, and the window is
 * bounded at three weeks so it cannot grow into an unbounded read.
 */
import { addDays, format, startOfWeek } from 'date-fns';
import { getMonday, getWeekDates } from '@/lib/rotaGrid';

/** Weeks shown before the anchor week. */
export const WEEKS_BEFORE = 1;
/** Weeks shown after the anchor week. */
export const WEEKS_AFTER = 1;
/** Total weeks on the canvas. Bounded deliberately; see the header. */
export const CANVAS_WEEKS = WEEKS_BEFORE + 1 + WEEKS_AFTER;

/** The Monday the canvas starts on, given the anchor week's Monday. */
export function canvasStart(anchorWeekStart: string): string {
  return getMonday(addDays(new Date(`${anchorWeekStart}T00:00:00`), -7 * WEEKS_BEFORE));
}

/**
 * Every date on the canvas, in order, as one continuous run.
 *
 * Built by walking days from the canvas start rather than by concatenating
 * per-week arrays: a concatenation is where an off-by-one leaves a gap or a
 * duplicate at a week boundary, and the whole point of this axis is that the
 * boundary is not special.
 */
export function canvasDates(anchorWeekStart: string): string[] {
  const start = new Date(`${canvasStart(anchorWeekStart)}T00:00:00`);
  return Array.from({ length: CANVAS_WEEKS * 7 }, (_, i) =>
    format(addDays(start, i), 'yyyy-MM-dd'),
  );
}

/** The anchor week's own seven dates, for anything still scoped to one week. */
export function anchorWeekDates(anchorWeekStart: string): string[] {
  return getWeekDates(anchorWeekStart);
}

export interface WeekSpan {
  /** Monday of this block. */
  startDate: string;
  /** How many of the canvas's columns this block covers. Always 7 here. */
  length: number;
  /** "w/c 8 Sep". */
  label: string;
  /** True for the anchor week — the one the toolbar's actions apply to. */
  isCurrent: boolean;
}

/**
 * Group a run of dates into the week blocks the header labels.
 *
 * Grouped by the actual Monday of each date rather than by index arithmetic,
 * so it stays correct if the canvas ever starts mid-week.
 */
export function weekSpans(dates: string[], anchorWeekStart?: string): WeekSpan[] {
  const spans: WeekSpan[] = [];
  for (const date of dates) {
    const monday = format(
      startOfWeek(new Date(`${date}T00:00:00`), { weekStartsOn: 1 }),
      'yyyy-MM-dd',
    );
    const last = spans[spans.length - 1];
    if (last && last.startDate === monday) {
      last.length += 1;
      continue;
    }
    spans.push({
      startDate: monday,
      length: 1,
      label: `w/c ${format(new Date(`${monday}T00:00:00`), 'd MMM')}`,
      isCurrent: anchorWeekStart === monday,
    });
  }
  return spans;
}

/** True on a Monday — where the header draws a week boundary. */
export function isWeekStart(date: string): boolean {
  return new Date(`${date}T00:00:00`).getDay() === 1;
}

export function isWeekend(date: string): boolean {
  const day = new Date(`${date}T00:00:00`).getDay();
  return day === 0 || day === 6;
}

/** The Monday of the week a date falls in. */
export function weekStartOf(date: string): string {
  return format(
    startOfWeek(new Date(`${date}T00:00:00`), { weekStartsOn: 1 }),
    'yyyy-MM-dd',
  );
}

/**
 * Whether an edit on `date` belongs to the week the toolbar is anchored on.
 *
 * The canvas shows three weeks and the publish, repeat and copy actions apply
 * to exactly one of them. Anything acting on a date outside the anchor week
 * has to say which week it is about, or a manager publishing "this week" while
 * looking at next week's columns publishes the wrong one.
 */
export function isInAnchorWeek(date: string, anchorWeekStart: string): boolean {
  return weekStartOf(date) === anchorWeekStart;
}

/**
 * The grid's column template for `count` date columns.
 *
 * Inline rather than a Tailwind class because the count is a runtime value:
 * the planner shows three weeks at once, and Tailwind cannot generate
 * `repeat(21, …)` from a class it never sees in the source.
 *
 * Each day gets a **minimum** width, so twenty-one of them overflow their
 * container and scroll rather than compressing to unreadable slivers. A single
 * week still stretches to fill a wide screen, because the same track is `1fr`
 * above its minimum.
 *
 * It lives here rather than beside the row component so that file exports only
 * components and keeps fast refresh.
 */
export function rotaGridTemplate(count: number): string {
  return `minmax(0,11rem) repeat(${count}, minmax(6.5rem,1fr)) 3.5rem`;
}
