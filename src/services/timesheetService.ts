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
 * Approve a period for several people at once.
 *
 * There is no unique constraint on (org, staff, period). See
 * `0002_rotaflow.sql`, so this cannot be a plain `upsert`. It reads what
 * already exists for the period and splits the work into one update per known
 * row and a single insert for the rest, which also keeps a re-approval
 * idempotent instead of accumulating duplicate sign-offs for the same week.
 */
export async function approveTimesheets(
  orgId: string,
  periodStart: string,
  periodEnd: string,
  approvals: TimesheetApproval[],
): Promise<Timesheet[]> {
  if (approvals.length === 0) return [];

  const existing = await listTimesheets(orgId, periodStart, periodEnd);
  const existingByStaff = new Map(existing.map((row) => [row.staff_profile_id, row]));

  const toInsert = approvals.filter((a) => !existingByStaff.has(a.staffProfileId));
  const toUpdate = approvals.filter((a) => existingByStaff.has(a.staffProfileId));

  const results: Timesheet[] = [];

  if (toInsert.length > 0) {
    const { data, error } = await supabase
      .from('timesheets')
      .insert(
        toInsert.map((a) => ({
          org_id: orgId,
          staff_profile_id: a.staffProfileId,
          period_start: periodStart,
          period_end: periodEnd,
          total_minutes: a.totalMinutes,
          status: 'approved' as const,
        })),
      )
      .select('*');
    if (error) throw error;
    results.push(...(data ?? []));
  }

  for (const approval of toUpdate) {
    const row = existingByStaff.get(approval.staffProfileId);
    if (!row) continue;
    const { data, error } = await supabase
      .from('timesheets')
      .update({
        status: 'approved',
        total_minutes: approval.totalMinutes,
        updated_at: new Date().toISOString(),
      })
      .eq('id', row.id)
      .select('*')
      .single();
    if (error) throw error;
    results.push(data);
  }

  return results;
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
