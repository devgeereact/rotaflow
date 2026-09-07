/**
 * Operational attendance: what is actually happening on a shift, as opposed to
 * what was rostered.
 *
 * ## Why this module exists
 *
 * Until now the product had no answer to "who is working right now". The
 * manager dashboard's "On shift now" tile counted **assigned shifts**, drafts
 * included, from `dashboardService.loadWeeklyRosterSummary`; the schedule
 * screen counted a second, different thing (`onShiftNow` = distinct assignees
 * rostered today) and then subtracted whoever held an open clock segment to
 * produce "not yet". Both are roster arithmetic wearing an attendance label.
 * Under either, a person who finished at 14:00 still counted at 22:00, a
 * person on their break was indistinguishable from a person on the floor, and
 * somebody whose shift starts at 18:00 was reported as "not yet clocked in"
 * from midnight onwards.
 *
 * Everything here derives from persisted `clock_events`, paired by
 * `pairClockEvents` — the same pass that produces the hours a timesheet pays —
 * so an attendance board and a payslip can never disagree about whether
 * somebody worked.
 *
 * ## The four rules this module is built on
 *
 * 1. **A person is not a shift.** Someone with two shifts today is one
 *    scheduled person and two scheduled shifts. Both counts exist and are
 *    named separately; neither is allowed to stand in for the other.
 * 2. **"Clocked in now" comes from an open segment**, never from the roster.
 *    A segment that is open *and* has an open break is a distinct state, not
 *    a rounding of "working".
 * 3. **Absence is never asserted.** The absence of a clock event is
 *    `not_recorded` — a thing to look at — because an unsynchronised offline
 *    clock-in is indistinguishable, from the server, from never having
 *    happened. `docs/OFFLINE-SPEC.md` is explicit that the queue lives on the
 *    device. Only the person's own device knows, so the manager's screen must
 *    say what it does not know rather than accuse.
 * 4. **An event is linked to a shift by evidence, then by proximity, never by
 *    "it happened that day".** `clock_events.shift_id` is authoritative where
 *    the device recorded one. Where it did not, the nearest start inside a
 *    bounded tolerance wins, each segment is used at most once, and anything
 *    left over surfaces as an unscheduled clock-in rather than being folded
 *    into whichever shift happened to be last.
 *
 * Pure, and in `lib` rather than `services` for the reason RULES.md gives:
 * this is the arithmetic behind someone's pay and their attendance record, so
 * it has to be testable without a network, a session or a WebSocket.
 */
import {
  pairClockEvents,
  type SegmentReviewReason,
  type WorkedSegment,
} from '@/lib/hours';
import { shiftNetMinutes } from '@/lib/rotaInsights';
import type { ClockEvent, Shift } from '@/types';

/**
 * How long after a scheduled start a missing clock-in stops being "due" and
 * becomes "late".
 *
 * Fifteen minutes, matching `CLOCK_IN_WINDOW_MINUTES` in `clockRows.ts` — the
 * window the clock-in screen already tells staff about ("within 15 minutes of
 * your scheduled start time"). One number, so the promise made to a staff
 * member and the flag raised on their manager's screen are the same rule.
 */
export const LATE_GRACE_MINUTES = 15;

/**
 * How far from a shift's scheduled start a clock-in may fall and still be
 * taken as belonging to it, when the event carries no `shift_id`.
 *
 * Four hours either side. Wide enough to absorb an early arrival, a late
 * clock-in and a handover that overran; narrow enough that a morning event
 * cannot be attached to a night shift twelve hours away. Where two shifts are
 * both inside the tolerance the nearest start wins, which is what makes
 * back-to-back shifts resolve correctly rather than by ordering luck.
 */
export const SHIFT_MATCH_TOLERANCE_MINUTES = 240;

