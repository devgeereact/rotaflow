import { supabase } from '@/lib/supabase';
import type {
  Department,
  DepartmentInsert,
  DepartmentUpdate,
  Location,
  LocationInsert,
  LocationUpdate,
  MinimumCoverRule,
  MinimumCoverRuleUpsert,
} from '@/types';

// Locations and departments live in one service. ARCHITECTURE.md's service
// list names only `locationService`, no separate `departmentService`.

export async function listLocations(orgId: string): Promise<Location[]> {
  const { data, error } = await supabase
    .from('locations')
    .select('*')
    .eq('org_id', orgId)
    .order('name', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function createLocation(input: LocationInsert): Promise<Location> {
  const { data, error } = await supabase
    .from('locations')
    .insert(input)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function updateLocation(
  id: string,
  patch: LocationUpdate,
): Promise<Location> {
  const { data, error } = await supabase
    .from('locations')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

// No deleteLocation in V1. Rotas/shifts/departments all reference locations
// with no soft-delete column available; edit-only is the safe scope.

export async function listDepartments(
  orgId: string,
  locationId?: string,
): Promise<Department[]> {
  let query = supabase.from('departments').select('*').eq('org_id', orgId);
  if (locationId) query = query.eq('location_id', locationId);

  const { data, error } = await query.order('name', { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createDepartment(input: DepartmentInsert): Promise<Department> {
  const { data, error } = await supabase
    .from('departments')
    .insert(input)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function updateDepartment(
  id: string,
  patch: DepartmentUpdate,
): Promise<Department> {
  const { data, error } = await supabase
    .from('departments')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteDepartment(id: string): Promise<void> {
  const { error } = await supabase.from('departments').delete().eq('id', id);
  if (error) throw error;
}

// A site's staffing minimum, one row per weekday. Read by rotaInsights.ts
// alongside shifts; nothing on the server enforces it, per 0036's comment.

export async function listMinimumCoverRules(
  locationId: string,
): Promise<MinimumCoverRule[]> {
  const { data, error } = await supabase
    .from('minimum_cover_rules')
    .select('*')
    .eq('location_id', locationId)
    .order('weekday', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

/** Every org's rules in one query, for the dashboard's cover chart across all sites. */
export async function listMinimumCoverRulesForOrg(
  orgId: string,
): Promise<MinimumCoverRule[]> {
  const { data, error } = await supabase
    .from('minimum_cover_rules')
    .select('*')
    .eq('org_id', orgId);

  if (error) throw error;
  return data ?? [];
}

/** Replaces a location's whole weekly pattern in one round trip. */
export async function setMinimumCoverRules(
  orgId: string,
  locationId: string,
  weekdayMinimums: readonly number[],
): Promise<MinimumCoverRule[]> {
  const rows: MinimumCoverRuleUpsert[] = weekdayMinimums.map((minStaff, weekday) => ({
    org_id: orgId,
    location_id: locationId,
    weekday,
    min_staff: Math.max(0, Math.round(minStaff)),
  }));

  const { data, error } = await supabase
    .from('minimum_cover_rules')
    .upsert(rows, { onConflict: 'location_id,weekday' })
    .select('*');

  if (error) throw error;
  return data ?? [];
}
