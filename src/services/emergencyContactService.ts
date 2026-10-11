import { supabase } from '@/lib/supabase';
import type { EmergencyContact, EmergencyContactInsert } from '@/types';

/**
 * Named columns rather than `*`, so the retired `medical_notes` column
 * (GAP-058) never reaches this screen even while old values remain stored.
 */
const CONTACT_COLUMNS =
  'id, org_id, staff_profile_id, name, relationship, phone, secondary_phone, created_at, updated_at';

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
    .select(CONTACT_COLUMNS)
    .eq('org_id', orgId)
    .eq('staff_profile_id', staffProfileId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createEmergencyContact(
  input: EmergencyContactInsert,
): Promise<EmergencyContact> {
  // Built field by field, so nothing outside the client type (such as a
  // stray `medical_notes` from an untyped caller) is ever written.
  const row: EmergencyContactInsert = {
    org_id: input.org_id,
    staff_profile_id: input.staff_profile_id,
    name: input.name,
    relationship: input.relationship ?? null,
    phone: input.phone,
    secondary_phone: input.secondary_phone ?? null,
  };
  const { data, error } = await supabase
    .from('emergency_contacts')
    .insert(row)
    .select(CONTACT_COLUMNS)
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
