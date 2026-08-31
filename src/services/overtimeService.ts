import { supabase } from '@/lib/supabase';
import type { OvertimeRequest, OvertimeRequestInsert } from '@/types';

/**
 * `overtime_requests` reader/writer.
 *
 * The table has existed since migration 0001 and carried no service at all,
 * the 2026-08-04 audit (now `docs/SAAS.md`) P2-7, and NEW_STRUCTURE §34's `/app/overtime` had nothing behind it.
 * Staff could not offer overtime and managers could not allocate it, so the
 * hours a rota actually costs beyond contract were invisible outside the
 * timesheet totals.
 *
 * Shaped deliberately like `leaveService`: the two are the same workflow,
 * a person asks, a manager decides, the decision is stamped with who and when.
 * Matching them means the pages, the status vocabulary and the RLS story stay
 * recognisable rather than each request type inventing its own.
 */

/** One person's own requests. The staff view. */
export async function listMyOvertimeRequests(
  staffProfileId: string,
): Promise<OvertimeRequest[]> {
  const { data, error } = await supabase
    .from('overtime_requests')
    .select('*')
    .eq('staff_profile_id', staffProfileId)
    .order('date', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Every request across the org. The manager approval queue. */
export async function listOrgOvertimeRequests(orgId: string): Promise<OvertimeRequest[]> {
  const { data, error } = await supabase
    .from('overtime_requests')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createOvertimeRequest(
  input: OvertimeRequestInsert,
): Promise<OvertimeRequest> {
  const { data, error } = await supabase
    .from('overtime_requests')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Manager approve/reject. Returns `null` when the claim was already decided
 * or withdrawn by the time this landed (BUG-061).
 *
 * RLS (`has_org_role`) is the real enforcement. This only records the
 * decision. `reviewed_by` takes the reviewer's **user id**, matching
 * `reviewLeaveRequest`, because the column FKs `profiles`.
 *
 * The `status = 'pending'` predicate makes the decision atomic: Postgres
 * re-evaluates the WHERE clause under the row lock, so two managers racing
 * produce one update and one no-op instead of the second silently overwriting
 * the first's `reviewed_by`. It also loses to a withdrawal, which is the
 * behaviour a staff member expects from a button labelled Withdraw. Overtime
 * carries this further than leave or swaps do — an approval is what sends the
 * hours to payroll.
 */
export async function reviewOvertimeRequest(
  id: string,
  status: 'approved' | 'rejected',
  reviewedBy: string,
): Promise<OvertimeRequest | null> {
  const { data, error } = await supabase
    .from('overtime_requests')
    .update({ status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Staff withdrawing their own still-pending claim. Returns false when it was
 * no longer pending — the same guard from the other side, so a withdrawal that
 * arrives after a manager's decision cannot silently un-approve hours that
 * have already gone to payroll. Until now the doc comment above was the only
 * thing that said "still-pending"; nothing enforced it.
 */
export async function cancelOvertimeRequest(id: string): Promise<boolean> {
  const { data, error } = await supabase
    .from('overtime_requests')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return data !== null;
}

export interface OvertimeEvidence {
  /** Paid minutes the person was rostered for that day, net of breaks. */
  scheduledMinutes: number;
  /** Minutes between paired clock in/out events on that day. */
  workedMinutes: number;
  /** `in` events with no `out` after them — the forgotten clock-out. */
  unpairedEvents: number;
}

/**
 * What the clock recorded against what was scheduled, for one person on one
 * day (CAP-087, `0097`).
 *
 * `overtime_requests.hours` is a number somebody types, and until now nothing
 * compared it to anything — while the row goes to payroll.
 *
 * This deliberately does NOT replace the typed number. Clock data is least
 * complete exactly when overtime happens: the carer who stays late to cover an
 * incident is the one most likely to forget to clock out. A derived figure
 * would be the authoritative-looking wrong answer. What an approver gets is
 * something to judge against, including the freedom to approve a claim the
 * clock does not support — which is a real and legitimate case.
 *
 * Returns null if the evidence cannot be read. The claim is still reviewable;
 * an approval screen that breaks because a supporting query failed would be a
 * worse outcome than one without the extra context.
 */
export async function getOvertimeEvidence(
  orgId: string,
  staffProfileId: string,
  date: string,
): Promise<OvertimeEvidence | null> {
  const { data, error } = await supabase
    .rpc('overtime_evidence', {
      p_org: orgId,
      p_staff: staffProfileId,
      p_date: date,
    })
    .maybeSingle();
  if (error || !data) return null;
  return {
    scheduledMinutes: data.scheduled_minutes ?? 0,
    workedMinutes: data.worked_minutes ?? 0,
    unpairedEvents: data.unpaired_events ?? 0,
  };
}
