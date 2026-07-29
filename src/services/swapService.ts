import { supabase } from '@/lib/supabase';
import type { ShiftSwapInsert } from '@/types';

/**
 * Data layer only — no swap-request screen exists yet (Phase 6). See
 * clockService.ts for why this exists ahead of its UI.
 *
 * Scoped to the requester creating a swap request (`requested_by` = self),
 * which is what `shift_swaps_write`'s RLS actually allows today. The colleague
 * *responding* to a swap (ARCHITECTURE.md's other offline example) needs a
 * write path for `target_staff_profile_id`, which the current RLS policy does
 * not grant — that is a real gap, but fixing it is a schema decision that
 * belongs to Phase 6 alongside the rest of the swap workflow, not bundled into
 * the sync-queue infrastructure here.
 */
export async function requestShiftSwap(input: ShiftSwapInsert): Promise<void> {
  const { error } = await supabase.from('shift_swaps').insert(input);
  if (error) throw error;
}
