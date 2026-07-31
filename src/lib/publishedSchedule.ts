import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import type { Location, Shift, ShiftType, StaffProfile } from '@/types';

/**
 * View model for the published-schedule grid (design/published-schedule.png,
 * design/live-schedule.png, design/Schedule-dashboard.png).
 *
 * The grid is presentational: it renders rows of pre-formatted chips and never
 * touches a timezone, a Date or a Supabase row. Everything below turns real
 * `shifts` into that shape, so the live `/app/schedule` page and the design
 * preview page feed the identical component.
 */

export interface ScheduleChip {
  id: string;
  /** 'HH:mm' in the location's timezone — already converted. */
  startTime: string;
  endTime: string;
  /** Shift-type name, e.g. "Morning". */
  label: string;
  /** Shift-type colour, matched against SHIFT_PALETTE for the chip tint. */
  colour: string | null;
  /** No one is assigned to this slot yet. */
  unfilled: boolean;
  /** The assigned person has acknowledged the shift (live-schedule.png tick). */
  confirmed: boolean;
}

export interface ScheduleRow {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  photoUrl: string | null;
  /** Chips keyed by 'YYYY-MM-DD'. A missing key renders as a day off. */
  cells: Record<string, ScheduleChip[]>;
}

export interface ScheduleLocationGroup {
  id: string;
  name: string;
  staffCount: number;
  rows: ScheduleRow[];
}

/** Per-day counts, shown in the column header and again in the totals footer. */
export interface ScheduleDayTotal {
  date: string;
  staff: number;
  shifts: number;
  /** Filled slots ÷ all slots, 0–100. `null` when the day has no shifts at all. */
  coverage: number | null;
}

function localDate(iso: string, timezone: string): string {
  return format(toZonedTime(new Date(iso), timezone), 'yyyy-MM-dd');
}

function localTime(iso: string, timezone: string): string {
  return format(toZonedTime(new Date(iso), timezone), 'HH:mm');
}

function toChip(
  shift: Shift,
  type: ShiftType | undefined,
  timezone: string,
): ScheduleChip {
  return {
    id: shift.id,
    startTime: localTime(shift.starts_at, timezone),
    endTime: localTime(shift.ends_at, timezone),
    label: type?.name ?? 'Shift',
    colour: shift.colour ?? type?.colour ?? null,
    unfilled: shift.staff_profile_id === null,
    confirmed: shift.status === 'confirmed',
  };
}

/**
 * Group published shifts by location, then by the staff actually rostered
 * there this period.
 *
 * `staff_profiles` has no location column, so a home location would be
 * invented — someone working two sites correctly appears under both.
 */
export function buildScheduleGroups(input: {
  shifts: Shift[];
  staff: StaffProfile[];
  locations: Location[];
  shiftTypes: ShiftType[];
  fallbackTimezone: string;
}): ScheduleLocationGroup[] {
  const { shifts, staff, locations, shiftTypes, fallbackTimezone } = input;
  const staffById = new Map(staff.map((s) => [s.id, s]));
  const typeById = new Map(shiftTypes.map((t) => [t.id, t]));
  const locationById = new Map(locations.map((l) => [l.id, l]));

  const byLocation = new Map<string, Map<string, ScheduleRow>>();

  for (const shift of shifts) {
    if (!shift.staff_profile_id) continue;
    const person = staffById.get(shift.staff_profile_id);
    if (!person) continue;

    const locationId = shift.location_id ?? 'unassigned';
    const timezone = locationById.get(locationId)?.timezone ?? fallbackTimezone;
    const rows = byLocation.get(locationId) ?? new Map<string, ScheduleRow>();
    const row = rows.get(person.id) ?? {
      id: person.id,
      firstName: person.first_name,
      lastName: person.last_name,
      jobTitle: person.job_title,
      photoUrl: person.photo_url,
      cells: {},
    };

    const date = localDate(shift.starts_at, timezone);
    row.cells[date] = [
      ...(row.cells[date] ?? []),
      toChip(
        shift,
        shift.shift_type_id ? typeById.get(shift.shift_type_id) : undefined,
        timezone,
      ),
    ];
    rows.set(person.id, row);
    byLocation.set(locationId, rows);
  }

  return [...byLocation.entries()]
    .map(([locationId, rows]) => {
      const ordered = [...rows.values()].sort((a, b) =>
        a.lastName.localeCompare(b.lastName),
      );
      return {
        id: locationId,
        name: locationById.get(locationId)?.name ?? 'No location',
        staffCount: ordered.length,
        rows: ordered,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Per-day staff/shift counts and coverage.
 *
 * Coverage is filled slots ÷ all slots for the day — a real, schema-backed
 * ratio, because an unfilled slot is a row with `staff_profile_id IS NULL`.
 * There is no required-headcount column, so nothing here compares against a
 * target (see design/.loop/rota-log.md for the same decision on the builder).
 */
export function computeScheduleTotals(
  shifts: Shift[],
  dates: string[],
  timezone: string,
): ScheduleDayTotal[] {
  const byDate = new Map<string, Shift[]>();
  for (const shift of shifts) {
    const date = localDate(shift.starts_at, timezone);
    byDate.set(date, [...(byDate.get(date) ?? []), shift]);
  }

  return dates.map((date) => {
    const day = byDate.get(date) ?? [];
    const filled = day.filter((s) => s.staff_profile_id !== null);
    const staff = new Set(filled.map((s) => s.staff_profile_id)).size;
    return {
      date,
      staff,
      shifts: day.length,
      coverage: day.length === 0 ? null : Math.round((filled.length / day.length) * 100),
    };
  });
}

/** Mean of the days that have any shifts at all — empty days would drag it to zero. */
export function averageCoverage(totals: ScheduleDayTotal[]): number | null {
  const scored = totals.filter(
    (t): t is ScheduleDayTotal & { coverage: number } => t.coverage !== null,
  );
  if (scored.length === 0) return null;
  return Math.round(scored.reduce((sum, t) => sum + t.coverage, 0) / scored.length);
}
