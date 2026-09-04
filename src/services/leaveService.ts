import { supabase } from '@/lib/supabase';
import type { LeaveRequest, LeaveRequestInsert } from '@/types';

/**
 * The insert path predates its screen (Phase 4). UseSyncQueue needed a real
 * target to replay a queued 'leave' item against. This phase adds the reads
 * and the approve/reject actions the screen itself needs.
 */
export async function createLeaveRequest(
  input: LeaveRequestInsert,
): Promise<LeaveRequest> {
  const { data, error } = await supabase
    .from('leave_requests')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** One person's requests, newest first. Their own history. */
export async function listMyLeaveRequests(
  staffProfileId: string,
): Promise<LeaveRequest[]> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('staff_profile_id', staffProfileId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Every request across the org. Manager approval queue. */
export async function listOrgLeaveRequests(orgId: string): Promise<LeaveRequest[]> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Count only, for the sidebar's Leave badge. `head: true` skips the row
 * payload entirely, this runs on every `/app/*` page load. RLS already scopes
 * a staff caller to their own rows, so the same query reads as "your pending
 * requests" for staff and "the approval queue" for a manager.
 */
export async function countPendingLeaveRequests(orgId: string): Promise<number> {
  const { count, error } = await supabase
    .from('leave_requests')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .eq('status', 'pending');
  if (error) throw error;
  return count ?? 0;
}

/** Manager approve/reject. RLS (has_org_role) is the real enforcement. */
/**
 * Approve or decline a leave request.
 *
 * Returns `null` when the request was no longer pending — someone else decided
 * it between this manager loading the queue and clicking.
 *
 * The `status = 'pending'` predicate is the whole fix for BUG-061, and it is a
 * real one rather than a client-side check: Postgres locks the row and
 * re-evaluates the WHERE clause during the UPDATE, so of two managers racing on
 * the same request exactly one updates a row and the other updates none. Before
 * this, both succeeded and the second silently overwrote the first's decision,
 * `reviewed_by` and all — so the audit trail named the wrong person.
 *
 * Guarding on `pending` matches what the UI offers: `LeaveRowsTable` renders
 * Approve/Decline only on a pending row, so this refuses nothing a manager is
 * allowed to do.
 */
export async function reviewLeaveRequest(
  id: string,
  status: 'approved' | 'rejected',
  reviewedBy: string,
): Promise<LeaveRequest | null> {
  const { data, error } = await supabase
    .from('leave_requests')
    .update({ status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}

/**
 * Staff withdrawing their own still-pending request.
 *
 * Returns null when it was already decided by the time this landed — the
 * same compare-and-set as `reviewLeaveRequest` above, and for the mirror
 * image of the same race. Without the predicate a withdraw issued while a
 * manager was approving would overwrite the approval, leaving a row that is
 * `cancelled` and carries a `reviewed_by`, and the manager would never learn
 * the leave they granted had gone.
 *
 * Guarding on `pending` refuses nothing the UI offers: `LeaveRowsTable:145`
 * renders Withdraw only on a pending row.
 */
export async function cancelLeaveRequest(id: string): Promise<LeaveRequest | null> {
  const { data, error } = await supabase
    .from('leave_requests')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('status', 'pending')
    .select('*')
    .maybeSingle();
  if (error) throw error;
  return data;
}
