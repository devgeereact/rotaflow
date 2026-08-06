import { addDays, format, startOfWeek } from 'date-fns';
import { fromZonedTime, toZonedTime } from 'date-fns-tz';
import type { Shift } from '@/types';

const UNASSIGNED_KEY = 'unassigned';

/** Monday of the week containing `date`, as 'YYYY-MM-DD'. */
export function getMonday(date: Date): string {
  return format(startOfWeek(date, { weekStartsOn: 1 }), 'yyyy-MM-dd');
}

/** The 7 dates of the week starting at `weekStartIso` (expected to be a Monday). */
export function getWeekDates(weekStartIso: string): string[] {
  const start = new Date(`${weekStartIso}T00:00:00`);
  return Array.from({ length: 7 }, (_, i) => format(addDays(start, i), 'yyyy-MM-dd'));
}

export function shiftCellKey(staffProfileId: string | null, dateIso: string): string {
  return `${staffProfileId ?? UNASSIGNED_KEY}::${dateIso}`;
}

/** Inverse of the `cell:${shiftCellKey(...)}` droppable id used on the grid. */
export function parseCellId(
  id: string,
): { staffProfileId: string | null; date: string } | null {
  if (!id.startsWith('cell:')) return null;
  const [staffPart, date] = id.slice('cell:'.length).split('::');
  if (!staffPart || !date) return null;
  return { staffProfileId: staffPart === UNASSIGNED_KEY ? null : staffPart, date };
}

/** Groups shifts by staff+date cell for O(1) grid lookups. */
export function buildShiftMap(shifts: Shift[], timezone: string): Map<string, Shift[]> {
  const map = new Map<string, Shift[]>();
  for (const shift of shifts) {
    const localDate = format(
      toZonedTime(new Date(shift.starts_at), timezone),
      'yyyy-MM-dd',
    );
    const key = shiftCellKey(shift.staff_profile_id, localDate);
    map.set(key, [...(map.get(key) ?? []), shift]);
  }
  return map;
}

/**
 * Converts a local date + time *in the given location's timezone* to a
 * correct UTC ISO timestamp. RULES.md §9: shift times display in the
 * location's timezone, never the browser's local zone.
 */
export function toIsoInTimezone(date: string, time: string, timezone: string): string {
  return fromZonedTime(`${date}T${time}:00`, timezone).toISOString();
}

/**
 * Start/end ISO timestamps for a shift on `date`, handling shifts that cross
 * midnight (e.g. a 22:00-06:00 night shift) by rolling the end date forward
 * a day when endTime is earlier than startTime.
 */
export function computeShiftIsoRange(
  date: string,
  startTime: string,
  endTime: string,
  timezone: string,
): { startsAt: string; endsAt: string } {
  if (endTime === startTime) {
    throw new Error('Shift start and end time cannot be the same.');
  }
  const startsAt = toIsoInTimezone(date, startTime, timezone);
  const crossesMidnight = endTime < startTime;
  const endDate = crossesMidnight
    ? format(addDays(new Date(`${date}T00:00:00`), 1), 'yyyy-MM-dd')
    : date;
  const endsAt = toIsoInTimezone(endDate, endTime, timezone);
  return { startsAt, endsAt };
}

/** Inverse of toIsoInTimezone, for pre-filling an edit form from a stored shift. */
export function fromIsoInTimezone(
  iso: string,
  timezone: string,
): { date: string; time: string } {
  const zoned = toZonedTime(new Date(iso), timezone);
  return { date: format(zoned, 'yyyy-MM-dd'), time: format(zoned, 'HH:mm') };
}

export type ShiftTimeState = 'past' | 'live' | 'future';

/**
 * Where a shift sits relative to now: already worked, running right now, or
 * still ahead. Drives the grid's colour rule. Past shifts render in a neutral
 * token, current and upcoming ones keep their shift-type colour.
 *
 * `now` is injected rather than read from the clock inside, so the rule is
 * testable at a fixed instant and every chip in one render agrees on "now"
 * instead of each re-reading a clock that may tick between them.
 */
