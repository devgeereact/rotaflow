import { activeOrgPath, api, orgPath, seg } from '@/lib/api';
import type { ShiftType, ShiftTypeInsert, ShiftTypeUpdate } from '@/types';

/** Shift types (`/orgs/{o}/shift-types`). Any member reads; owner and manager write. A type in use cannot be deleted. */

function toType(orgId: string, t: Omit<ShiftType, 'org_id'>): ShiftType {
  return { ...t, org_id: orgId, is_paid: Boolean(t.is_paid) };
}

function body(t: Partial<ShiftType>): Record<string, unknown> {
  return {
    name: t.name,
    colour: t.colour ?? null,
    default_start: t.default_start ?? null,
    default_end: t.default_end ?? null,
    is_paid: t.is_paid ?? true,
    category: t.category ?? null,
  };
}

export async function listShiftTypes(orgId: string): Promise<ShiftType[]> {
  const r = await api.get<{ shift_types: Omit<ShiftType, 'org_id'>[] }>(
    orgPath(orgId, '/shift-types'),
  );
  return r.shift_types.map((t) => toType(orgId, t));
}

export async function createShiftType(input: ShiftTypeInsert): Promise<ShiftType> {
  const r = await api.post<{ id: string }>(
    orgPath(input.org_id, '/shift-types'),
    body(input),
  );
  const found = (await listShiftTypes(input.org_id)).find((t) => t.id === r.id);
  if (!found) throw new Error('Shift type not found');
  return found;
}

/** The API saves the whole row, so the current values fill in whatever the patch leaves out. */
export async function updateShiftType(
  id: string,
  patch: ShiftTypeUpdate,
): Promise<ShiftType> {
  const path = patch.org_id
    ? orgPath(patch.org_id, '/shift-types')
    : activeOrgPath('/shift-types');
  const r = await api.get<{ shift_types: ShiftType[] }>(path);
  const current = r.shift_types.find((t) => t.id === id);
  if (!current) throw new Error('Shift type not found');
  const merged = { ...current, ...patch };
  await api.post(`${path}/${seg(id)}`, body(merged));
  return merged;
}

export async function deleteShiftType(id: string): Promise<void> {
  await api.post(activeOrgPath(`/shift-types/${seg(id)}/delete`));
}
