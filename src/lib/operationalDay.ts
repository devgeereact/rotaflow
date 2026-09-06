/**
 * What "today" means to an operational screen, and which clock it is measured
 * against.
 *
 * ## Why this is not `todayIso()`
 *
 * `schedulePeriod.todayIso()` formats `new Date()` with the **browser's**
 * timezone. That is right for a person planning their own week and wrong for
 * an operations board: a manager covering a London home from a laptop still
 * set to New York would be shown yesterday's roster for five hours every
 * evening, with nothing on screen to say so. The dashboard's date has to come
 * from the timezone the work happens in.
 *
 * ## The reporting timezone, stated rather than borrowed
 *
 * `DashboardPage` hard-coded `Europe/London` and `SchedulePage` used
 * `locations[0]?.timezone` — the first site alphabetically, silently standing
 * in for every other one. Both are wrong for an organisation that spans zones,
 * and the second is worse because it looks deliberate.
 *
 * `resolveReportingTimezone` makes the choice explicit and returns *why*, so
 * the screen can print it. A single selected site uses its own zone; an
 * all-sites view uses the organisation's own zone, which is a real column
 * (`organisations.timezone`) rather than an inference. Where sites genuinely
 * differ, the board says which clock the dates are in and each row still shows
 * its own site-local times.
 */
import { addDays, format } from 'date-fns';
import { BOUNDARY_CONTEXT_HOURS, shiftIso } from '@/lib/hours';
import { resolvePeriod, type SchedulePeriod } from '@/lib/schedulePeriod';
import type { Location } from '@/types';

/** The fallback used when an organisation has no timezone recorded at all. */
export const FALLBACK_TIMEZONE = 'Europe/London';

/** The local calendar date of `at` in `timezone`, as 'YYYY-MM-DD'. */
export function operationalDate(at: Date, timezone: string): string {
  // `en-CA` formats as YYYY-MM-DD, and `Intl` resolves the offset for that
  // instant, so this is correct across a DST transition where an arithmetic
  // offset is not.
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(at);
}

/**
 * The day after `date`, by calendar.
 *
 * Deliberately independent of any week or month window. "Tomorrow" on a
 * Sunday, on 31 December, or on the last day of a month is the next calendar
 * day, and a screen that derives it by indexing into the current week's
 * `dates` array returns `undefined` on exactly those days — which renders as
 * an empty table that looks like nobody is rostered.
 */
export function nextDay(date: string): string {
  return format(addDays(new Date(`${date}T00:00:00`), 1), 'yyyy-MM-dd');
}

/** The instant window covering one local day in `timezone`. DST-safe. */
export function dayWindow(date: string, timezone: string): SchedulePeriod {
  return resolvePeriod('day', date, timezone);
}

export interface OperationalWindow {
  /** The local date this window is about. */
  date: string;
  /** Inclusive instant for local midnight. */
  fromIso: string;
  /** Exclusive instant for the following local midnight. */
  toIso: string;
  /**
   * How far back shifts and clock events must be read for this window to be
   * complete: a shift that started at 22:00 yesterday is still running at
   * 01:00, and a clock-out inside the window has its clock-in outside it.
   */
  contextFromIso: string;
  /** The matching forward margin, for a clock-out that lands after midnight. */
  contextToIso: string;
}

/**
 * One local day plus the context either side of it that makes the day's own
 * rows complete.
 *
 * The margin is `BOUNDARY_CONTEXT_HOURS`, the same 24 hours `hours.ts` already
 * defines and justifies for reporting, so an attendance board and a timesheet
 * read the same stream rather than two windows that disagree at the edges.
 */
export function operationalWindow(date: string, timezone: string): OperationalWindow {
  const window = dayWindow(date, timezone);
  return {
    date,
    fromIso: window.fromIso,
    toIso: window.toIso,
    contextFromIso: shiftIso(window.fromIso, -BOUNDARY_CONTEXT_HOURS),
    contextToIso: shiftIso(window.toIso, BOUNDARY_CONTEXT_HOURS),
  };
}

export interface ReportingTimezone {
  timezone: string;
  /** The name to print beside the date, e.g. "Riverside House" or "Organisation". */
  label: string;
  /**
   * True when more than one site is in scope and they do not all share a
   * timezone. The board must then say which clock its dates are in, and row
   * times stay site-local.
   */
  mixed: boolean;
}

/**
 * Which clock an operational view is reported in.
 *
 * A single site answers for itself. An all-sites view answers with the
 * organisation's own timezone — never the first site's, which is the bug this
 * function exists to remove.
 */
export function resolveReportingTimezone(
  locations: Location[],
  selectedLocationId: string | null,
  orgTimezone: string | null,
): ReportingTimezone {
  if (selectedLocationId) {
    const site = locations.find((l) => l.id === selectedLocationId);
    if (site) return { timezone: site.timezone, label: site.name, mixed: false };
  }

  const zones = new Set(locations.map((l) => l.timezone));
  const organisation = orgTimezone ?? locations[0]?.timezone ?? FALLBACK_TIMEZONE;

  return {
    timezone: organisation,
    label: 'Organisation',
    mixed: zones.size > 1,
  };
}

/**
 * Milliseconds until the next local midnight in `timezone`, so an open tab can
 * roll its operational date over rather than showing yesterday until somebody
 * reloads.
 *
 * Clamped to at least a second: a zero or negative delay from a clock skew
 * would spin a timer.
 */
export function millisecondsUntilNextLocalMidnight(at: Date, timezone: string): number {
  const today = operationalDate(at, timezone);
  const midnight = new Date(dayWindow(today, timezone).toIso).getTime();
  return Math.max(1_000, midnight - at.getTime());
}
