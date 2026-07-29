import { supabase } from '@/lib/supabase';
import type { StaffProfile, StaffProfileInsert, StaffProfileUpdate } from '@/types';

/** Active staff for an org, used to give the rota assistant real people to schedule. */
export async function listActiveStaff(orgId: string): Promise<StaffProfile[]> {
  const { data, error } = await supabase
    .from('staff_profiles')
    .select('*')
    .eq('org_id', orgId)
    .eq('active', true)
    .order('first_name', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export interface ListStaffOptions {
  includeInactive?: boolean;
}

/** All staff for an org (active by default; pass includeInactive for the full roster). */
export async function listStaff(
  orgId: string,
  opts: ListStaffOptions = {},
): Promise<StaffProfile[]> {
  let query = supabase.from('staff_profiles').select('*').eq('org_id', orgId);
  if (!opts.includeInactive) query = query.eq('active', true);

  const { data, error } = await query.order('first_name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * The signed-in user's own staff profile in this org, if they have one.
 *
 * Returns null for a manager or owner who was never added to the staff
 * directory — a real case, since membership and staff record are separate
 * things. Callers must handle it rather than assuming everyone is staff.
 */
export async function getMyStaffProfile(
  orgId: string,
  userId: string,
): Promise<StaffProfile | null> {
  const { data, error } = await supabase
    .from('staff_profiles')
    .select('*')
    .eq('org_id', orgId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function getStaffProfile(id: string): Promise<StaffProfile | null> {
  const { data, error } = await supabase
    .from('staff_profiles')
    .select('*')
    .eq('id', id)
    .maybeSingle();

  if (error) throw error;
  return data;
}

export async function createStaffProfile(
  input: StaffProfileInsert,
): Promise<StaffProfile> {
  const { data, error } = await supabase
    .from('staff_profiles')
    .insert(input)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function updateStaffProfile(
  id: string,
  patch: StaffProfileUpdate,
): Promise<StaffProfile> {
  const { data, error } = await supabase
    .from('staff_profiles')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

/** Soft-delete: staff_profiles.active gates rota/AI-assistant visibility. */
export async function deactivateStaffProfile(id: string): Promise<StaffProfile> {
  return updateStaffProfile(id, { active: false });
}

export async function reactivateStaffProfile(id: string): Promise<StaffProfile> {
  return updateStaffProfile(id, { active: true });
}