/**
 * The state of one rostered shift, or of one clock segment that answers to no
 * shift.
 *
 * These are deliberately not collapsed. `completed` and `working` are both
 * "attended"; `late` and `not_recorded` are both "no clock-in yet" — but a
 * manager acts differently on each, and a tile that merges them is a tile
 * whose drill-down cannot match it.
 */
export type AttendanceStatus =
  /** Rostered, start still ahead. Not a problem and never counted as one. */
  | 'scheduled'
  /** Start has passed by more than the grace period with no clock-in. */
  | 'late'
  /** An open clock segment with no open break. On the floor. */
  | 'working'
  /** An open clock segment whose break has not been ended. */
  | 'on_break'
  /** Clocked in and clocked out. */
  | 'completed'
  /** The shift has ended and the segment is still open. Needs a clock-out. */
  | 'missing_clock_out'
  /**
   * The shift ended and the server holds no events for it. Explicitly NOT
   * "absent": an offline clock-in that has not synchronised looks exactly
   * like this from here.
   */
  | 'not_recorded'
  /** A worked segment that matches no rostered shift. */
  | 'unscheduled';

/** How the status should be dressed. Paired with a label so colour is never the only signal. */
export type AttendanceTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info';

export interface AttendanceStatusMeta {
  label: string;
  tone: AttendanceTone;
  /**
   * What the status means, in one sentence, shown wherever the status is
   * counted. Every tile on the dashboard carries the definition of the number
   * it shows, because "on shift now" meaning three different things on three
   * screens is the defect this module was written to remove.
   */
  definition: string;
}

export const ATTENDANCE_STATUS_META: Record<AttendanceStatus, AttendanceStatusMeta> = {
  scheduled: {
    label: 'Scheduled',
    tone: 'neutral',
    definition: 'Rostered, and the shift has not started yet.',
  },
  late: {
    label: 'Late',
    tone: 'warning',
    definition: `Started more than ${LATE_GRACE_MINUTES} minutes ago with no clock-in received.`,
  },
  working: {
    label: 'Working',
    tone: 'success',
    definition: 'Clocked in, not on a break.',
  },
  on_break: {
    label: 'On break',
    tone: 'info',
    definition: 'Clocked in, with a break started and not yet ended.',
  },
  completed: {
    label: 'Completed',
    tone: 'neutral',
    definition: 'Clocked in and clocked out.',
  },
  missing_clock_out: {
    label: 'Needs clock-out',
    tone: 'danger',
    definition: 'The shift has ended and the clock-in was never closed.',
  },
  not_recorded: {
    label: 'Not recorded',
    tone: 'warning',
    definition:
      'No clock events have reached the server for this shift. An unsynchronised offline clock-in looks the same from here, so this is not a record of absence.',
  },
  unscheduled: {
    label: 'Unscheduled',
    tone: 'info',
    definition: 'A worked segment that does not match any rostered shift.',
  },
};

/** Statuses a manager is expected to act on. Drives the "issues" list and its count. */
export const ATTENDANCE_EXCEPTION_STATUSES: readonly AttendanceStatus[] = [
  'late',
  'missing_clock_out',
  'not_recorded',
  'unscheduled',
];

export function isAttendanceException(status: AttendanceStatus): boolean {
  return ATTENDANCE_EXCEPTION_STATUSES.includes(status);
}

/**
 * How severe a row is, for the "sort by exception severity" control and for
 * ordering the dashboard's issues list. Higher is more urgent.
 */
export function attendanceSeverity(status: AttendanceStatus): number {
  switch (status) {
    case 'missing_clock_out':
      return 4;
    case 'late':
      return 3;
    case 'not_recorded':
      return 2;
    case 'unscheduled':
      return 1;
    default:
      return 0;
  }
}

