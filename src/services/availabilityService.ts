import { activeOrgPath, api, orgPath, seg } from '@/lib/api';
import type { Availability, AvailabilityInsert } from '@/types';

/**
 * Availability (`/orgs/{o}/availability`). A person reads and writes their own; owner and manager read everyone's
 * and may record it for anyone. The API answers staff with their own rows only, whatever they ask for.
 */

type ApiAvailability = Omit<Availability, 'org_id' | 'created_at' | 'updated_at'>;

function toRow(orgId: string, a: ApiAvailability): Availability {
  return {
    created_at: '',
    updated_at: '',
    ...a,
    org_id: orgId,
    recurring: Boolean(a.recurring),
    weekday: a.weekday === null ? null : Number(a.weekday),
  };
}

async function read(
  path: string,
  orgId: string,
  staffProfileId?: string,
): Promise<Availability[]> {
  const r = await api.get<{ availability: ApiAvailability[] }>(path, {
    staff_profile_id: staffProfileId,
  });
  return r.availability.map((a) => toRow(orgId, a));
}

export async function listMyAvailability(
  staffProfileId: string,
): Promise<Availability[]> {
  const rows = await read(activeOrgPath('/availability'), '', staffProfileId);
  return rows
    .filter((a) => a.staff_profile_id === staffProfileId)
    .sort(
      (a, b) =>
        Number(b.recurring) - Number(a.recurring) ||
        (a.weekday ?? 99) - (b.weekday ?? 99) ||
        (a.date ?? '9999').localeCompare(b.date ?? '9999'),
    );
}

export async function listOrgAvailability(orgId: string): Promise<Availability[]> {
  return read(orgPath(orgId, '/availability'), orgId);
}

export async function createAvailability(
  input: AvailabilityInsert,
): Promise<Availability> {
  const path = orgPath(input.org_id, '/availability');
  const r = await api.post<{ id: string }>(path, {
    staff_profile_id: input.staff_profile_id,
    weekday: input.weekday ?? null,
    date: input.date ?? null,
    start_time: input.start_time ?? null,
    end_time: input.end_time ?? null,
    status: input.status ?? 'available',
    recurring: input.recurring ?? false,
  });
  const found = (await read(path, input.org_id, input.staff_profile_id)).find(
    (a) => a.id === r.id,
  );
  if (!found) throw new Error('Availability not found');
  return found;
}

export async function deleteAvailability(id: string): Promise<void> {
  await api.post(activeOrgPath(`/availability/${seg(id)}/delete`));
}