export function shiftTimeState(
  startsAt: string,
  endsAt: string,
  now: number,
): ShiftTimeState {
  if (new Date(endsAt).getTime() <= now) return 'past';
  if (new Date(startsAt).getTime() <= now) return 'live';
  return 'future';
}

export function formatWeekLabel(weekStartIso: string): string {
  return format(new Date(`${weekStartIso}T00:00:00`), 'd MMMM yyyy');
}

export function formatDayLabel(dateIso: string): { weekday: string; day: string } {
  const d = new Date(`${dateIso}T00:00:00`);
  return { weekday: format(d, 'EEE'), day: format(d, 'd MMM') };
}

/** Total scheduled minutes across shifts (an honest, schema-backed summary, no fabricated coverage %). */
export function totalScheduledMinutes(shifts: Shift[]): number {
  return shifts.reduce((total, s) => {
    const ms = new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime();
    const net = Math.max(0, ms / 60000) - s.break_minutes;
    return total + Math.max(0, net);
  }, 0);
}

export function unfilledShiftCount(shifts: Shift[]): number {
  return shifts.filter((s) => !s.staff_profile_id).length;
}

export type DailyStatus = 'optimal' | 'understaffed' | 'empty';

export interface DailyTotal {
  date: string;
  staffCount: number;
  shiftCount: number;
  openCount: number;
  status: DailyStatus;
}

/**
 * Per-day staff/shift counts for the totals row, "Optimal" means every shift
 * that day has someone assigned; "Understaffed" means at least one is still
 * `open`. There is no schema-backed target headcount to compare against, so
 * this deliberately doesn't fabricate an "Overstaffed" signal or a coverage
 * percentage. See rota-log.md.
 */
export function computeDailyTotals(
  shifts: Shift[],
  dates: string[],
  timezone: string,
): DailyTotal[] {
  const byDate = new Map<string, Shift[]>();
  for (const shift of shifts) {
    const date = format(toZonedTime(new Date(shift.starts_at), timezone), 'yyyy-MM-dd');
    byDate.set(date, [...(byDate.get(date) ?? []), shift]);
  }

  return dates.map((date) => {
    const dayShifts = byDate.get(date) ?? [];
    const staffCount = new Set(
      dayShifts.map((s) => s.staff_profile_id).filter((id): id is string => id !== null),
    ).size;
    const openCount = dayShifts.filter((s) => !s.staff_profile_id).length;
    const status: DailyStatus =
      dayShifts.length === 0 ? 'empty' : openCount > 0 ? 'understaffed' : 'optimal';
    return { date, staffCount, shiftCount: dayShifts.length, openCount, status };
  });
}

/**
 * The other shifts that belong to the same rostered "shift" as `target`. Same
 * location, date, shift type and time window, whoever is assigned to each.
 * `open` rows in the group are unfilled slots for that shift, so
 * `assigned / (assigned + open)` is a real, schema-backed coverage ratio,
 * never a fabricated headcount target.
 */
export function shiftGroup(shifts: Shift[], target: Shift): Shift[] {
  return shifts.filter(
    (s) =>
      s.location_id === target.location_id &&
      s.shift_type_id === target.shift_type_id &&
      s.starts_at === target.starts_at &&
      s.ends_at === target.ends_at &&
      s.status !== 'cancelled',
  );
}

/*
 * `computeWarnings` used to live here. It grouped shifts and reported only the
 * unfilled ones, which meant the builder's Warnings tab stayed silent while a
 * person was rostered twice in the same hour. It has been deleted rather than
 * deprecated so nothing can quietly bind to it again, `computeRotaInsights`
 * in `@/lib/rotaInsights` is the single source of rota warnings, and it covers
 * open shifts alongside clashes, rest breaches, leave and availability.
 */

/** Short badge from a real job title ("Senior Nurse" → "SN"), never an invented code. */
export function jobTitleInitials(jobTitle: string | null): string | null {
  if (!jobTitle) return null;
  const initials = jobTitle
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase())
    .join('');
  return initials.slice(0, 3) || null;
}
