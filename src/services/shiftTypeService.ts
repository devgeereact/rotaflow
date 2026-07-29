import { supabase } from '@/lib/supabase';
import type { ShiftType, ShiftTypeInsert, ShiftTypeUpdate } from '@/types';

export async function listShiftTypes(orgId: string): Promise<ShiftType[]> {
  const { data, error } = await supabase
    .from('shift_types')
    .select('*')
    .eq('org_id', orgId)
    .order('name', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function createShiftType(input: ShiftTypeInsert): Promise<ShiftType> {
  const { data, error } = await supabase
    .from('shift_types')
    .insert(input)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function updateShiftType(
  id: string,
  patch: ShiftTypeUpdate,
): Promise<ShiftType> {
  const { data, error } = await supabase
    .from('shift_types')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteShiftType(id: string): Promise<void> {
  const { error } = await supabase.from('shift_types').delete().eq('id', id);
  if (error) throw error;
}
