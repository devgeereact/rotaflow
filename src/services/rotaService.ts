import { supabase } from '@/lib/supabase';
import type { Rota } from '@/types';

export interface CreateDraftRotaInput {
  orgId: string;
  name: string;
  periodStart: string; // date, 'YYYY-MM-DD'
  periodEnd: string; // date, 'YYYY-MM-DD'
  locationId?: string | null;
}

/** Create a draft rota for shifts to be attached to. */
export async function createDraftRota(input: CreateDraftRotaInput): Promise<Rota> {
  const { data, error } = await supabase
    .from('rotas')
    .insert({
      org_id: input.orgId,
      name: input.name,
      period_start: input.periodStart,
      period_end: input.periodEnd,
      location_id: input.locationId ?? null,
      status: 'draft',
    })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}