export interface AttendanceRow {
  /** Stable across refreshes: the shift id, or the clock-in's id for an unscheduled segment. */
  key: string;
  staffProfileId: string;
  /** `null` on an unscheduled segment, which by definition has no shift. */
  shiftId: string | null;
  locationId: string | null;
  departmentId: string | null;
  shiftTypeId: string | null;
  status: AttendanceStatus;
  /** Planned instants from the roster. `null` on an unscheduled segment. */
  plannedStartIso: string | null;
  plannedEndIso: string | null;
  /** Unpaid break the roster planned for, in minutes. */
  plannedBreakMinutes: number;
  /** Actual instants from `clock_events`. `null` where nothing was received. */
  actualInIso: string | null;
  actualOutIso: string | null;
  /** Break deducted from the worked total, in minutes. `null` with no segment. */
  breakMinutes: number | null;
  /** Worked minutes net of break, from `pairClockEvents`. `null` with no segment. */
  workedMinutes: number | null;
  /** Worked minus planned-net. `null` unless both are known. */
  varianceMinutes: number | null;
  /** Carried straight from the segment so the review reason is never restated. */
  reviewReason: SegmentReviewReason | null;
  /** `method` on the clock-in ('gps', 'manual', …), where one was recorded. */
  source: string | null;
  /** Where the device said it was, where it said anything. */
  locationName: string | null;
  /**
   * True when the shift was matched to its segment by proximity rather than
   * by `clock_events.shift_id`. Surfaced, not hidden: it is the difference
   * between a fact and this module's best reading of one.
   */
  matchedByProximity: boolean;
  /**
   * True when planned or actual times cross local midnight, so a table can
   * print the date beside the time rather than showing 06:00 next to 22:00
   * with nothing to say they are different days.
   */
  crossesMidnight: boolean;
  /** Minutes past the scheduled start when `status === 'late'`, else `null`. */
  minutesLate: number | null;
  /** The events behind this row, oldest first, for the detail timeline. */
  events: ClockEvent[];
}

function minutesBetween(fromIso: string, to: string | Date): number {
  const end = to instanceof Date ? to.getTime() : new Date(to).getTime();
  return (end - new Date(fromIso).getTime()) / 60_000;
}

/** Local calendar day of an instant in one timezone, as 'YYYY-MM-DD'. */
function localDay(iso: string, timezone: string): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date(iso));
}

/**
 * Whether a row spans local midnight, in the timezone it will be read in.
 *
 * Compared as local calendar days rather than by adding 24 hours: on a
 * clock-change date a "day" is 23 or 25 hours long, and a fixed-offset
 * comparison reports an overnight shift on the wrong side of the transition.
 */
function spansMidnight(
  startIso: string | null,
  endIso: string | null,
  timezone: string,
): boolean {
  if (!startIso || !endIso) return false;
  return localDay(startIso, timezone) !== localDay(endIso, timezone);
}

interface Candidate {
  shiftIndex: number;
  segmentIndex: number;
  deltaMinutes: number;
  explicit: boolean;
}

/**
 * Pair one person's shifts with one person's worked segments.
 *
 * Returns a map from shift index to segment index. Every shift takes at most
 * one segment and every segment is taken at most once; whatever is left over
 * is reported by the caller rather than absorbed.
 *
 * The candidate list is scored and then assigned in order of confidence —
 * every explicit `shift_id` link first, then the closest proximity matches —
 * so the outcome does not depend on the order the rows arrived in. A greedy
 * chronological walk gets back-to-back shifts wrong whenever the first
 * clock-in is late enough to sit nearer the second shift's start.
 */
