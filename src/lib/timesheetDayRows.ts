import { addDays, format, startOfWeek } from 'date-fns';
import { totalWorkedMinutes, type WorkedSegment } from '@/lib/hours';
import { fromIsoInTimezone } from '@/lib/rotaGrid';
import { shiftNetMinutes } from '@/lib/rotaInsights';
import type { Location, Shift } from '@/types';

export type TimesheetDayStatus = 'complete' | 'late' | 'on_shift' | 'absent';

export interface TimesheetDayRow {
  staffId: string;
  shiftId: string;
  locationId: string | null;
  scheduledMinutes: number;
  plannedLabel: string;
  actualLabel: string;
  /** null when there is nothing to pay yet: absent, or still clocked in and
   * not finalised. */
  paidMinutes: number | null;
  status: TimesheetDayStatus;
  flag: string | null;
}

/** A clock-in later than this past the shift's own start reads as "late",
 * matching the reference's "12 min late" example rather than flagging every
 * clock-in a minute or two after the hour. */
const LATE_THRESHOLD_MINUTES = 5;

/**
 * The segment this shift's clock events actually belong to.
 *
 * `clock_events.shift_id` is set at insert time (`ClockInPage.submit`), but
 * an offline-queued event can be replayed without it, so this reads the
 * event times themselves rather than trusting the column: a segment whose
 * clock-in falls from three hours before the shift starts (an early
 * arrival) to its scheduled end. Ties go to whichever clock-in is closest
 * to the shift's own start.
 */
function pickSegmentForShift(
  segments: WorkedSegment[],
  shift: Shift,
): WorkedSegment | null {
  const shiftStart = new Date(shift.starts_at).getTime();
  const shiftEnd = new Date(shift.ends_at).getTime();
  const candidates = segments.filter((s) => {
    const start = new Date(s.clockIn.event_at).getTime();
    return start >= shiftStart - 3 * 3_600_000 && start <= shiftEnd;
  });
  if (candidates.length === 0) return null;
  return candidates.reduce((closest, s) =>
    Math.abs(new Date(s.clockIn.event_at).getTime() - shiftStart) <
    Math.abs(new Date(closest.clockIn.event_at).getTime() - shiftStart)
      ? s
      : closest,
  );
}

/**
 * One row per staff member whose shift has already started today
 * (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.timesheets`). A shift later
 * today is not yet an attendance question, so `todaysStartedShifts` should
 * already be filtered to `starts_at <= now` before it reaches here — this
 * function has no clock of its own to check that against.
 */
export function buildTimesheetDayRows(
  todaysStartedShifts: Shift[],
  segmentsByStaff: Map<string, WorkedSegment[]>,
  locationById: Map<string, Location>,
  fallbackTimezone: string,
): TimesheetDayRow[] {
  return todaysStartedShifts
    .filter((s): s is Shift & { staff_profile_id: string } => s.staff_profile_id !== null)
    .map((shift) => {
      const timezone = shift.location_id
        ? (locationById.get(shift.location_id)?.timezone ?? fallbackTimezone)
        : fallbackTimezone;
      const { time: startTime } = fromIsoInTimezone(shift.starts_at, timezone);
      const { time: endTime } = fromIsoInTimezone(shift.ends_at, timezone);
      const plannedLabel = `${startTime}, ${endTime}`;
      const scheduledMinutes = shiftNetMinutes(shift);

      const segment = pickSegmentForShift(
        segmentsByStaff.get(shift.staff_profile_id) ?? [],
        shift,
      );

      const base = {
        staffId: shift.staff_profile_id,
        shiftId: shift.id,
        locationId: shift.location_id,
        scheduledMinutes,
        plannedLabel,
      };

      if (!segment) {
        return {
          ...base,
          actualLabel: '-',
          paidMinutes: null,
          status: 'absent' as const,
          flag: 'No clock-in recorded',
        };
      }

      const { time: clockInTime } = fromIsoInTimezone(segment.clockIn.event_at, timezone);

      if (!segment.clockOut) {
        return {
          ...base,
          actualLabel: `${clockInTime}, -`,
          paidMinutes: null,
          status: 'on_shift' as const,
          flag: 'Still clocked in',
        };
      }

      const { time: clockOutTime } = fromIsoInTimezone(
        segment.clockOut.event_at,
        timezone,
      );
      const actualLabel = `${clockInTime}, ${clockOutTime}`;
      const lateMinutes = Math.round(
        (new Date(segment.clockIn.event_at).getTime() -
          new Date(shift.starts_at).getTime()) /
          60_000,
      );

      if (lateMinutes > LATE_THRESHOLD_MINUTES) {
        return {
          ...base,
          actualLabel,
          paidMinutes: segment.minutes,
          status: 'late' as const,
          flag: `${lateMinutes} min late`,
        };
      }

      return {
        ...base,
        actualLabel,
        paidMinutes: segment.minutes,
        status: 'complete' as const,
        flag: null,
      };
    });
}

export interface TimesheetWeekTotals {
  scheduledMinutes: number;
  workedMinutes: number;
}

/** One person's scheduled vs actually-worked minutes for a week, for the
 * "Your hours this week" / "Overtime" tiles and the manager's per-person
 * week-approval total. */
export function weekTotalsForStaff(
  weekShifts: Shift[],
  weekSegments: WorkedSegment[],
): TimesheetWeekTotals {
  return {
    scheduledMinutes: weekShifts.reduce((sum, s) => sum + shiftNetMinutes(s), 0),
    workedMinutes: totalWorkedMinutes(weekSegments),
  };
}

/** The Friday of the week containing `now`, "the payroll cut-off" tile.
 * A fixed Friday cut-off is this org's policy, not a configurable setting —
 * there is nowhere in the schema that stores one. */
export function payrollCutOffLabel(now: Date): string {
  const monday = startOfWeek(now, { weekStartsOn: 1 });
  const friday = addDays(monday, 4);
  return format(friday, 'EEE d MMM');
}
