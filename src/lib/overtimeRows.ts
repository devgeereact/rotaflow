/**
 * View model for the Overtime screen (`/app/overtime`, NEW_STRUCTURE §34).
 *
 * Same split as `leaveRows`: everything that touches a Date, a timezone or a
 * Supabase row happens here, and the components render pre-formatted strings.
 * That is what lets the logic below be unit-tested without a database, and it
 * is why this module lives in `lib` rather than `services` — importing a
 * service pulls in the Supabase client, which needs a WebSocket Node 20 does
 * not have.
 */

import { format, parseISO } from 'date-fns';
import type { OvertimeRequest, StaffProfile } from '@/types';

/**
 * `overtime_requests.status` is `text` with a CHECK constraint, not a Postgres
 * enum, so the generated type is plain `string` and this narrows it.
 *
 * The four values are exactly what the constraint permits after
 * `0014_overtime_cancelled_status.sql` — 0002 created the column allowing only
 * the first three, which would have made the Withdraw control fail.
 *
 * The fallback is defensive rather than expected: nothing can currently write
 * an unrecognised value, but a future migration widening the constraint should
 * not blank a row out of an approval queue.
 */
export type OvertimeStatus = 'pending' | 'approved' | 'rejected' | 'cancelled';

export interface OvertimeRow {
  id: string;
  staffProfileId: string;
  staffName: string;
  jobTitle: string | null;
  photoUrl: string | null;
  /** Pre-formatted, e.g. "Tue 4 Aug 2026". */
  dateLabel: string;
  /** Raw ISO date, for sorting and for the edit form. */
  date: string;
  hours: number;
  /** Pre-formatted, e.g. "2h 30m". */
  hoursLabel: string;
  status: OvertimeStatus;
  /** The muted line under the pill. `null` where nothing is recorded. */
  statusNote: string | null;
  note: string | null;
}

export function overtimeStatus(raw: string | null): OvertimeStatus {
  switch ((raw ?? '').toLowerCase()) {
    case 'approved':
      return 'approved';
    case 'rejected':
    case 'declined':
      return 'rejected';
    case 'cancelled':
    case 'canceled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

/**
 * "2h 30m", "8h", "45m".
 *
 * `hours` is numeric in the database, so a half hour arrives as 0.5. Rendering
 * that raw gives "0.5 hours" on a payroll-adjacent screen, which reads as an
 * error; minutes are what a manager approves in.
 */
export function formatOvertimeHours(hours: number): string {
  const safe = Math.max(0, hours);
  const totalMinutes = Math.round(safe * 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** "Approved by you" / "Needs approval" — never invents a reviewer's name. */
function statusNote(
  status: OvertimeStatus,
  request: OvertimeRequest,
  currentUserId: string | null,
): string | null {
  if (status === 'pending') return 'Needs approval';
  if (status === 'cancelled') return 'Withdrawn';
  const byYou = currentUserId !== null && request.reviewed_by === currentUserId;
  const verb = status === 'approved' ? 'Approved' : 'Declined';
  return byYou ? `${verb} by you` : verb;
}

export interface BuildOvertimeRowsInput {
  requests: OvertimeRequest[];
  staffById: Map<string, StaffProfile>;
  /** Signed-in user id, so "by you" is accurate. Null when unknown. */
  currentUserId: string | null;
}

/**
 * Newest date first. A request whose staff profile is missing still renders —
 * with "Unknown staff member" — rather than vanishing: a silently dropped row
 * in an approval queue is a request nobody ever answers.
 */
export function buildOvertimeRows({
  requests,
  staffById,
  currentUserId,
}: BuildOvertimeRowsInput): OvertimeRow[] {
  return [...requests]
    .sort((a, b) => b.date.localeCompare(a.date))
    .map((request) => {
      const person = staffById.get(request.staff_profile_id);
      const status = overtimeStatus(request.status);
      return {
        id: request.id,
        staffProfileId: request.staff_profile_id,
        staffName: person
          ? `${person.first_name} ${person.last_name}`
          : 'Unknown staff member',
        jobTitle: person?.job_title ?? null,
        photoUrl: person?.photo_url ?? null,
        dateLabel: format(parseISO(request.date), 'EEE d MMM yyyy'),
        date: request.date,
        hours: request.hours,
        hoursLabel: formatOvertimeHours(request.hours),
        status,
        statusNote: statusNote(status, request, currentUserId),
        note: request.note,
      };
    });
}

export interface OvertimeSummary {
  pending: number;
  approvedHours: number;
  pendingHours: number;
  /** Pre-formatted totals for the metric cards. */
  approvedHoursLabel: string;
  pendingHoursLabel: string;
}

/**
 * Totals for the metric row.
 *
 * Only approved and pending count towards hours. Rejected and withdrawn
 * requests are deliberately excluded — showing them in an hours total would
 * overstate what the organisation is committed to paying.
 */
export function summariseOvertime(rows: OvertimeRow[]): OvertimeSummary {
  const approvedHours = rows
    .filter((r) => r.status === 'approved')
    .reduce((sum, r) => sum + r.hours, 0);
  const pendingRows = rows.filter((r) => r.status === 'pending');
  const pendingHours = pendingRows.reduce((sum, r) => sum + r.hours, 0);

  return {
    pending: pendingRows.length,
    approvedHours,
    pendingHours,
    approvedHoursLabel: formatOvertimeHours(approvedHours),
    pendingHoursLabel: formatOvertimeHours(pendingHours),
  };
}