export function matchSegmentsToShifts(
  shifts: Shift[],
  segments: WorkedSegment[],
): Map<number, number> {
  const candidates: Candidate[] = [];

  shifts.forEach((shift, shiftIndex) => {
    segments.forEach((segment, segmentIndex) => {
      const explicit = segment.clockIn.shift_id === shift.id;
      const delta = Math.abs(minutesBetween(shift.starts_at, segment.clockIn.event_at));
      if (!explicit && delta > SHIFT_MATCH_TOLERANCE_MINUTES) return;
      candidates.push({ shiftIndex, segmentIndex, deltaMinutes: delta, explicit });
    });
  });

  candidates.sort((a, b) => {
    if (a.explicit !== b.explicit) return a.explicit ? -1 : 1;
    if (a.deltaMinutes !== b.deltaMinutes) return a.deltaMinutes - b.deltaMinutes;
    // Total order, so two equidistant candidates resolve the same way every
    // run rather than by array order.
    if (a.shiftIndex !== b.shiftIndex) return a.shiftIndex - b.shiftIndex;
    return a.segmentIndex - b.segmentIndex;
  });

  const shiftTaken = new Set<number>();
  const segmentTaken = new Set<number>();
  const matched = new Map<number, number>();

  for (const candidate of candidates) {
    if (shiftTaken.has(candidate.shiftIndex)) continue;
    if (segmentTaken.has(candidate.segmentIndex)) continue;
    shiftTaken.add(candidate.shiftIndex);
    segmentTaken.add(candidate.segmentIndex);
    matched.set(candidate.shiftIndex, candidate.segmentIndex);
  }

  return matched;
}

/** The events belonging to one segment, inclusive of its clock-in and clock-out. */
function eventsForSegment(events: ClockEvent[], segment: WorkedSegment): ClockEvent[] {
  const from = new Date(segment.clockIn.event_at).getTime();
  const to = segment.clockOut
    ? new Date(segment.clockOut.event_at).getTime()
    : Number.POSITIVE_INFINITY;
  return events.filter((event) => {
    const at = new Date(event.event_at).getTime();
    return at >= from && at <= to;
  });
}

function statusForOpenSegment(segment: WorkedSegment): AttendanceStatus {
  return segment.openBreakSince ? 'on_break' : 'working';
}

export interface BuildAttendanceInput {
  /**
   * The shifts to build rows for. The caller decides whether these are the
   * published rota or a draft-inclusive planning view; this module never
   * mixes the two, because a published shift and its unpublished amendment
   * would otherwise both produce a row and be counted twice.
   */
  shifts: Shift[];
  /**
   * Clock events across the same people, read with boundary context either
   * side of the window (see `BOUNDARY_CONTEXT_HOURS`). Without the context a
   * night shift's clock-out has no clock-in to pair with and the segment is
   * dropped.
   */
  events: ClockEvent[];
  /** The instant the board is being read at. Injected so tests are not clock-dependent. */
  now: Date;
  /** The timezone the row will be read in, for the midnight-crossing flag. */
  timezone: string;
  /**
   * Segments whose clock-in falls outside this window are used for pairing
   * but do not produce `unscheduled` rows of their own, so yesterday's
   * boundary context cannot appear as today's exception.
   */
  windowFromIso: string;
  windowToIso: string;
  graceMinutes?: number;
}

/**
 * One row per rostered shift, plus one row per worked segment that matched no
 * shift.
 *
 * An **unassigned** shift (`staff_profile_id === null`) produces no row here:
 * it is an open shift, a staffing gap rather than an attendance record, and
 * `countOpenShifts` reports it separately. Folding it in would put a person
 * column with nobody in it on an attendance table.
 */
