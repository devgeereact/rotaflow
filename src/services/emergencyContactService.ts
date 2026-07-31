import { supabase } from '@/lib/supabase';
import type { EmergencyContact, EmergencyContactInsert } from '@/types';

export async function listEmergencyContacts(
  staffProfileId: string,
): Promise<EmergencyContact[]> {
  const { data, error } = await supabase
    .from('emergency_contacts')
    .select('*')
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

export async function deleteEmergencyContact(id: string): Promise<void> {
  const { error } = await supabase.from('emergency_contacts').delete().eq('id', id);
  if (error) throw error;
}
