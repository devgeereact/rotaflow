import { supabase } from '@/lib/supabase';
import type { StaffProfile } from '@/types';

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