export function buildAttendanceRows(input: BuildAttendanceInput): AttendanceRow[] {
  const grace = input.graceMinutes ?? LATE_GRACE_MINUTES;
  const windowFrom = new Date(input.windowFromIso).getTime();
  const windowTo = new Date(input.windowToIso).getTime();

  const shiftsByStaff = new Map<string, Shift[]>();
  for (const shift of input.shifts) {
    if (!shift.staff_profile_id) continue;
    const list = shiftsByStaff.get(shift.staff_profile_id) ?? [];
    list.push(shift);
    shiftsByStaff.set(shift.staff_profile_id, list);
  }

  const eventsByStaff = new Map<string, ClockEvent[]>();
  for (const event of input.events) {
    const list = eventsByStaff.get(event.staff_profile_id) ?? [];
    list.push(event);
    eventsByStaff.set(event.staff_profile_id, list);
  }

  const rows: AttendanceRow[] = [];
  const staffIds = new Set([...shiftsByStaff.keys(), ...eventsByStaff.keys()]);

  for (const staffProfileId of staffIds) {
    const shifts = [...(shiftsByStaff.get(staffProfileId) ?? [])].sort((a, b) =>
      a.starts_at === b.starts_at
        ? a.id.localeCompare(b.id)
        : a.starts_at.localeCompare(b.starts_at),
    );
    const events = [...(eventsByStaff.get(staffProfileId) ?? [])].sort((a, b) =>
      a.event_at === b.event_at
        ? a.id.localeCompare(b.id)
        : a.event_at.localeCompare(b.event_at),
    );
    const segments = pairClockEvents(events, input.now);
    const matched = matchSegmentsToShifts(shifts, segments);
    const usedSegments = new Set(matched.values());

    shifts.forEach((shift, index) => {
      const segmentIndex = matched.get(index);
      const segment = segmentIndex === undefined ? undefined : segments[segmentIndex];
      const plannedNet = shiftNetMinutes(shift);
      const ended = new Date(shift.ends_at).getTime() <= input.now.getTime();
      const startedAgo = minutesBetween(shift.starts_at, input.now);

      let status: AttendanceStatus;
      if (segment) {
        if (segment.clockOut) status = 'completed';
        else if (segment.reviewReason === 'missing_clock_out')
          status = 'missing_clock_out';
        else if (ended) status = 'missing_clock_out';
        else status = statusForOpenSegment(segment);
      } else if (ended) {
        status = 'not_recorded';
      } else if (startedAgo > grace) {
        status = 'late';
      } else {
        status = 'scheduled';
      }

      const actualInIso = segment?.clockIn.event_at ?? null;
      const actualOutIso = segment?.clockOut?.event_at ?? null;
      const workedMinutes = segment ? Math.round(segment.minutes) : null;

      rows.push({
        key: shift.id,
        staffProfileId,
        shiftId: shift.id,
        locationId: shift.location_id,
        departmentId: shift.department_id,
        shiftTypeId: shift.shift_type_id,
        status,
        plannedStartIso: shift.starts_at,
        plannedEndIso: shift.ends_at,
        plannedBreakMinutes: shift.break_minutes,
        actualInIso,
        actualOutIso,
        breakMinutes: segment ? Math.round(segment.breakMinutes) : null,
        workedMinutes,
        // Variance only where the shift is finished on both sides. An
        // in-progress shift is "behind" by definition and reporting that as a
        // negative variance is how a screen accuses somebody of short hours
        // three hours before they are due to leave.
        varianceMinutes:
          workedMinutes !== null && actualOutIso !== null
            ? workedMinutes - Math.round(plannedNet)
            : null,
        reviewReason: segment?.reviewReason ?? null,
        source: segment?.clockIn.method ?? null,
        locationName: segment?.clockIn.location_name ?? null,
        matchedByProximity: segment ? segment.clockIn.shift_id !== shift.id : false,
        crossesMidnight:
          spansMidnight(shift.starts_at, shift.ends_at, input.timezone) ||
          spansMidnight(actualInIso, actualOutIso, input.timezone),
        minutesLate: status === 'late' ? Math.round(startedAgo) : null,
        events: segment ? eventsForSegment(events, segment) : [],
      });
    });

    segments.forEach((segment, index) => {
      if (usedSegments.has(index)) return;
      const startedAt = new Date(segment.clockIn.event_at).getTime();
      if (startedAt < windowFrom || startedAt >= windowTo) return;

      const actualOutIso = segment.clockOut?.event_at ?? null;
      rows.push({
        key: `clock:${segment.clockIn.id}`,
        staffProfileId,
        shiftId: null,
        locationId: null,
        departmentId: null,
        shiftTypeId: null,
        status: segment.clockOut ? 'unscheduled' : statusForOpenSegment(segment),
        plannedStartIso: null,
        plannedEndIso: null,
        plannedBreakMinutes: 0,
        actualInIso: segment.clockIn.event_at,
        actualOutIso,
        breakMinutes: Math.round(segment.breakMinutes),
        workedMinutes: Math.round(segment.minutes),
        varianceMinutes: null,
        reviewReason: segment.reviewReason,
        source: segment.clockIn.method,
        locationName: segment.clockIn.location_name,
        matchedByProximity: false,
        crossesMidnight: spansMidnight(
          segment.clockIn.event_at,
          actualOutIso,
          input.timezone,
        ),
        minutesLate: null,
        events: eventsForSegment(events, segment),
      });
    });
  }

  return rows.sort((a, b) => {
    const aKey = a.plannedStartIso ?? a.actualInIso ?? '';
    const bKey = b.plannedStartIso ?? b.actualInIso ?? '';
    if (aKey !== bKey) return aKey.localeCompare(bKey);
    return a.key.localeCompare(b.key);
  });
}

