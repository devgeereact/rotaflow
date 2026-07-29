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
export function parseCellId(id: string): { staffProfileId: string | null; date: string } | null {
  if (!id.startsWith('cell:')) return null;
  const [staffPart, date] = id.slice('cell:'.length).split('::');
  if (!staffPart || !date) return null;
  return { staffProfileId: staffPart === UNASSIGNED_KEY ? null : staffPart, date };
}

/** Groups shifts by staff+date cell for O(1) grid lookups. */
export function buildShiftMap(shifts: Shift[], timezone: string): Map<string, Shift[]> {
  const map = new Map<string, Shift[]>();
  for (const shift of shifts) {
    const localDate = format(toZonedTime(new Date(shift.starts_at), timezone), 'yyyy-MM-dd');
    const key = shiftCellKey(shift.staff_profile_id, localDate);
    map.set(key, [...(map.get(key) ?? []), shift]);
  }
  return map;
}

/**
 * Converts a local date + time *in the given location's timezone* to a
 * correct UTC ISO timestamp. RULES.md §9: shift times display in the
 * location's timezone — never the browser's local zone.
 */
export function toIsoInTimezone(date: string, time: string, timezone: string): string {
  return fromZonedTime(`${date}T${time}:00`, timezone).toISOString();
}

/**
 * Start/end ISO timestamps for a shift on `date`, handling shifts that cross
 * midnight (e.g. a 22:00–06:00 night shift) by rolling the end date forward
 * a day when endTime is earlier than startTime.
 */
export function computeShiftIsoRange(
  date: string,
  startTime: string,
  endTime: string,
  timezone: string,
): { startsAt: string; endsAt: string } {
  const startsAt = toIsoInTimezone(date, startTime, timezone);
  const crossesMidnight = endTime <= startTime;
  const endDate = crossesMidnight
    ? format(addDays(new Date(`${date}T00:00:00`), 1), 'yyyy-MM-dd')
    : date;
  const endsAt = toIsoInTimezone(endDate, endTime, timezone);
  return { startsAt, endsAt };
}

/** Inverse of toIsoInTimezone — for pre-filling an edit form from a stored shift. */
export function fromIsoInTimezone(
  iso: string,
  timezone: string,
): { date: string; time: string } {
  const zoned = toZonedTime(new Date(iso), timezone);
  return { date: format(zoned, 'yyyy-MM-dd'), time: format(zoned, 'HH:mm') };
}

export function formatWeekLabel(weekStartIso: string): string {
  return format(new Date(`${weekStartIso}T00:00:00`), 'd MMMM yyyy');
}

export function formatDayLabel(dateIso: string): { weekday: string; day: string } {
  const d = new Date(`${dateIso}T00:00:00`);
  return { weekday: format(d, 'EEE'), day: format(d, 'd MMM') };
}

/** Total scheduled minutes across shifts (an honest, schema-backed summary — no fabricated coverage %). */
export function totalScheduledMinutes(shifts: Shift[]): number {
  return shifts.reduce((total, s) => {
    const ms = new Date(s.ends_at).getTime() - new Date(s.starts_at).getTime();
    return total + Math.max(0, ms / 60000) - s.break_minutes;
  }, 0);
}

export function unfilledShiftCount(shifts: Shift[]): number {
  return shifts.filter((s) => !s.staff_profile_id).length;
}
