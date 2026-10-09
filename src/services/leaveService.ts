import { supabase } from '@/lib/supabase';
import type { LeaveRequest, LeaveRequestInsert } from '@/types';

/**
 * The insert path predates its screen (Phase 4). UseSyncQueue needed a real
 * target to replay a queued 'leave' item against. This phase adds the reads
 * and the approve/reject actions the screen itself needs.
 */

/**
 * `0152`'s exclusion constraint, said in a sentence.
 *
 * One person may hold one live booking per day (GAP-123). The database
 * refuses a second with SQLSTATE `23P01`, whose own message names an index
 * and is no use to anybody. These two replace it — one for the person
 * asking, one for the manager deciding — and are the only two ways a caller
 * meets that constraint.
 *
 * The `code` is carried onto the replacement deliberately. `classifyFailure`
 * reads it to decide whether an offline write should be retried or
 * dead-lettered, and a bare `Error` with no code falls through to its
 * `transient` default — which would queue a permanently-refused request and
 * replay it forever.
 */
const OVERLAP_ON_REQUEST =
  'Those dates overlap leave you have already asked for. Withdraw the other request first, or choose different dates.';

const OVERLAP_ON_REVIEW =
  'Approving this would double-book days this person already has off. Decline or withdraw the other request first.';

/**
 * True when the database refused this write because the days are already
 * booked, rather than because something went wrong.
 *
 * A screen needs to tell those apart: this one has a sentence worth showing
 * and is not a fault, so it is neither reported to Sentry nor hidden behind
 * "please try again", which would invite the person to retry something that
 * will be refused every time.
 */
export function isDoubleBookedLeave(error: unknown): error is Error {
  return error instanceof Error && (error as { code?: unknown }).code === '23P01';
}

function withOverlapMessage(error: unknown, message: string): unknown {
  const code = (error as { code?: unknown } | null)?.code;
  if (code !== '23P01') return error;
  return Object.assign(new Error(message), { code, cause: error });
}

export async function createLeaveRequest(
  input: LeaveRequestInsert,
): Promise<LeaveRequest> {
  const { data, error } = await supabase
    .from('leave_requests')
    .insert(input)
    .select('*')
    .single();
  if (error) throw withOverlapMessage(error, OVERLAP_ON_REQUEST);
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
  if (error) throw withOverlapMessage(error, OVERLAP_ON_REVIEW);
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
