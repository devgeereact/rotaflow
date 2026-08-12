import { supabase } from '@/lib/supabase';
import type { Shift, ShiftSwap, ShiftSwapInsert } from '@/types';

export interface ShiftSwapWithShift extends ShiftSwap {
  shift: Shift | null;
}

/**
 * The insert path predates its screen (Phase 4). UseSyncQueue needed a real
 * target to replay a queued 'swap' item against. This phase adds the reads
 * and respond/approve actions, plus 0008_shift_swaps_target_respond.sql,
 * which grants the write access the target colleague was missing.
 */
export async function requestShiftSwap(input: ShiftSwapInsert): Promise<ShiftSwap> {
  const { data, error } = await supabase
    .from('shift_swaps')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** Swaps involving one person, as requester or target, newest first. */
export async function listMyShiftSwaps(
  staffProfileId: string,
): Promise<ShiftSwapWithShift[]> {
  const { data, error } = await supabase
    .from('shift_swaps')
    .select('*, shift:shifts(*)')
    .or(`requested_by.eq.${staffProfileId},target_staff_profile_id.eq.${staffProfileId}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Every swap across the org. Manager approval queue. */
export async function listOrgShiftSwaps(orgId: string): Promise<ShiftSwapWithShift[]> {
  const { data, error } = await supabase
    .from('shift_swaps')
    .select('*, shift:shifts(*)')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Count only, for the sidebar's Shift Swaps badge. `head: true` skips the
 * shift join and row payload, this runs on every `/app/*` page load.
 * `accepted` counts too: the target has agreed, but a named-colleague swap
 * still needs the requester's own final say (`reviewShiftSwap`, 0043) and
 * an open one still needs a manager, so it is still a swap someone needs
 * to act on.
 */
export async function countSwapsNeedingAttention(orgId: string): Promise<number> {
  const { count, error } = await supabase
    .from('shift_swaps')
    .select('id', { count: 'exact', head: true })
    .eq('org_id', orgId)
    .in('status', ['pending', 'accepted']);
  if (error) throw error;
  return count ?? 0;
}

/**
 * The target colleague accepting or declining. Permitted by
 * `shift_swaps_target_respond` (0008), which only allows a still-pending
 * row to move to 'accepted' or 'rejected'. Accepting still isn't final —
 * the requester (or a manager) has to finalize it next; this alone does
 * not change the rota.
 */
export async function respondToShiftSwap(
  id: string,
  status: 'accepted' | 'rejected',
): Promise<ShiftSwap> {
  const { data, error } = await supabase
    .from('shift_swaps')
    .update({ status })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/**
 * Final approve/reject. Two different RLS policies permit this same call
 * depending on who's asking and what stage the row is at:
 *   - a manager/owner, on any swap at any stage (`shift_swaps_write`, 0002)
 *   - the requester, once their named colleague has already accepted
 *     (`shift_swaps_requester_finalize`, 0043) — a swap both people already
 *     agreed to doesn't need a manager on top
 * An open ("anyone") swap has no named colleague to have accepted, so only
 * the manager path applies to it.
 */
export async function reviewShiftSwap(
  id: string,
  status: 'approved' | 'rejected',
  reviewedBy: string,
): Promise<ShiftSwap> {
  const { data, error } = await supabase
    .from('shift_swaps')
    .update({ status, reviewed_by: reviewedBy, reviewed_at: new Date().toISOString() })
    .eq('id', id)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

/** The requester withdrawing their own request. */
export async function cancelShiftSwap(id: string): Promise<void> {
  const { error } = await supabase
    .from('shift_swaps')
    .update({ status: 'cancelled' })
    .eq('id', id);
  if (error) throw error;
}
