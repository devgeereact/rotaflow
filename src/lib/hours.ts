import type { ClockEvent } from '@/types';

/** Why a segment cannot be trusted as-is. `null` when the data is complete. */
export type SegmentReviewReason =
  /** A clock-in with no clock-out, superseded by a later clock-in. */
  | 'missing_clock_out'
  /** A break was started and never ended before the shift closed. */
  | 'unclosed_break';

export interface WorkedSegment {
  clockIn: ClockEvent;
  clockOut: ClockEvent | null;
  breakMinutes: number;
  /** Minutes worked, excluding breaks. Ongoing (no clockOut yet) uses `now`. */
  minutes: number;
  /**
   * Set when the event stream was ambiguous and `minutes` is a defensible
   * reading rather than a fact. A manager should correct the underlying events.
   * See the header for why this exists rather than a silent best guess.
   */
  reviewReason: SegmentReviewReason | null;
}

/**
 * Pairs a chronological event stream into worked segments (in → out, minus
 * any break in between). There is no `timesheets` automation in the schema
 * (docs/SCHEMA.md. It's a manually-managed aggregate, not trigger-populated),
 * so this is computed client-side directly from `clock_events` rather than
 * reading a maintained total.
 *
 * This is the highest-consequence arithmetic in the app: its output becomes
 * someone's pay. Nothing here throws, so every bug is a silently wrong payslip.
 *
 * The governing rule, learned from three bugs this module shipped with:
 * **where the events are ambiguous, do not guess silently.** Produce the
 * reading the evidence supports AND set `reviewReason`, so the timesheet screen
 * can surface it for a human instead of quietly turning a gap in the data into
 * a number on a payslip.
 *
 * Tolerant of an `out` with no matching `in` (a queued offline event replayed
 * out of order, or a manually corrected row). It is ignored rather than
 * producing a segment that starts at the epoch.
 */
export function pairClockEvents(
  events: ClockEvent[],
  now: Date = new Date(),
): WorkedSegment[] {
  const sorted = [...events].sort(
    (a, b) => new Date(a.event_at).getTime() - new Date(b.event_at).getTime(),
  );

  const segments: WorkedSegment[] = [];
  let openIn: ClockEvent | null = null;
  let breakStart: ClockEvent | null = null;
  let breakMinutes = 0;

  const minutesBetween = (from: string, to: string | Date): number =>
    ((to instanceof Date ? to.getTime() : new Date(to).getTime()) -
      new Date(from).getTime()) /
    60_000;

  /**
   * Close the open shift at `endedAt`. `clockOut` is null for an abandoned or
   * still-running segment; `reason` marks it for review.
   */
  const closeSegment = (
    clockOut: ClockEvent | null,
    endedAt: string | Date,
    reason: SegmentReviewReason | null,
  ): void => {
    if (!openIn) return;

    let breaks = breakMinutes;
    let effectiveReason = reason;

    // A break that was started and never ended. The break_start event is
    // evidence the person stopped working; there is no evidence they resumed.
    // The literal reading is that the break ran to the end of the shift, so
    // that is what is deducted, but it is flagged, because the alternative
    // (they forgot to press "end break" and worked on) is just as likely and
    // only a human can tell. Previously this branch deducted NOTHING, so an
    // unclosed break was paid in full and nobody ever saw it.
    if (breakStart) {
      breaks += Math.max(0, minutesBetween(breakStart.event_at, endedAt));
      effectiveReason = effectiveReason ?? 'unclosed_break';
    }

    const grossMinutes = Math.max(0, minutesBetween(openIn.event_at, endedAt));

    segments.push({
      clockIn: openIn,
      clockOut,
      breakMinutes: breaks,
      // Clamped: contradictory rows (a break_end belonging to another day)
      // must never produce a negative that subtracts from the week's total.
      minutes: Math.max(0, grossMinutes - breaks),
      reviewReason: effectiveReason,
    });

    openIn = null;
    breakStart = null;
    breakMinutes = 0;
  };

  for (const event of sorted) {
    if (event.type === 'in') {
      // A second clock-in while one is already open means the first shift was
      // never closed. Someone forgot to clock out, then started their next
      // shift. This used to overwrite `openIn`, deleting the earlier shift
      // outright: a full day worked and never paid, with no error and no trace.
      //
      // It is emitted instead with zero minutes and a review flag. Zero, not an
      // invented length, because the end time is genuinely unknown and guessing
      // one is how you underpay or overpay someone by hours. Visible and wrong-
      // but-flagged beats invisible.
      //
      // A duplicate clock-in from an offline replay lands here too, as a
      // 0-minute flagged segment. That is the right outcome: a manager sees it
      // and clears it, rather than the app deciding on its own which of two
      // identical-looking events was real.
      if (openIn) closeSegment(null, openIn.event_at, 'missing_clock_out');
      openIn = event;
      breakMinutes = 0;
    } else if (event.type === 'break_start' && openIn) {
      breakStart = event;
    } else if (event.type === 'break_end' && openIn && breakStart) {
      breakMinutes += Math.max(0, minutesBetween(breakStart.event_at, event.event_at));
      breakStart = null;
    } else if (event.type === 'out' && openIn) {
      closeSegment(event, event.event_at, null);
    }
  }

  // Still clocked in, an ongoing segment up to `now`, not dropped.
  if (openIn) closeSegment(null, now, null);

  return segments;
}

