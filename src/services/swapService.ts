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
 * The target colleague accepting or declining. Permitted by
 * shift_swaps_target_respond, which only allows a still-pending row to move
 * to 'accepted' or 'rejected'. A manager still has to approve an accepted
 * swap before it's final; this alone does not change the rota.
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

/** Manager final approve/reject. RLS (has_org_role) is the real enforcement. */
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
