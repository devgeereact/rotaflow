import { supabase } from '@/lib/supabase';
import type { Shift, ShiftInsert } from '@/types';

/** Bulk-insert shifts (e.g. accepted AI rota suggestions) into a draft rota. */
export async function createShifts(shifts: ShiftInsert[]): Promise<Shift[]> {
  if (shifts.length === 0) return [];

  const { data, error } = await supabase.from('shifts').insert(shifts).select('*');

  if (error) throw error;
  return data ?? [];
}
