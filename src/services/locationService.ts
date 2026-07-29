import { supabase } from '@/lib/supabase';
import type {
  Department,
  DepartmentInsert,
  DepartmentUpdate,
  Location,
  LocationInsert,
  LocationUpdate,
} from '@/types';

// Locations and departments live in one service — ARCHITECTURE.md's service
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

// No deleteLocation in V1 — rotas/shifts/departments all reference locations
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

export async function createDepartment(
  input: DepartmentInsert,
): Promise<Department> {
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
