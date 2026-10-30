import { api, orgPath, seg } from '@/lib/api';
import type { EmergencyContact, EmergencyContactInsert } from '@/types';

/**
 * Named columns rather than `*`, so a column added later reaches this screen
 * only when someone decides it should (the retired `medical_notes` column was
 * dropped by `0164`, GAP-058).
 */

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
  const r = await api.get<{ emergency_contacts: EmergencyContact[] }>(
    orgPath(orgId, `/staff/${seg(staffProfileId)}/emergency-contacts`),
  );
  return r.emergency_contacts.map((c) => ({
    ...c,
    org_id: orgId,
    staff_profile_id: staffProfileId,
  }));
}

export async function createEmergencyContact(
  input: EmergencyContactInsert,
): Promise<EmergencyContact> {
  const r = await api.post<{ id: string }>(
    orgPath(input.org_id, `/staff/${seg(input.staff_profile_id)}/emergency-contacts`),
    {
      name: input.name,
      relationship: input.relationship ?? null,
      phone: input.phone,
      secondary_phone: input.secondary_phone ?? null,
    },
  );
  const found = (await listEmergencyContacts(input.org_id, input.staff_profile_id)).find(
    (c) => c.id === r.id,
  );
  if (!found) throw new Error('Emergency contact not found');
  return found;
}

export async function deleteEmergencyContact(
  orgId: string,
  id: string,
  staffProfileId: string,
): Promise<void> {
  await api.post(
    orgPath(orgId, `/staff/${seg(staffProfileId)}/emergency-contacts/${seg(id)}/delete`),
  );
}
