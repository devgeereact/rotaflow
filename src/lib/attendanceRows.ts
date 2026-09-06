/**
 * View model for the Team Attendance workspace and the operational dashboard's
 * staffing tables.
 *
 * `attendance.ts` decides what is true; this decides how it reads. Keeping the
 * split means the state machine can be tested without a timezone database and
 * the formatting can be tested without inventing clock events.
 *
 * Every time on this screen is printed in the **site's** timezone, not the
 * browser's and not the organisation's, with the date shown alongside whenever
 * a row crosses local midnight. An overnight shift that reads `22:00 → 06:00`
 * with nothing to say those are different days is the single most common way a
 * night rota is misread.
 */
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import {
  ATTENDANCE_STATUS_META,
  attendanceSeverity,
  type AttendanceRow,
  type AttendanceStatus,
  type AttendanceTone,
} from '@/lib/attendance';
import { UNASSIGNED, type FilterDimension, type SortSpec } from '@/lib/filters';
import { jobTitleCode } from '@/lib/jobTitlePalette';
import type { CsvColumn } from '@/lib/csv';
import type { Department, JobTitle, Location, StaffProfile } from '@/types';

export interface AttendanceLookups {
  staffById: Map<string, StaffProfile>;
  locationById: Map<string, Location>;
  departmentById: Map<string, Department>;
  jobTitleById: Map<string, JobTitle>;
  /** Used where a row has no location of its own, e.g. an unscheduled clock-in. */
  fallbackTimezone: string;
}

export interface AttendanceViewRow {
  key: string;
  staffProfileId: string;
  shiftId: string | null;
  name: string;
  /** The catalogue title's display name, or the legacy free text, or null. */
  jobTitleName: string | null;
  /** Palette id, or null for a title with no colour and for no title at all. */
  jobTitleColour: string | null;
  /** Two-letter reading aid, so the badge is not colour alone. */
  jobTitleCode: string | null;
  locationName: string | null;
  locationId: string | null;
  departmentId: string | null;
  departmentName: string | null;
  /** The timezone every time in this row is printed in. */
  timezone: string;
  status: AttendanceStatus;
  statusLabel: string;
  statusTone: AttendanceTone;
  statusDefinition: string;
  /** "07:00 - 19:00", or "-" for an unscheduled clock-in. */
  plannedLabel: string;
  /** "06:56 - 19:41 (7 Sep)", the date only where it differs from the start's. */
  actualLabel: string;
  breakLabel: string;
  workedLabel: string;
  /** "+41m" / "-1h 05m" / "-" while a shift is still running. */
  varianceLabel: string;
  /** 'gps', 'manual', … as recorded on the clock-in. `null` when none. */
  source: string | null;
  /** A sentence naming what needs looking at, or `null` when nothing does. */
  issue: string | null;
  severity: number;
  /** Sort keys. ISO instants, or '' so a missing value sorts last consistently. */
  sortPlanned: string;
  sortActual: string;
  row: AttendanceRow;
}

function timeIn(iso: string, timezone: string): string {
  return format(toZonedTime(new Date(iso), timezone), 'HH:mm');
}

function dayIn(iso: string, timezone: string): string {
  return format(toZonedTime(new Date(iso), timezone), 'd MMM');
}

/** "07:00 - 19:00", with the end's date appended when it lands on another day. */
function rangeLabel(
  startIso: string | null,
  endIso: string | null,
  timezone: string,
  openLabel: string,
): string {
  if (!startIso) return '-';
  const start = timeIn(startIso, timezone);
  if (!endIso) return `${start} - ${openLabel}`;
  const end = timeIn(endIso, timezone);
  const sameDay = dayIn(startIso, timezone) === dayIn(endIso, timezone);
  return sameDay ? `${start} - ${end}` : `${start} - ${end} (${dayIn(endIso, timezone)})`;
}

