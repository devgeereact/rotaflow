import { supabase } from '@/lib/supabase';
import type { LeaveRequest, LeaveRequestInsert } from '@/types';

/**
 * The insert path predates its screen (Phase 4) — useSyncQueue needed a real
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

/** One person's requests, newest first — their own history. */
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

/** Every request across the org — manager approval queue. */
export async function listOrgLeaveRequests(orgId: string): Promise<LeaveRequest[]> {
  const { data, error } = await supabase
    .from('leave_requests')
    .select('*')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Manager approve/reject. RLS (has_org_role) is the real enforcement. */
export async function reviewLeaveRequest(
  id: string,
  status: 'approved' | 'rejected',
  reviewedBy: string,
): Promise<LeaveRequest> {
  const { data, error } = await supabase
    .from('leave_requests')
    .update({ status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** Staff withdrawing their own still-pending request. */
export async function cancelLeaveRequest(id: string): Promise<void> {
  const { error } = await supabase
    .from('leave_requests')
    .update({ status: 'cancelled' })
    .eq('id', id);
  if (error) throw error;
}

/**
 * Approved leave days used within [fromDate, toDate) — for the entitlement
 * summary against `staff_profiles.holiday_allowance`. Counts inclusive
 * calendar days per request (end_date - start_date + 1), not working days:
 * the schema has no working-pattern data to exclude weekends/off-days
 * correctly, so a coarser count is honest where a precise one would be a
 * guess dressed up as precision.
 */
export function sumApprovedLeaveDays(
  requests: LeaveRequest[],
  fromDate: string,
  toDate: string,
): number {
  return requests
    .filter(
      (r) => r.status === 'approved' && r.start_date < toDate && r.end_date >= fromDate,
    )
    .reduce((total, r) => {
      const start = new Date(r.start_date).getTime();
      const end = new Date(r.end_date).getTime();
      const days = Math.round((end - start) / 86_400_000) + 1;
      return total + Math.max(0, days);
    }, 0);
}
