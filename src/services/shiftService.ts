import { supabase } from '@/lib/supabase';
import type { Shift, ShiftInsert, ShiftUpdate } from '@/types';

/** Bulk-insert shifts (e.g. accepted AI rota suggestions) into a draft rota. */
export async function createShifts(shifts: ShiftInsert[]): Promise<Shift[]> {
  if (shifts.length === 0) return [];

  const { data, error } = await supabase.from('shifts').insert(shifts).select('*');

  if (error) throw error;
  return data ?? [];
}

/**
 * Every shift on these rotas, in one round trip (HARDEN-006).
 *
 * This replaces a per-rota `listShiftsForRota`. The rota builder holds one
 * rota per location and fetched each one's shifts separately, so viewing a
 * week across six sites cost six queries on top of six rota lookups — and
 * every caller immediately concatenated the results anyway. Nothing wanted one
 * rota's shifts on their own, so nothing lost a caller when it went.
 *
 * Ordered by rota then start, so a caller grouping by location gets each group
 * already in the order the grid renders it.
 */
export async function listShiftsForRotas(rotaIds: string[]): Promise<Shift[]> {
  if (rotaIds.length === 0) return [];

  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .in('rota_id', rotaIds)
    .order('rota_id', { ascending: true })
    .order('starts_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export interface PeriodShiftQuery {
  orgId: string;
  /** Inclusive ISO instant for the start of the window. */
  fromIso: string;
  /** Exclusive ISO instant for the end of the window. */
  toIso: string;
  locationId?: string | null;
  /** Restrict to one person. The staff "my schedule" view. */
  staffProfileId?: string | null;
  /**
   * Only shifts attached to a published rota. The schedule shows what staff
   * have been told; a draft is a manager's working copy and must not leak into
   * it. Default true, a caller has to ask for drafts deliberately.
   */
  publishedOnly?: boolean;
}

/**
 * Shifts overlapping a time window, for the schedule views.
 *
 * Selects the parent rota's status so drafts can be excluded. Filtering is by
 * instant, not by date string: a night shift starting 23:00 local belongs to
 * the day it starts, and comparing dates as text gets that wrong across a
 * timezone boundary.
 */
export async function listShiftsForPeriod(query: PeriodShiftQuery): Promise<Shift[]> {
  let request = supabase
    .from('shifts')
    .select('*, rota:rotas(status)')
    .eq('org_id', query.orgId)
    .gte('starts_at', query.fromIso)
    .lt('starts_at', query.toIso)
    .neq('status', 'cancelled');

  if (query.locationId) request = request.eq('location_id', query.locationId);
  if (query.staffProfileId)
    request = request.eq('staff_profile_id', query.staffProfileId);

  const { data, error } = await request.order('starts_at', { ascending: true });
  if (error) throw error;

  const rows = data ?? [];
  const published = query.publishedOnly !== false;

  return rows
    .filter((row) => {
      if (!published) return true;
      const rota = (row as { rota?: { status?: string } | null }).rota;
      return rota?.status === 'published';
    })
    .map(({ rota: _rota, ...shift }) => shift);
}

export async function createShift(shift: ShiftInsert): Promise<Shift> {
  const { data, error } = await supabase
    .from('shifts')
    .insert(shift)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function updateShift(id: string, patch: ShiftUpdate): Promise<Shift> {
  const { data, error } = await supabase
    .from('shifts')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteShift(id: string): Promise<void> {
  const { error } = await supabase.from('shifts').delete().eq('id', id);
  if (error) throw error;
}
