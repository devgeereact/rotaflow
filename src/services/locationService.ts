import { activeOrgPath, api, orgPath, seg } from '@/lib/api';
import type {
  Department,
  DepartmentInsert,
  DepartmentUpdate,
  Location,
  LocationInsert,
  LocationUpdate,
  MinimumCoverRule,
} from '@/types';

// Locations and departments live in one service. ARCHITECTURE.md's service
// list names only `locationService`, no separate `departmentService`.

type ApiLocation = Omit<Location, 'latitude' | 'longitude'> & {
  latitude: string | number | null;
  longitude: string | number | null;
};

const num = (v: string | number | null): number | null =>
  v === null || v === '' ? null : Number(v);

function toLocation(orgId: string, l: ApiLocation): Location {
  return {
    ...l,
    org_id: orgId,
    latitude: num(l.latitude),
    longitude: num(l.longitude),
  };
}

const LOCATION_FIELDS = [
  'name',
  'address',
  'latitude',
  'longitude',
  'timezone',
  'geofence_radius_m',
  'location_type',
  'status',
] as const;

function locationBody(row: Partial<Location>): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  for (const k of LOCATION_FIELDS) if (k in row) body[k] = row[k as keyof Location];
  return body;
}

export async function listLocations(orgId: string): Promise<Location[]> {
  const r = await api.get<{ locations: ApiLocation[] }>(orgPath(orgId, '/locations'));
  return r.locations.map((l) => toLocation(orgId, l));
}

async function locationById(orgId: string, id: string): Promise<Location> {
  const found = (await listLocations(orgId)).find((l) => l.id === id);
  if (!found) throw new Error('Location not found');
  return found;
}

export async function createLocation(input: LocationInsert): Promise<Location> {
  const r = await api.post<{ id: string }>(
    orgPath(input.org_id, '/locations'),
    locationBody(input),
  );
  return locationById(input.org_id, r.id);
}

/** The API saves the whole row, so the current values fill in whatever the patch leaves out. */
export async function updateLocation(
  id: string,
  patch: LocationUpdate,
): Promise<Location> {
  const orgId = patch.org_id;
  const path = orgId ? orgPath(orgId, '/locations') : activeOrgPath('/locations');
  const r = await api.get<{ locations: ApiLocation[] }>(path);
  const current = r.locations.find((l) => l.id === id);
  if (!current) throw new Error('Location not found');
  const merged = { ...toLocation(orgId ?? '', current), ...patch };
  await api.post(`${path}/${seg(id)}`, locationBody(merged));
  const after = (await api.get<{ locations: ApiLocation[] }>(path)).locations.find(
    (l) => l.id === id,
  );
  return toLocation(orgId ?? current.org_id ?? '', after ?? current);
}

/** Refused (409 location_in_use) while rotas or shifts use it: mark it inactive instead. */
export async function deleteLocation(orgId: string, id: string): Promise<void> {
  await api.post(orgPath(orgId, `/locations/${seg(id)}/delete`));
}

export async function listDepartments(
  orgId: string,
  locationId?: string,
): Promise<Department[]> {
  const r = await api.get<{ departments: Omit<Department, 'org_id'>[] }>(
    orgPath(orgId, '/departments'),
  );
  return r.departments
    .filter((d) => !locationId || d.location_id === locationId)
    .map((d) => ({ ...d, org_id: orgId }));
}

export async function createDepartment(input: DepartmentInsert): Promise<Department> {
  const r = await api.post<{ id: string }>(orgPath(input.org_id, '/departments'), {
    name: input.name,
    location_id: input.location_id ?? null,
  });
  const found = (await listDepartments(input.org_id)).find((d) => d.id === r.id);
  if (!found) throw new Error('Department not found');
  return found;
}

export async function updateDepartment(
  id: string,
  patch: DepartmentUpdate,
): Promise<Department> {
  const path = patch.org_id
    ? orgPath(patch.org_id, '/departments')
    : activeOrgPath('/departments');
  const r = await api.get<{ departments: Department[] }>(path);
  const current = r.departments.find((d) => d.id === id);
  if (!current) throw new Error('Department not found');
  const merged = { ...current, ...patch };
  await api.post(`${path}/${seg(id)}`, {
    name: merged.name,
    location_id: merged.location_id ?? null,
  });
  return merged;
}

/** Refused (409 department_in_use) while shifts use it. */
export async function deleteDepartment(id: string): Promise<void> {
  await api.post(activeOrgPath(`/departments/${seg(id)}/delete`));
}

// A site's staffing minimum, one row per weekday. Read by rotaInsights.ts alongside shifts.

type ApiCoverRule = Omit<MinimumCoverRule, 'org_id'>;

export async function listMinimumCoverRulesForOrg(
  orgId: string,
): Promise<MinimumCoverRule[]> {
  const r = await api.get<{ rules: ApiCoverRule[] }>(orgPath(orgId, '/minimum-cover'));
  return r.rules.map((rule) => ({ ...rule, org_id: orgId }));
}

export async function listMinimumCoverRules(
  locationId: string,
): Promise<MinimumCoverRule[]> {
  const r = await api.get<{ rules: ApiCoverRule[] }>(activeOrgPath('/minimum-cover'));
  return r.rules
    .filter((rule) => rule.location_id === locationId)
    .map((rule) => ({ ...rule, org_id: '' }));
}

/** Replaces a location's whole weekly pattern, one weekday at a time (each write is idempotent). */
export async function setMinimumCoverRules(
  orgId: string,
  locationId: string,
  weekdayMinimums: readonly number[],
): Promise<MinimumCoverRule[]> {
  for (const [weekday, minStaff] of weekdayMinimums.entries()) {
    await api.post(orgPath(orgId, '/minimum-cover'), {
      location_id: locationId,
      weekday,
      min_staff: Math.max(0, Math.round(minStaff)),
    });
  }
  return (await listMinimumCoverRulesForOrg(orgId)).filter(
    (r) => r.location_id === locationId,
  );
}
