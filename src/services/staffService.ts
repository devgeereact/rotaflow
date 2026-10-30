import { activeOrgPath, api, orgPath, seg } from '@/lib/api';
import type { StaffProfile, StaffProfileInsert, StaffProfileUpdate } from '@/types';

/**
 * Staff records through the API (`/orgs/{o}/staff`).
 *
 * The API nulls the sensitive columns (payroll id, email, phone, start date, holiday allowance) unless the reader is
 * an owner or manager of that organisation or it is their own record, so a list is safe to hand to any screen. A
 * person who is not a manager may change only their own phone and photo (403 `self_edit_restricted` otherwise).
 */

type ApiStaff = StaffProfile & { location_ids?: string[] };

const toNum = (v: unknown): number | null =>
  v === null || v === undefined || v === '' ? null : Number(v);

function toStaff(r: ApiStaff): StaffProfile {
  const row: StaffProfile & { location_ids?: string[] } = { ...r };
  delete row.location_ids;
  return {
    ...row,
    active: Boolean(row.active),
    weekly_hours: toNum(row.weekly_hours),
    holiday_allowance: toNum(row.holiday_allowance),
  };
}

const FIELDS = [
  'first_name',
  'last_name',
  'email',
  'job_title',
  'job_title_id',
  'department_id',
  'contract_type',
  'weekly_hours',
  'holiday_allowance',
  'skills',
  'payroll_id',
  'start_date',
  'phone',
  'photo_url',
  'active',
] as const;

function body(row: Partial<StaffProfile>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of FIELDS) if (k in row) out[k] = row[k as keyof StaffProfile];
  return out;
}

async function fetchStaff(orgId: string, activeOnly: boolean): Promise<StaffProfile[]> {
  const r = await api.get<{ staff: ApiStaff[] }>(
    orgPath(orgId, '/staff'),
    activeOnly ? { active: 1 } : undefined,
  );
  return r.staff.map(toStaff);
}

/** Active staff for an org, used to give the rota assistant real people to schedule. */
export async function listActiveStaff(orgId: string): Promise<StaffProfile[]> {
  return fetchStaff(orgId, true);
}

export interface ListStaffOptions {
  includeInactive?: boolean;
}

/** All staff for an org (active by default; pass includeInactive for the full roster). */
export async function listStaff(
  orgId: string,
  opts: ListStaffOptions = {},
): Promise<StaffProfile[]> {
  return fetchStaff(orgId, !opts.includeInactive);
}

/**
 * The signed-in user's own staff profile in this org, if they have one. Null for a manager or owner who was never
 * added to the staff directory; callers must handle it.
 */
export async function getMyStaffProfile(
  orgId: string,
  userId: string,
): Promise<StaffProfile | null> {
  return (await fetchStaff(orgId, false)).find((s) => s.user_id === userId) ?? null;
}

async function getIn(path: string, id: string): Promise<StaffProfile | null> {
  try {
    const r = await api.get<{ staff: ApiStaff }>(`${path}/${seg(id)}`);
    return toStaff(r.staff);
  } catch (error) {
    if ((error as { status?: number }).status === 404) return null;
    throw error;
  }
}

export async function getStaffProfile(id: string): Promise<StaffProfile | null> {
  return getIn(activeOrgPath('/staff'), id);
}

export async function createStaffProfile(
  input: StaffProfileInsert,
): Promise<StaffProfile> {
  const path = orgPath(input.org_id, '/staff');
  const r = await api.post<{ id: string }>(path, body(input));
  const created = await getIn(path, r.id);
  if (!created) throw new Error('Staff record was created but could not be read back.');
  return created;
}

export async function updateStaffProfile(
  id: string,
  patch: StaffProfileUpdate,
): Promise<StaffProfile> {
  const path = patch.org_id ? orgPath(patch.org_id, '/staff') : activeOrgPath('/staff');
  await api.post(`${path}/${seg(id)}`, body(patch as Partial<StaffProfile>));
  const updated = await getIn(path, id);
  if (!updated) throw new Error('Staff record was updated but could not be read back.');
  return updated;
}

/** Soft-delete: staff_profiles.active gates rota/AI-assistant visibility. */
export async function deactivateStaffProfile(id: string): Promise<StaffProfile> {
  return updateStaffProfile(id, { active: false });
}

/** Takes a seat again: refused when the plan's seats are full. */
export async function reactivateStaffProfile(id: string): Promise<StaffProfile> {
  return updateStaffProfile(id, { active: true });
}

/**
 * Create several staff records (CAP-084). One request per row, in order: the seat limit can refuse partway, which
 * is why the caller reports how many landed. Stops at the first refusal and returns what was created.
 */
export async function createStaffProfiles(
  rows: readonly StaffProfileInsert[],
): Promise<StaffProfile[]> {
  if (rows.length === 0) return [];
  const orgId = rows[0]?.org_id ?? '';
  const ids: string[] = [];
  let failure: Error | null = null;
  for (const row of rows) {
    try {
      const r = await api.post<{ id: string }>(orgPath(row.org_id, '/staff'), body(row));
      ids.push(r.id);
    } catch (error) {
      failure = error instanceof Error ? error : new Error(String(error));
      break;
    }
  }
  if (ids.length === 0 && failure) throw failure;
  const wanted = new Set(ids);
  return (await fetchStaff(orgId, false))
    .filter((s) => wanted.has(s.id))
    .sort((a, b) => a.first_name.localeCompare(b.first_name));
}

/**
 * Where a person works, as a set (CAP-089). Absence means "nothing recorded", not "works nowhere": every read falls
 * back to the department's site.
 */
export async function listStaffLocations(orgId: string): Promise<Map<string, string[]>> {
  const r = await api.get<{ staff: ApiStaff[] }>(orgPath(orgId, '/staff'));
  const byStaff = new Map<string, string[]>();
  for (const s of r.staff) {
    if (s.location_ids && s.location_ids.length > 0) byStaff.set(s.id, s.location_ids);
  }
  return byStaff;
}

/** Replace one person's sites in one transaction. */
export async function setStaffLocations(
  orgId: string,
  staffProfileId: string,
  locationIds: readonly string[],
): Promise<void> {
  await api.post(orgPath(orgId, `/staff/${seg(staffProfileId)}/locations`), {
    location_ids: [...locationIds],
  });
}
