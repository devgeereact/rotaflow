import { supabase } from '@/lib/supabase';
import type { Availability, AvailabilityInsert } from '@/types';

/** One person's availability entries — recurring weekday patterns and specific dates alike. */
export async function listMyAvailability(
  staffProfileId: string,
): Promise<Availability[]> {
  const { data, error } = await supabase
    .from('availability')
    .select('*')
    .eq('staff_profile_id', staffProfileId)
    .order('recurring', { ascending: false })
    .order('weekday', { ascending: true, nullsFirst: false })
    .order('date', { ascending: true, nullsFirst: false });
  if (error) throw error;
  return data ?? [];
}

/** Every entry across the org — manager's team-availability view. */
export async function listOrgAvailability(orgId: string): Promise<Availability[]> {
  const { data, error } = await supabase
    .from('availability')
    .select('*')
    .eq('org_id', orgId);
  if (error) throw error;
  return data ?? [];
}

export async function createAvailability(
  input: AvailabilityInsert,
): Promise<Availability> {
  const { data, error } = await supabase
    .from('availability')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteAvailability(id: string): Promise<void> {
  const { error } = await supabase.from('availability').delete().eq('id', id);
  if (error) throw error;
}
