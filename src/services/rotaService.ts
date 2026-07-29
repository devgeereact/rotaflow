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

export interface RotaPeriodQuery {
  orgId: string;
  periodStart: string;
  periodEnd: string;
  locationId?: string | null;
}

/** Every rota for one org/location/period, newest first. Normally 0 or 1. */
async function listRotasForPeriod(input: RotaPeriodQuery): Promise<Rota[]> {
  let query = supabase
    .from('rotas')
    .select('*')
    .eq('org_id', input.orgId)
    .eq('period_start', input.periodStart)
    .eq('period_end', input.periodEnd);
  query = input.locationId
    ? query.eq('location_id', input.locationId)
    : query.is('location_id', null);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/**
 * The rota the builder should open for a period, whatever its status.
 *
 * A published rota outranks a draft: it is what staff are already looking at,
 * so it must never be shadowed. Filtering this lookup to `status = 'draft'` was
 * the pre-1.5 bug — publishing a week and then revisiting it found no draft,
 * silently created an empty one, and the grid rendered as if the week had been
 * wiped (the shifts were still attached to the published rota, which nothing
 * ever read back).
 */
export async function findRotaForPeriod(input: RotaPeriodQuery): Promise<Rota | null> {
  const rows = await listRotasForPeriod(input);
  return rows.find((r) => r.status === 'published') ?? rows[0] ?? null;
}

/**
 * Find the rota for this org/location/period, or create a draft.
 * A partial unique index (0004_rotas_draft_unique.sql) backs this against
 * concurrent callers — if two requests race past the find-check, the loser's
 * insert hits a 23505 unique-violation, and we just reload the winner's row.
 */
export async function getOrCreateRotaForPeriod(input: CreateDraftRotaInput): Promise<Rota> {
  const existing = await findRotaForPeriod(input);
  if (existing) return existing;

  try {
    return await createDraftRota(input);
  } catch (err) {
    const code = (err as { code?: string } | null)?.code;
    if (code !== '23505') throw err;

    const winner = await findRotaForPeriod(input);
    if (winner) return winner;
    throw err;
  }
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

/**
 * Return a published rota to draft so it can be amended before re-publishing.
 *
 * Can fail with 23505 against `rotas_draft_unique_*` if a stray draft already
 * exists for the same org/location/period — possible only for data created
 * before the `findRotaForPeriod` fix, which could leave a published rota and an
 * empty draft side by side. Callers surface that conflict rather than guessing
 * which of the two to discard.
 */
export async function unpublishRota(id: string): Promise<Rota> {
  return updateRota(id, { status: 'draft', published_at: null });
}
