import { supabase } from '@/lib/supabase';
import type { ClockEventInsert } from '@/types';

/**
 * Data layer only — no clock-in screen exists yet (Phase 5). This exists now
 * because useSyncQueue (docs/HOOKS.md §8) needs something to replay a queued
 * 'clock' item against, and clock_events + its RLS already shipped in
 * 0002_rotaflow.sql. Building the insert path ahead of its screen mirrors how
 * inviteService landed before the onboarding step that first called it.
 */
export async function recordClockEvent(input: ClockEventInsert): Promise<void> {
  const { error } = await supabase.from('clock_events').insert(input);
  if (error) throw error;
}
