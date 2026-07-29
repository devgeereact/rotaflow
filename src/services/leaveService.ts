import { supabase } from '@/lib/supabase';
import type { LeaveRequestInsert } from '@/types';

/**
 * Data layer only — no leave-request screen exists yet (Phase 6). See
 * clockService.ts for why this exists ahead of its UI: useSyncQueue needs a
 * real insert path to replay a queued 'leave' item against.
 */
export async function createLeaveRequest(input: LeaveRequestInsert): Promise<void> {
  const { error } = await supabase.from('leave_requests').insert(input);
  if (error) throw error;
}