export function formatMinutes(minutes: number): string {
  const total = Math.abs(Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  if (hours === 0) return `${rest}m`;
  return rest === 0 ? `${hours}h` : `${hours}h ${String(rest).padStart(2, '0')}m`;
}

function signedMinutes(minutes: number): string {
  if (Math.round(minutes) === 0) return 'on time';
  return `${minutes < 0 ? '-' : '+'}${formatMinutes(minutes)}`;
}

/**
 * The sentence a manager reads instead of decoding the status chip.
 *
 * `not_recorded` deliberately does not say "absent". The server cannot know
 * whether a clock-in is sitting unsynchronised on somebody's phone, so the
 * wording states what is missing rather than what happened.
 */
function issueFor(row: AttendanceRow): string | null {
  switch (row.status) {
    case 'late':
      return row.minutesLate === null
        ? 'Started with no clock-in received.'
        : `Due to start ${formatMinutes(row.minutesLate)} ago. No clock-in received.`;
    case 'missing_clock_out':
      return 'The shift has ended and the clock is still running. Needs a clock-out or a correction.';
    case 'not_recorded':
      return 'No clock events reached the server for this shift. An offline clock-in that has not synchronised looks the same from here.';
    case 'unscheduled':
      return 'Worked time that matches no rostered shift.';
    default:
      if (row.reviewReason === 'unclosed_break') {
        return 'A break was started and never ended, so it has been deducted to the end of the shift.';
      }
      if (row.reviewReason === 'missing_clock_out') {
        return 'A clock-in was superseded by a later one, so its length is unknown.';
      }
      return null;
  }
}

/**
 * The person's job title.
 *
 * Reads `job_title_id` first and falls back to the legacy `job_title` text.
 * Both are live between `0127` and the migration that retires the text column,
 * and the fallback is what keeps a client that has not yet written a catalogue
 * id from showing a blank column.
 */
export function resolveJobTitle(
  staff: StaffProfile | undefined,
  jobTitleById: Map<string, JobTitle>,
): { name: string | null; colour: string | null } {
  if (!staff) return { name: null, colour: null };
  if (staff.job_title_id) {
    const title = jobTitleById.get(staff.job_title_id);
    if (title) return { name: title.name, colour: title.colour };
  }
  return { name: staff.job_title, colour: null };
}

export function buildAttendanceViewRows(
  rows: AttendanceRow[],
  lookups: AttendanceLookups,
): AttendanceViewRow[] {
  return rows.map((row): AttendanceViewRow => {
    const staff = lookups.staffById.get(row.staffProfileId);
    const location = row.locationId
      ? lookups.locationById.get(row.locationId)
      : undefined;
    const department = row.departmentId
      ? lookups.departmentById.get(row.departmentId)
      : undefined;
    const timezone = location?.timezone ?? lookups.fallbackTimezone;
    const meta = ATTENDANCE_STATUS_META[row.status];
    const title = resolveJobTitle(staff, lookups.jobTitleById);

    return {
      key: row.key,
      staffProfileId: row.staffProfileId,
      shiftId: row.shiftId,
      name: staff ? `${staff.first_name} ${staff.last_name}` : 'Unknown person',
      jobTitleName: title.name,
      jobTitleColour: title.colour,
      jobTitleCode: title.name ? jobTitleCode(title.name) : null,
      locationName: location?.name ?? null,
      locationId: row.locationId,
      departmentId: row.departmentId,
      departmentName: department?.name ?? null,
      timezone,
      status: row.status,
      statusLabel: meta.label,
      statusTone: meta.tone,
      statusDefinition: meta.definition,
      plannedLabel: rangeLabel(row.plannedStartIso, row.plannedEndIso, timezone, '?'),
      actualLabel: rangeLabel(row.actualInIso, row.actualOutIso, timezone, 'still in'),
      breakLabel: row.breakMinutes === null ? '-' : formatMinutes(row.breakMinutes),
      workedLabel: row.workedMinutes === null ? '-' : formatMinutes(row.workedMinutes),
      varianceLabel:
        row.varianceMinutes === null ? '-' : signedMinutes(row.varianceMinutes),
      source: row.source,
      issue: issueFor(row),
      severity: attendanceSeverity(row.status),
      sortPlanned: row.plannedStartIso ?? '',
      sortActual: row.actualInIso ?? '',
      row,
    };
  });
}

/* ------------------------------------------------------------------ */
/* Filtering and sorting                                               */
/* ------------------------------------------------------------------ */

/**
 * The workspace's filter dimensions.
 *
 * Ids are the URL keys, so they are stable and short. `q` is marked sensitive:
 * it is a person search, and a link carrying a colleague's name into a support
 * ticket or a server log is a disclosure nobody asked for.
 */
export const ATTENDANCE_FILTERS: readonly FilterDimension[] = [
  { id: 'q', label: 'Search', kind: 'text', sensitive: true },
  { id: 'loc', label: 'Location', kind: 'multi' },
  { id: 'dept', label: 'Department', kind: 'multi' },
  { id: 'title', label: 'Job title', kind: 'multi' },
  { id: 'person', label: 'Person', kind: 'multi' },
  { id: 'status', label: 'Attendance status', kind: 'multi' },
] as const;

/**
 * How a row answers each dimension.
 *
 * `job title` is keyed on the catalogue id rather than the printed name, which
 * is what makes a filter survive a rename: renaming "Nurse" to "Registered
 * Nurse" changes every label on screen and no saved link.
 */
export function attendanceAccessors(
  staffById: Map<string, StaffProfile>,
): Readonly<
  Record<string, (row: AttendanceViewRow) => string | readonly string[] | null>
> {
  return {
    loc: (row) => row.locationId,
    dept: (row) => row.departmentId,
    title: (row) => staffById.get(row.staffProfileId)?.job_title_id ?? null,
    person: (row) => row.staffProfileId,
    status: (row) => row.status,
  };
}

export const ATTENDANCE_SORTS: readonly SortSpec<AttendanceViewRow>[] = [
  {
    id: 'expected',
    label: 'Expected start',
    // '' sorts before any ISO instant, so unscheduled rows would lead the
    // table ascending. They are pushed last instead: an unscheduled clock-in
    // is an exception, not the top of the day's roster.
    compare: (a, b) => (a.sortPlanned || '￿').localeCompare(b.sortPlanned || '￿'),
  },
  {
    id: 'actual',
    label: 'Actual start',
    compare: (a, b) => (a.sortActual || '￿').localeCompare(b.sortActual || '￿'),
  },
  { id: 'name', label: 'Name', compare: (a, b) => a.name.localeCompare(b.name) },
  {
    id: 'severity',
    label: 'Exception severity',
    compare: (a, b) => b.severity - a.severity,
  },
] as const;

/** Options for the status filter, in the order the statuses matter operationally. */
export function attendanceStatusOptions(): { value: string; label: string }[] {
  const order: AttendanceStatus[] = [
    'working',
    'on_break',
    'completed',
    'scheduled',
    'late',
    'missing_clock_out',
    'not_recorded',
    'unscheduled',
  ];
  return order.map((status) => ({
    value: status,
    label: ATTENDANCE_STATUS_META[status].label,
  }));
}

/** Options for a person / location / department picker, plus "Unassigned". */
export function withUnassigned(
  options: { value: string; label: string }[],
  label: string,
): { value: string; label: string }[] {
  return [...options, { value: UNASSIGNED, label }];
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

/**
 * The exported columns.
 *
 * `Date` is the planned start's local date, or the clock-in's where there is
 * no shift, so a night shift lands on the day payroll allocates it to —
 * matching `segmentsStartingWithin`, so the export and the timesheet agree.
 */
export const ATTENDANCE_CSV_COLUMNS: readonly CsvColumn<AttendanceViewRow>[] = [
  {
    label: 'Date',
    value: (r) => {
      const iso = r.row.plannedStartIso ?? r.row.actualInIso;
      return iso ? format(toZonedTime(new Date(iso), r.timezone), 'yyyy-MM-dd') : '';
    },
  },
  { label: 'Employee', value: (r) => r.name },
  { label: 'Job title', value: (r) => r.jobTitleName ?? '' },
  { label: 'Location', value: (r) => r.locationName ?? '' },
  { label: 'Department', value: (r) => r.departmentName ?? '' },
  { label: 'Timezone', value: (r) => r.timezone },
  { label: 'Planned', value: (r) => r.plannedLabel },
  { label: 'Actual', value: (r) => r.actualLabel },
  { label: 'Break', value: (r) => r.breakLabel },
  { label: 'Worked', value: (r) => r.workedLabel },
  { label: 'Variance', value: (r) => r.varianceLabel },
  { label: 'Status', value: (r) => r.statusLabel },
  { label: 'Source', value: (r) => r.source ?? '' },
  { label: 'Needs review', value: (r) => r.issue ?? '' },
] as const;
