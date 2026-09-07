import { listShiftsOverlapping } from '@/services/shiftService';
import { listClockEventsForOrg } from '@/services/clockService';
import { operationalWindow, type OperationalWindow } from '@/lib/operationalDay';
import {
  buildAttendanceRows,
  countOpenShifts,
  summariseAttendance,
  type AttendanceCounts,
  type AttendanceRow,
} from '@/lib/attendance';
import type { Shift } from '@/types';

/**
 * Reads for the attendance board and the operational dashboard.
 *
 * The whole point of this module is that both screens read the same rows
 * through the same window. Before it, the dashboard, the schedule strip and
 * the timesheet each built their own query and their own arithmetic, and the
 * three disagreed about who was on shift — which is not a presentational
 * problem, it is three different answers to the question the product exists
 * to answer.
 *
 * Everything here is a read. Corrections go through `clockService`, which
 * already carries the RLS that restricts them to a manager.
 */

export interface AttendanceDayQuery {
  orgId: string;
  /** Local date in `timezone`, from `operationalDate`. */
  date: string;
  timezone: string;
  locationId?: string | null;
  /**
   * Operational reads use the published rota. A draft is a plan, and counting
   * a published shift together with its unpublished amendment would count the
   * same work twice. A planning view passes `false` and labels what it shows.
   */
  publishedOnly?: boolean;
}

export interface AttendanceDay {
  window: OperationalWindow;
  /** Shifts overlapping the day, so a night shift in progress is included. */
  shifts: Shift[];
  rows: AttendanceRow[];
  counts: AttendanceCounts;
  /**
   * The instant the snapshot was taken. Shown as "last updated" so a stale
   * tab reads as stale rather than as current.
   */
  fetchedAt: string;
}

/**
 * One operational day: its shifts, its attendance rows and its counts.
 *
 * Two windows, and the difference matters:
 *
 *   * **shifts** are read by overlap across the day itself, so a 22:00-06:00
 *     shift appears on both the day it starts and the small hours it runs
 *     into. A `starts_at`-bounded read returns nothing at 01:00.
 *   * **clock events** are read across the day *plus 24 hours either side*
 *     (`operationalWindow`'s context margin), because a clock-out inside the
 *     day has its clock-in outside it, and `pairClockEvents` correctly refuses
 *     to build a segment from an `out` alone. Without the margin a night shift
 *     contributes no hours to the day it ends on and an unbounded open segment
 *     on the day it starts.
 */
export async function loadAttendanceDay(
  query: AttendanceDayQuery,
): Promise<AttendanceDay> {
  const window = operationalWindow(query.date, query.timezone);
  const now = new Date();

  const [shifts, events] = await Promise.all([
    listShiftsOverlapping({
      orgId: query.orgId,
      fromIso: window.fromIso,
      toIso: window.toIso,
      locationId: query.locationId ?? null,
      publishedOnly: query.publishedOnly !== false,
    }),
    listClockEventsForOrg({
      orgId: query.orgId,
      fromIso: window.fromIso,
      toIso: window.toIso,
      withBoundaryContext: true,
    }),
  ]);

  const rows = buildAttendanceRows({
    shifts,
    events,
    now,
    timezone: query.timezone,
    windowFromIso: window.fromIso,
    windowToIso: window.toIso,
  });

  return {
    window,
    shifts,
    rows,
    counts: summariseAttendance(rows, shifts),
    fetchedAt: now.toISOString(),
  };
}

export interface AttendanceRangeQuery {
  orgId: string;
  /** Inclusive local date. */
  fromDate: string;
  /** Inclusive local date. */
  toDate: string;
  timezone: string;
  locationId?: string | null;
  publishedOnly?: boolean;
}

export interface AttendanceRange {
  fromIso: string;
  toIso: string;
  shifts: Shift[];
  rows: AttendanceRow[];
  counts: AttendanceCounts;
  openShifts: number;
  fetchedAt: string;
}

/**
 * The attendance workspace's table: any span of days, one pass.
 *
 * The span is read as a single query rather than a day at a time. A per-day
 * fan-out over a month is thirty round trips for data one query returns, and
 * — worse — it re-pairs the event stream inside each day, which is precisely
 * how a night shift's hours get counted against `now` instead of against its
 * own clock-out. `hours.ts` says this in as many words; this is the read that
 * obeys it.
 */
export async function loadAttendanceRange(
  query: AttendanceRangeQuery,
): Promise<AttendanceRange> {
  const first = operationalWindow(query.fromDate, query.timezone);
  const last = operationalWindow(query.toDate, query.timezone);
  const now = new Date();

  const [shifts, events] = await Promise.all([
    listShiftsOverlapping({
      orgId: query.orgId,
      fromIso: first.fromIso,
      toIso: last.toIso,
      locationId: query.locationId ?? null,
      publishedOnly: query.publishedOnly !== false,
    }),
    listClockEventsForOrg({
      orgId: query.orgId,
      fromIso: first.fromIso,
      toIso: last.toIso,
      withBoundaryContext: true,
    }),
  ]);

  const rows = buildAttendanceRows({
    shifts,
    events,
    now,
    timezone: query.timezone,
    windowFromIso: first.fromIso,
    windowToIso: last.toIso,
  });

  return {
    fromIso: first.fromIso,
    toIso: last.toIso,
    shifts,
    rows,
    counts: summariseAttendance(rows, shifts),
    openShifts: countOpenShifts(shifts),
    fetchedAt: now.toISOString(),
  };
}
