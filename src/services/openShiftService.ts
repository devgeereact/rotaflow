import { supabase } from '@/lib/supabase';

/**
 * Open shifts, and taking one (CAP-010).
 *
 * `shifts.status` has accepted `'open'` since `0002` and the rota builder
 * creates them, but no staff-facing screen has ever shown one. So the state
 * meant "a manager knows this is uncovered" and nothing more — the person who
 * could cover it never learned it existed, and the manager rang round.
 */

export interface OpenShift {
  shiftId: string;
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  notes: string | null;
  shiftType: string | null;
  locationName: string | null;
  /**
   * Whether this overlaps something the reader is already working.
   *
   * Computed in the database rather than the browser: doing it here would
   * mean pulling the reader's whole roster down to compare, which is right in
   * a demo and wrong on a Sunday night on a bad connection.
   */
  clashesWithMine: boolean;
}

export async function listOpenShifts(orgId: string): Promise<OpenShift[]> {
  const { data, error } = await supabase.rpc('open_shifts', { p_org: orgId });
  if (error) throw error;

  return (data ?? []).map((row) => ({
    shiftId: row.shift_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    breakMinutes: row.break_minutes,
    notes: row.notes,
    shiftType: row.shift_type,
    locationName: row.location_name,
    clashesWithMine: row.clashes_with_mine,
  }));
}

/**
 * Take an open shift.
 *
 * The database re-checks "still open" inside the UPDATE's WHERE, so two
 * people tapping the same shift within a second of each other — which is what
 * happens on a ward — cannot both succeed. The loser gets `40001`, and the
 * caller is expected to say so plainly rather than retrying.
 */
export async function claimOpenShift(shiftId: string): Promise<void> {
  const { error } = await supabase.rpc('claim_open_shift', { p_shift: shiftId });
  if (error) throw error;
}
