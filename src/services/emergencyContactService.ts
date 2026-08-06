import { supabase } from '@/lib/supabase';
import type { EmergencyContact, EmergencyContactInsert } from '@/types';

/**
 * `org_id` filters are defense-in-depth, not the real enforcement. RLS
 * (0002_rotaflow.sql) already scopes every row by its own `org_id`
 * regardless of what a client sends. Adding them here costs nothing and
 * matches the pattern of never trusting a single layer.
 */
export async function listEmergencyContacts(
  orgId: string,
  staffProfileId: string,
): Promise<EmergencyContact[]> {
  const { data, error } = await supabase
    .from('emergency_contacts')
    .select('*')
    .eq('org_id', orgId)
    .eq('staff_profile_id', staffProfileId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createEmergencyContact(
  input: EmergencyContactInsert,
): Promise<EmergencyContact> {
  const { data, error } = await supabase
    .from('emergency_contacts')
    .insert(input)
    .select('*')
    .single();
  if (error) throw error;
  return data;
}

export async function deleteEmergencyContact(orgId: string, id: string): Promise<void> {
  const { error } = await supabase
    .from('emergency_contacts')
    .delete()
    .eq('org_id', orgId)
    .eq('id', id);
  if (error) throw error;
}