/**
 * The counts an operational board shows, each one defined once.
 *
 * `scheduledPeople` and `scheduledShifts` are both here because they are
 * different numbers and both get asked for: cover is a question about people,
 * workload is a question about shifts.
 */
export interface AttendanceCounts {
  scheduledPeople: number;
  scheduledShifts: number;
  workingNow: number;
  onBreak: number;
  completed: number;
  late: number;
  notRecorded: number;
  missingClockOut: number;
  unscheduled: number;
  /** Rostered shifts with nobody assigned. Counted from the shifts, not the rows. */
  openShifts: number;
}

export function countOpenShifts(shifts: Shift[]): number {
  return shifts.filter((shift) => shift.staff_profile_id === null).length;
}

export function summariseAttendance(
  rows: AttendanceRow[],
  shifts: Shift[],
): AttendanceCounts {
  const people = new Set<string>();
  const working = new Set<string>();
  const onBreak = new Set<string>();
  let scheduledShifts = 0;
  let completed = 0;
  let late = 0;
  let notRecorded = 0;
  let missingClockOut = 0;
  let unscheduled = 0;

  for (const row of rows) {
    if (row.shiftId) {
      scheduledShifts += 1;
      people.add(row.staffProfileId);
    }
    switch (row.status) {
      case 'working':
        working.add(row.staffProfileId);
        break;
      case 'on_break':
        onBreak.add(row.staffProfileId);
        break;
      case 'completed':
        completed += 1;
        break;
      case 'late':
        late += 1;
        break;
      case 'not_recorded':
        notRecorded += 1;
        break;
      case 'missing_clock_out':
        missingClockOut += 1;
        break;
      case 'unscheduled':
        unscheduled += 1;
        break;
      default:
        break;
    }
  }

  // Counted as people, not rows: somebody with two shifts today who is on the
  // floor is one person working. A person is never in both sets — a segment
  // is open with a break or without one, never both — so they do not double.
  return {
    scheduledPeople: people.size,
    scheduledShifts,
    workingNow: working.size,
    onBreak: onBreak.size,
    completed,
    late,
    notRecorded,
    missingClockOut,
    unscheduled,
    openShifts: countOpenShifts(shifts),
  };
}

/** Exception rows, most urgent first, for the dashboard's issues list. */
export function attendanceExceptions(rows: AttendanceRow[]): AttendanceRow[] {
  return rows
    .filter((row) => isAttendanceException(row.status))
    .sort((a, b) => {
      const severity = attendanceSeverity(b.status) - attendanceSeverity(a.status);
      if (severity !== 0) return severity;
      const aKey = a.plannedStartIso ?? a.actualInIso ?? '';
      const bKey = b.plannedStartIso ?? b.actualInIso ?? '';
      return aKey.localeCompare(bKey);
    });
}
