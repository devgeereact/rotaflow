import { supabase } from '@/lib/supabase';
import type { OvertimeRequest, OvertimeRequestInsert } from '@/types';

/**
 * `overtime_requests` reader/writer.
 *
 * The table has existed since migration 0001 and carried no service at all,
 * audit01 P2-7, and NEW_STRUCTURE §34's `/app/overtime` had nothing behind it.
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
 * Manager approve/reject.
 *
 * RLS (`has_org_role`) is the real enforcement. This only records the
 * decision. `reviewed_by` takes the reviewer's **user id**, matching
 * `reviewLeaveRequest`, because the column FKs `profiles`.
 */
export async function reviewOvertimeRequest(
  id: string,
  status: 'approved' | 'rejected',
  reviewedBy: string,
): Promise<OvertimeRequest> {
  const { data, error } = await supabase
    .from('overtime_requests')
    .update({ status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** Staff withdrawing their own still-pending request. */
export async function cancelOvertimeRequest(id: string): Promise<void> {
  const { error } = await supabase
    .from('overtime_requests')
    .update({ status: 'cancelled' })
    .eq('id', id);
  if (error) throw error;
}
