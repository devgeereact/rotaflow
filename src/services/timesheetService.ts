import { supabase } from '@/lib/supabase';
import type { Database } from '@/types/database.types';

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
  const { data, error } = await supabase
    .from('timesheets')
    .select('*')
    .eq('org_id', orgId)
    .eq('period_start', periodStart)
    .eq('period_end', periodEnd);
  if (error) throw error;
  return data ?? [];
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

  const { data, error } = await supabase.rpc('approve_timesheets', {
    p_org: orgId,
    p_period_start: periodStart,
    p_period_end: periodEnd,
    p_approvals: approvals.map((a) => ({
      staff_profile_id: a.staffProfileId,
      total_minutes: a.totalMinutes,
    })),
  });
  if (error) throw error;
  return data ?? [];
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
  const { data, error } = await supabase
    .from('timesheets')
    .update({ status: 'open', updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}
