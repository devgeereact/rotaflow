import { format } from 'date-fns';
import type { Availability } from '@/types';

/** Monday-first display order; the schema itself stores `weekday` in
 * Postgres/`Date.getDay()` convention (0 = Sunday). See `rotaInsights.ts`'s
 * note on the same convention for the same reason: the seed and this table
 * both write it that way. */
const DISPLAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DISPLAY_LABELS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export interface WeeklyPatternDay {
  weekday: number;
  label: string;
  /** No explicit entry defaults to available: a blank pattern is not a
   * constraint, and treating it as unavailable would silently take every
   * new starter off the rota until they fill this screen in. */
  available: boolean;
  note: string | null;
  /** The recurring entry driving this row, if one exists. Toggling this row
   * deletes it (reverting to the "available all day" default); toggling an
   * available row with no entry creates a new unavailable one. */
  entryId: string | null;
}

function noteForTimes(startTime: string | null, endTime: string | null): string | null {
  if (startTime && endTime) return `${startTime.slice(0, 5)}, ${endTime.slice(0, 5)}`;
  if (startTime) return `From ${startTime.slice(0, 5)}`;
  if (endTime) return `Until ${endTime.slice(0, 5)}`;
  return null;
}

/** The standing weekly pattern (`docs/ORGANISATION_WORKSPACE.html`'s "Your
 * weekly pattern" card), Monday first, one row per day regardless of
 * whether that day has an entry. */
export function buildWeeklyPattern(entries: Availability[]): WeeklyPatternDay[] {
  const recurringByWeekday = new Map<number, Availability>();
  for (const entry of entries) {
    if (entry.recurring && entry.weekday !== null) {
      recurringByWeekday.set(entry.weekday, entry);
    }
  }

  return DISPLAY_ORDER.map((weekday, i) => {
    const entry = recurringByWeekday.get(weekday) ?? null;
    if (!entry) {
      return {
        weekday,
        label: DISPLAY_LABELS[i]!,
        available: true,
        note: null,
        entryId: null,
      };
    }
    const isUnavailable = entry.status === 'unavailable';
    return {
      weekday,
      label: DISPLAY_LABELS[i]!,
      available: !isUnavailable,
      note: isUnavailable ? null : noteForTimes(entry.start_time, entry.end_time),
      entryId: entry.id,
    };
  });
}

export interface ExceptionRow {
  id: string;
  date: string;
  dateLabel: string;
  availabilityLabel: string;
}

function availabilityLabel(entry: Availability): string {
  if (entry.status === 'unavailable') return 'Unavailable all day';
  if (entry.start_time && !entry.end_time)
    return `Available from ${entry.start_time.slice(0, 5)}`;
  if (entry.start_time && entry.end_time) {
    return `Available ${entry.start_time.slice(0, 5)}, ${entry.end_time.slice(0, 5)}`;
  }
  return 'Available all day';
}

/** One-off dated overrides (`docs/ORGANISATION_WORKSPACE.html`'s
 * "Exceptions" card), soonest first. */
export function buildExceptions(entries: Availability[]): ExceptionRow[] {
  return entries
    .filter((e): e is Availability & { date: string } => !e.recurring && e.date !== null)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((entry) => ({
      id: entry.id,
      date: entry.date,
      dateLabel: format(new Date(`${entry.date}T00:00:00`), 'd MMM yyyy'),
      availabilityLabel: availabilityLabel(entry),
    }));
}

export interface TeamAvailabilityRow {
  staffId: string;
  available: boolean;
}

/**
 * Each person's effective availability for one specific date
 * (`docs/ORGANISATION_WORKSPACE.html`'s "Team availability, {day}" card,
 * made real: the reference hardcodes one demo day and one demo exception,
 * this resolves every staff member's actual state for it). A dated
 * exception for `dateIso` wins over the recurring weekday pattern; no entry
 * at all defaults to available, same as `buildWeeklyPattern`.
 */
export function resolveTeamAvailabilityForDate(
  staffIds: string[],
  allEntries: Availability[],
  dateIso: string,
  weekday: number,
): TeamAvailabilityRow[] {
  const byStaff = new Map<string, Availability[]>();
  for (const entry of allEntries) {
    const list = byStaff.get(entry.staff_profile_id) ?? [];
    list.push(entry);
    byStaff.set(entry.staff_profile_id, list);
  }

  return staffIds.map((staffId) => {
    const entries = byStaff.get(staffId) ?? [];
    const exception = entries.find((e) => !e.recurring && e.date === dateIso);
    if (exception) return { staffId, available: exception.status !== 'unavailable' };
    const recurring = entries.find((e) => e.recurring && e.weekday === weekday);
    if (recurring) return { staffId, available: recurring.status !== 'unavailable' };
    return { staffId, available: true };
  });
}
