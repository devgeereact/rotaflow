import {
  addDays,
  addMonths,
  endOfMonth,
  format,
  startOfMonth,
  startOfWeek,
} from 'date-fns';
import { toIsoInTimezone } from '@/lib/rotaGrid';

export type ScheduleView = 'day' | 'week' | 'fortnight' | 'month';

export interface SchedulePeriod {
  /** Local dates covered, 'YYYY-MM-DD', in order. */
  dates: string[];
  /** Inclusive instant for the start of the window. */
  fromIso: string;
  /** Exclusive instant for the end of the window. */
  toIso: string;
  /** Human label for the period selector, e.g. "26 May – 1 Jun 2025". */
  label: string;
}

const DAY_MS = 86_400_000;

/** The anchor date snapped to the start of its period. */
export function periodStart(view: ScheduleView, anchor: string): string {
  const date = new Date(`${anchor}T00:00:00`);
  switch (view) {
    case 'day':
      return anchor;
    case 'month':
      return format(startOfMonth(date), 'yyyy-MM-dd');
    default:
      // Week and fortnight both start on Monday, matching the rota builder.
      return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
  }
}

/**
 * Resolve a view + anchor date into the concrete window to query and render.
 *
 * Boundaries are converted through the location's timezone rather than the
 * browser's: a rota for a London home viewed from a laptop set to New York must
 * still start at midnight in London (RULES.md §9).
 */
export function resolvePeriod(
  view: ScheduleView,
  anchor: string,
  timezone: string,
): SchedulePeriod {
  const start = periodStart(view, anchor);
  const startDate = new Date(`${start}T00:00:00`);

  let dates: string[];
  if (view === 'day') {
    dates = [start];
  } else if (view === 'week') {
    dates = Array.from({ length: 7 }, (_, i) =>
      format(addDays(startDate, i), 'yyyy-MM-dd'),
    );
  } else if (view === 'fortnight') {
    dates = Array.from({ length: 14 }, (_, i) =>
      format(addDays(startDate, i), 'yyyy-MM-dd'),
    );
  } else {
    const last = endOfMonth(startDate).getDate();
    dates = Array.from({ length: last }, (_, i) =>
      format(addDays(startDate, i), 'yyyy-MM-dd'),
    );
  }

  const firstDate = dates[0] ?? start;
  const lastDate = dates[dates.length - 1] ?? start;
  const dayAfterLast = format(
    new Date(new Date(`${lastDate}T00:00:00`).getTime() + DAY_MS),
    'yyyy-MM-dd',
  );

  return {
    dates,
    fromIso: toIsoInTimezone(firstDate, '00:00', timezone),
    toIso: toIsoInTimezone(dayAfterLast, '00:00', timezone),
    label: formatPeriodLabel(view, firstDate, lastDate),
  };
}

function formatPeriodLabel(view: ScheduleView, first: string, last: string): string {
  const start = new Date(`${first}T00:00:00`);
  const end = new Date(`${last}T00:00:00`);

  if (view === 'day') return format(start, 'EEEE d MMMM yyyy');
  if (view === 'month') return format(start, 'MMMM yyyy');

  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();

  if (sameMonth) {
    return `${format(start, 'd')} – ${format(end, 'd MMM yyyy')}`;
  }
  return sameYear
    ? `${format(start, 'd MMM')} – ${format(end, 'd MMM yyyy')}`
    : `${format(start, 'd MMM yyyy')} – ${format(end, 'd MMM yyyy')}`;
}

/** Move the anchor one period forward (+1) or back (-1). */
export function stepPeriod(
  view: ScheduleView,
  anchor: string,
  direction: 1 | -1,
): string {
  const date = new Date(`${anchor}T00:00:00`);
  switch (view) {
    case 'day':
      return format(addDays(date, direction), 'yyyy-MM-dd');
    case 'week':
      return format(addDays(date, 7 * direction), 'yyyy-MM-dd');
    case 'fortnight':
      return format(addDays(date, 14 * direction), 'yyyy-MM-dd');
    case 'month':
      return format(addMonths(date, direction), 'yyyy-MM-dd');
  }
}

export function todayIso(): string {
  return format(new Date(), 'yyyy-MM-dd');
}
