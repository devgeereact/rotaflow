import { activeOrgPath, api, orgPath, seg } from '@/lib/api';
import type { Database } from '@/types/database.types';
import { downloadBlob } from '@/lib/csv';
import {
  DEFAULT_TOLERANCE_MINUTES,
  payrollFilename,
  type TimesheetLine,
} from '@/lib/timesheetRules';

export type Timesheet = Database['public']['Tables']['timesheets']['Row'];
export type TimesheetStatus = Timesheet['status'];

/**
 * The `timesheets` table, which had no reader and no writer in the whole
 * application until now (the 2026-08-04 audit (now `docs/SAAS.md`) P2-7 flagged the same shape for
 * `overtime_requests`; `shift_templates` was dropped in 0096).
 *
 * ## Why the screen worked without it
 *
 * `/app/timesheets` derives hours from `clock_events` on every render, that
 * is the honest source and it stays the source. What the table adds is the
 * thing derivation cannot express: a *decision*. "This period's hours are
 * agreed and may be paid" is a manager's act, not a calculation, and it has to
 * survive a later clock-event correction rather than silently recompute.
 *
 * So a row here is a sign-off record, and `total_minutes` is a snapshot of
 * what was agreed at the moment of approval. Deliberately not kept in sync
 * with the derived figure afterwards. If the two later disagree, that is a
 * fact worth seeing, not a bug to paper over.
 */

/** Sign-off rows covering a period. Keyed by staff profile for the caller. */
export async function listTimesheets(
  orgId: string,
  periodStart: string,
  periodEnd: string,
): Promise<Timesheet[]> {
  const r = await api.get<{ timesheets: Timesheet[] }>(orgPath(orgId, '/timesheets'), {
    period_start: periodStart,
    period_end: periodEnd,
  });
  return r.timesheets.filter(
    (t) => t.period_start === periodStart && t.period_end === periodEnd,
  );
}

export interface TimesheetApproval {
  staffProfileId: string;
  totalMinutes: number;
}

/**
 * Approve a period for several people at once, in one transaction.
 *
 * RF-07. This used to read the rows that already existed, insert the ones
 * that did not and update the ones that did — a read-then-write with nothing
 * holding it together. Two managers approving the same week both read "no row
 * yet" and both inserted, and the table had no unique key to stop them: the
 * audit reproduced two `approved` rows for one person and one week, saying 480
 * and 420 minutes, with no error raised. Whichever `listTimesheets` returned
 * first was the one payroll saw.
 *
 * The inserts also went in one statement and the updates in a loop of separate
 * ones, so a failure part way through a twenty-person batch signed some people
 * off and not others, and the manager was shown a single error with no way to
 * tell which was which.
 *
 * `approve_timesheets` (0124) does the whole batch inside one statement,
 * under the unique key that migration adds, and records the approver and a
 * version count. A failure on person seventeen rolls back the first sixteen.
 */
export async function approveTimesheets(
  orgId: string,
  periodStart: string,
  periodEnd: string,
  approvals: TimesheetApproval[],
): Promise<Timesheet[]> {
  if (approvals.length === 0) return [];
  const r = await api.post<{ timesheets: Timesheet[] }>(
    orgPath(orgId, '/timesheets/approve'),
    {
      period_start: periodStart,
      period_end: periodEnd,
      approvals: approvals.map((a) => ({
        staff_profile_id: a.staffProfileId,
        total_minutes: a.totalMinutes,
      })),
    },
  );
  return r.timesheets;
}

/**
 * Send a period back to the person who worked it.
 *
 * `status` has no 'rejected' value in the CHECK, and adding one would need a
 * migration applied to production. 'open' is the correct existing state
 * anyway: a returned timesheet is one that is once again awaiting work, and
 * the manager's note travels separately. Nothing is deleted, so an approval
 * that is reversed leaves its row and its `updated_at` behind.
 */
export async function reopenTimesheet(id: string): Promise<Timesheet> {
  const r = await api.post<{ timesheet: Timesheet }>(
    activeOrgPath(`/timesheets/${seg(id)}/reopen`),
  );
  return r.timesheet;
}

/** The `timesheet_tools` feature flag (slice S13). Off, nothing below is called. */
export const TIMESHEET_FEATURE = 'timesheet_tools';

export interface TimesheetLinesResult {
  /** null when the period is longer than 31 days (the server computes no lines then). */
  lines: TimesheetLine[] | null;
  toleranceMinutes: number;
}

/**
 * The lines and their flags for a period, as the server computes them. Only meaningful with
 * the flag on: off, the server answers no `lines` and this reads as none.
 */
export async function listTimesheetLines(
  orgId: string,
  periodStart: string,
  periodEnd: string,
): Promise<TimesheetLinesResult> {
  const r = await api.get<{
    timesheets: Timesheet[];
    lines?: TimesheetLine[] | null;
    tolerance_minutes?: number;
  }>(orgPath(orgId, '/timesheets'), { period_start: periodStart, period_end: periodEnd });
  return {
    lines: r.lines ?? null,
    toleranceMinutes: r.tolerance_minutes ?? DEFAULT_TOLERANCE_MINUTES,
  };
}

/**
 * Whether a period is signed off: `approved`, or `exported` (approved and sent to payroll by
 * the marking export). Either way it is not offered for approval again.
 */
export function isSignedOff(status: TimesheetStatus): boolean {
  return status === 'approved' || status === 'exported';
}

export interface PayrollExportResult {
  /** Approved periods this export moved to `exported`. */
  marked: number;
  /** Periods in the file that had been exported before (payroll may already have them). */
  alreadyExported: number;
}

function count(v: string | null): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 0 ? n : 0;
}

/**
 * The payroll CSV of approved periods inside the range, downloaded as the server wrote it
 * (UTF-8 with a BOM, formula-safe cells; nothing is rebuilt in the browser), through the
 * marking route (owner decision, 31 Oct 2026): `POST timesheets/export` moves the approved
 * periods in the file to `exported` in the same transaction, so a second export shows them as
 * already sent instead of quietly paying them again. The counts come from the response headers.
 */
export async function exportPayrollCsv(
  orgId: string,
  periodStart: string,
  periodEnd: string,
): Promise<PayrollExportResult> {
  const file = await api.postFile(orgPath(orgId, '/timesheets/export'), {
    period_start: periodStart,
    period_end: periodEnd,
  });
  downloadBlob(file.filename ?? payrollFilename(null, periodStart, periodEnd), file.body);
  return {
    marked: count(file.header('X-RotaFlow-Marked-Exported')),
    alreadyExported: count(file.header('X-RotaFlow-Already-Exported')),
  };
}

/** What the page tells the person after a payroll export. */
export function payrollExportMessage(r: PayrollExportResult): string {
  const periods = (n: number): string => `${n} ${n === 1 ? 'period' : 'periods'}`;
  const marked =
    r.marked === 0
      ? 'Payroll CSV downloaded. No new periods were marked as exported.'
      : `Payroll CSV downloaded. ${periods(r.marked)} marked as exported.`;
  return r.alreadyExported > 0
    ? `${marked} ${periods(r.alreadyExported)} in the file had been exported before.`
    : marked;
}