export function totalWorkedMinutes(segments: WorkedSegment[]): number {
  return segments.reduce((sum, s) => sum + s.minutes, 0);
}

/** Segments a manager needs to correct before the timesheet can be trusted. */
export function segmentsNeedingReview(segments: WorkedSegment[]): WorkedSegment[] {
  return segments.filter((s) => s.reviewReason !== null);
}

export function formatHours(minutes: number): string {
  return (minutes / 60).toFixed(1);
}

/**
 * How far either side of a reporting window the event stream must be read for
 * the segments inside it to be complete.
 *
 * RF-08. A clock query bounded exactly by the window returns an `out` whose
 * `in` fell before it, and `pairClockEvents` — correctly — ignores an `out`
 * with no `in`. So a night shift that started at 23:00 contributed nothing to
 * the day it ended on. Worse in the other direction: the window that *did*
 * contain the 23:00 `in` did not contain the 07:00 `out`, so the segment was
 * closed against `now` instead, and a report run days later paid that person
 * for the intervening days with no review flag on it at all.
 *
 * Twenty-four hours. A worked segment longer than that is already a data
 * error the review flags exist to surface, and widening the margin further
 * costs a proportionally larger read on every report for no additional
 * correctness.
 */
export const BOUNDARY_CONTEXT_HOURS = 24;

/** `iso` shifted by `hours`, positive or negative. */
export function shiftIso(iso: string, hours: number): string {
  return new Date(new Date(iso).getTime() + hours * 3_600_000).toISOString();
}

/**
 * The segments a reporting period owns, from a stream read with boundary
 * context either side.
 *
 * A segment belongs to the period its clock-in falls in. That is the rule the
 * rest of the product already applies — `listShiftsForPeriod` filters on
 * `starts_at` for the same reason, and `getTimesheetReportRows` dates a row by
 * `segment.clockIn` — and it is the ordinary payroll convention for a night
 * shift: the whole of a 23:00-to-07:00 shift is Monday's, not six minutes of
 * Monday and the rest of Tuesday's.
 *
 * Stated as a rule rather than left implicit because the alternative —
 * allocating by overlap, clipping each segment at the boundary — is equally
 * defensible and produces different pay. Adjacent periods must agree on one of
 * them or the same hour is either paid twice or not at all. This is the one
 * the code already had; changing it is a payroll decision, not a refactor.
 */
export function segmentsStartingWithin(
  segments: WorkedSegment[],
  fromIso: string,
  toIso: string,
): WorkedSegment[] {
  const from = new Date(fromIso).getTime();
  const to = new Date(toIso).getTime();
  return segments.filter((segment) => {
    const startedAt = new Date(segment.clockIn.event_at).getTime();
    return startedAt >= from && startedAt < to;
  });
}
