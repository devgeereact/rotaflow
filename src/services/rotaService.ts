import { supabase } from '@/lib/supabase';
import type { Rota, RotaUpdate } from '@/types';

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

export async function listRotas(orgId: string, locationId?: string): Promise<Rota[]> {
  let query = supabase.from('rotas').select('*').eq('org_id', orgId);
  if (locationId) query = query.eq('location_id', locationId);

  const { data, error } = await query.order('period_start', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * Find the existing draft rota for this org/location/period, or create one.
 * No unique DB constraint backs this yet, so concurrent callers could race —
 * acceptable for a single-manager MVP (see plan risks), a fast-follow
 * migration is the real fix.
 */
export async function getOrCreateDraftRota(input: CreateDraftRotaInput): Promise<Rota> {
  let query = supabase
    .from('rotas')
    .select('*')
    .eq('org_id', input.orgId)
    .eq('period_start', input.periodStart)
    .eq('period_end', input.periodEnd)
    .eq('status', 'draft');
  query = input.locationId
    ? query.eq('location_id', input.locationId)
    : query.is('location_id', null);

  const { data: existing, error: findError } = await query.maybeSingle();

  if (findError) throw findError;
  if (existing) return existing;

  return createDraftRota(input);
}

export async function updateRota(id: string, patch: RotaUpdate): Promise<Rota> {
  const { data, error } = await supabase
    .from('rotas')
    .update(patch)
    .eq('id', id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function publishRota(id: string): Promise<Rota> {
  return updateRota(id, {
    status: 'published',
    published_at: new Date().toISOString(),
  });
}
