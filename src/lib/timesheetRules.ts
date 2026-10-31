/**
 * Timesheet flags and the payroll export, browser side (R2 slice S13). Pure: no imports but
 * `zonedTime`, no I/O.
 *
 * The flags themselves are computed on the server (`backend/src/TimesheetRules.php`), in the
 * existing `GET timesheets` response, so the browser never decides what is late or over. This
 * file only turns them into chips, checks an export range before asking, and mirrors the
 * server's integer hours so a total on screen reads exactly as it will in the CSV. Mirrored
 * cases: `src/lib/timesheetRules.test.ts` and `backend/tests/suites/255-timesheet-rules.php`.
 */
import { daysBetween } from '@/lib/zonedTime';

export const TIMESHEET_MAX_DAYS = 31;
export const DEFAULT_TOLERANCE_MINUTES = 10;
export const MAX_TOLERANCE_MINUTES = 120;

export interface TimesheetLineFlags {
  late: boolean;
  early_finish: boolean;
  overtime: boolean;
  no_clock_in: boolean;
  missing_clock_out: boolean;
}

/** One line as the server sends it (a shift with a staff record, next to its clock events). */
export interface TimesheetLine {
  shift_id: string;
  staff_profile_id: string;
  location_id: string | null;
  scheduled_start: string;
  scheduled_end: string;
  break_minutes: number;
  clock_in: string | null;
  clock_out: string | null;
  scheduled_minutes: number;
  recorded_minutes: number | null;
  variance_minutes: number | null;
  late_minutes: number;
  early_minutes: number;
  finished: boolean;
  flags: TimesheetLineFlags;
}

export interface FlagChip {
  key: 'late' | 'early_finish' | 'overtime';
  label: string;
  tone: 'warning';
}

/**
 * The chips shown beside a line, in a fixed order: late, early finish, overtime. "No clock-in"
 * and "No clock-out" are not chips because the row's status already says so.
 */
export function flagChips(line: TimesheetLine): FlagChip[] {
  const chips: FlagChip[] = [];
  if (line.flags.late) {
    chips.push({ key: 'late', label: `Late ${line.late_minutes} min`, tone: 'warning' });
  }
  if (line.flags.early_finish) {
    chips.push({
      key: 'early_finish',
      label: `Early finish ${line.early_minutes} min`,
      tone: 'warning',
    });
  }
  if (line.flags.overtime && line.variance_minutes !== null) {
    chips.push({
      key: 'overtime',
      label: `Overtime ${line.variance_minutes} min`,
      tone: 'warning',
    });
  }
  return chips;
}

/** Chips by shift id, for the table. */
export function chipsByShift(lines: readonly TimesheetLine[]): Map<string, FlagChip[]> {
  return new Map(lines.map((l) => [l.shift_id, flagChips(l)]));
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;

function realDate(d: string): boolean {
  if (!DATE.test(d)) return false;
  const [y = 0, m = 0, day = 0] = d.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, day));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
}

/** null when the export range is valid; otherwise the sentence to show (same rule as the server). */
export function exportRangeProblem(from: string, to: string): string | null {
  if (!realDate(from) || !realDate(to)) return 'Choose a start and end date.';
  const days = daysBetween(from, to) + 1;
  if (days < 1) return 'The end date must be on or after the start date.';
  if (days > TIMESHEET_MAX_DAYS) return `Choose at most ${TIMESHEET_MAX_DAYS} days.`;
  return null;
}

/** The download's file name. */
export function payrollFilename(from: string, to: string): string {
  return `rotaflow-payroll-${from}-to-${to}.csv`;
}

/** Minutes as decimal hours with two places, by integer rounding (half up), exactly as the CSV. */
export function payrollHours(minutes: number): string {
  const whole = Math.trunc(minutes);
  const hundredths = Math.floor((Math.abs(whole) * 100 + 30) / 60);
  const sign = whole < 0 && hundredths > 0 ? '-' : '';
  return `${sign}${Math.floor(hundredths / 100)}.${String(hundredths % 100).padStart(2, '0')}`;
}

/** The tolerance an organisation set, or 10. Whole minutes 0 to 120, as the server reads it. */
export function toleranceFrom(settings: unknown): number {
  if (typeof settings !== 'object' || settings === null || Array.isArray(settings)) {
    return DEFAULT_TOLERANCE_MINUTES;
  }
  const v = (settings as Record<string, unknown>).timesheet_tolerance_minutes;
  return typeof v === 'number' &&
    Number.isInteger(v) &&
    v >= 0 &&
    v <= MAX_TOLERANCE_MINUTES
    ? v
    : DEFAULT_TOLERANCE_MINUTES;
}
