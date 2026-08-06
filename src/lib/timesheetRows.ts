/**
 * View model for the timesheets screen (design/Timesheets-Dashboard.png).
 *
 * The table is presentational. It renders pre-formatted strings and never
 * touches a Date, a timezone or a Supabase row. Everything real is computed by
 * the page from `clock_events` (see `src/lib/hours.ts`) and mapped into these
 * shapes, so the live page and the design preview feed the same components.
 */

export type TimesheetStatus =
  'pending' | 'submitted' | 'approved' | 'rejected' | 'cancelled';

export interface TimesheetRow {
  id: string;
  firstName: string;
  lastName: string;
  jobTitle: string | null;
  photoUrl: string | null;
  /** Pre-formatted, e.g. "26 May-1 Jun 2025". */
  weekLabel: string;
  shifts: number;
  /** Two-decimal hour strings. The reference aligns them as decimal hours. */
  regularHours: string;
  overtimeHours: string;
  /** `null` where the org has no double-time rule to compute against. */
  doubleTimeHours: string | null;
  totalHours: string;
  /** `null` where no pay rate exists to cost the hours with. */
  totalCost: string | null;
  status: TimesheetStatus;
}

export interface TimesheetStatusCount {
  status: TimesheetStatus;
  label: string;
  count: number;
}

/** Decimal hours to the two-place string the reference shows ("32.00"). */
export function decimalHours(minutes: number): string {
  return (minutes / 60).toFixed(2);
}

/**
 * Split worked minutes into regular and overtime against a person's contracted
 * week.
 *
 * `staff_profiles.weekly_hours` is the only contracted-hours figure in the
 * schema, so it is the threshold. With no contract on file everything counts as
 * regular. Inventing a default (37.5? 40?) would silently mis-state someone's
 * overtime, which is a payroll error, not a display bug.
 */
export function splitOvertime(
  workedMinutes: number,
  weeklyHours: number | null,
): { regular: number; overtime: number } {
  if (weeklyHours === null) return { regular: workedMinutes, overtime: 0 };
  const threshold = weeklyHours * 60;
  return {
    regular: Math.min(workedMinutes, threshold),
    overtime: Math.max(0, workedMinutes - threshold),
  };
}

/** Counts per status, in the order the reference's donut and legend use. */
export function countByStatus(rows: TimesheetRow[]): TimesheetStatusCount[] {
  const order: { status: TimesheetStatus; label: string }[] = [
    { status: 'pending', label: 'Pending Approval' },
    { status: 'submitted', label: 'Submitted' },
    { status: 'approved', label: 'Approved' },
    { status: 'rejected', label: 'Rejected' },
    { status: 'cancelled', label: 'Cancelled' },
  ];
  return order.map(({ status, label }) => ({
    status,
    label,
    count: rows.filter((row) => row.status === status).length,
  }));
}
