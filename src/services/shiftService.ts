import { supabase } from '@/lib/supabase';
import type { Shift, ShiftInsert, ShiftUpdate } from '@/types';

/** Bulk-insert shifts (e.g. accepted AI rota suggestions) into a draft rota. */
export async function createShifts(shifts: ShiftInsert[]): Promise<Shift[]> {
  if (shifts.length === 0) return [];

  const { data, error } = await supabase.from('shifts').insert(shifts).select('*');

  if (error) throw error;
  return data ?? [];
}

export async function listShiftsForRota(rotaId: string): Promise<Shift[]> {
  const { data, error } = await supabase
    .from('shifts')
    .select('*')
    .eq('rota_id', rotaId)
    .order('starts_at', { ascending: true });

  if (error) throw error;
  return data ?? [];
}

export async function createShift(shift: ShiftInsert): Promise<Shift> {
  const { data, error } = await supabase
    .from('shifts')
    .insert(shift)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function updateShift(id: string, patch: ShiftUpdate): Promise<Shift> {
  const { data, error } = await supabase
    .from('shifts')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteShift(id: string): Promise<void> {
  const { error } = await supabase.from('shifts').delete().eq('id', id);
  if (error) throw error;
}
