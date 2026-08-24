import { supabase } from '@/lib/supabase';
import { touchOrgActivity } from '@/services/activityService';
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

/** Every rota for one org/location/period, newest first. */
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
 * Everything that is true about one org/location/period at once.
 *
 * The audit's BUG-007 was two parts of the app answering "is this week
 * published?" with different rules — `findRotaForPeriod` preferred a
 * published rota, while the dashboard and staff rollups used
 * `overlapping.every(r => r.status === 'published')`. They only agree while
 * exactly one rota exists per scope, and 0004's unique indexes, which were
 * supposed to guarantee that, turned out to be missing in production.
 *
 * So precedence is decided once, here, and every caller takes its answer
 * from the same object rather than re-deriving it.
 */
export interface RotaPeriodResolution {
  /** What staff can see right now. Null if the week was never published. */
  published: Rota | null;
  /**
   * The manager's editable rota: a plain draft, or an open amendment of the
   * published one. Null when the week is published with no amendment open —
   * in that state there is deliberately nothing editable until someone
   * amends it.
   */
  draft: Rota | null;
  /** True when `draft` is an amendment of `published` rather than a first draft. */
  isAmendment: boolean;
  /** Superseded versions, newest first. History; never edited, never shown to staff. */
  archived: Rota[];
}

export async function resolveRotaForPeriod(
  input: RotaPeriodQuery,
): Promise<RotaPeriodResolution> {
  const rows = await listRotasForPeriod(input);
  const published = rows.find((r) => r.status === 'published') ?? null;
  const draft = rows.find((r) => r.status === 'draft') ?? null;

  return {
    published,
    draft,
    isAmendment: Boolean(draft?.supersedes_rota_id),
    archived: rows.filter((r) => r.status === 'archived'),
  };
}

/**
 * The rota the builder should open for a period.
 *
 * An open amendment outranks the published rota it supersedes: it is the
 * copy the manager is working on, and the published one is now immutable
 * (0061). Otherwise a published rota outranks a draft — it is what staff are
 * already looking at, so it must never be shadowed. Filtering this lookup to
 * `status = 'draft'` was the pre-1.5 bug: publishing a week and revisiting it
 * found no draft, silently created an empty one, and the grid rendered as if
 * the week had been wiped.
 */
export async function findRotaForPeriod(input: RotaPeriodQuery): Promise<Rota | null> {
  const { published, draft, isAmendment } = await resolveRotaForPeriod(input);
  if (isAmendment && draft) return draft;
  return published ?? draft ?? null;
}

/**
 * Find the rota for this org/location/period, or create a draft.
 *
 * A partial unique index (0059, restoring 0004) backs this against
 * concurrent callers: if two requests race past the find-check, the loser's
 * insert hits a 23505 unique-violation and we reload the winner's row.
 */
export async function getOrCreateRotaForPeriod(
  input: CreateDraftRotaInput,
): Promise<Rota> {
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

/**
 * Is this rota being read, or worked on?
 *
 * A published rota is immutable in the database (0061's
 * `shifts_guard_immutable_rota`), so the grid has to know not to offer edits
 * it cannot make. This is the single predicate the UI asks; nothing should
 * re-derive it from `status` alone, because an *archived* rota is equally
 * uneditable and a draft amendment of a published week is fully editable.
 */
export function isRotaEditable(rota: Rota | null | undefined): boolean {
  return rota?.status === 'draft';
}

/**
 * Begin amending a published rota.
 *
 * Returns a draft copy of it. The published rota is untouched and staff keep
 * seeing exactly what they were told until the amendment is published in its
 * place. Idempotent: calling it twice returns the same amendment rather than
 * forking a second one, so a double-clicked button is harmless.
 *
 * The shifts in the returned draft are COPIES with their own ids. Callers
 * must reload the week from the new rota rather than carrying shift ids
 * across the call.
 */
export async function beginRotaRevision(rotaId: string): Promise<Rota> {
  const { data, error } = await supabase.rpc('begin_rota_revision', {
    p_rota_id: rotaId,
  });
  if (error) throw error;
  return data;
}

/**
 * Throw away an amendment and go back to the published rota.
 *
 * The way out of BUG-029's one-way state. Without it, a manager who amends a
 * week and then changes their mind has no route back that does not involve
 * deleting rows by hand.
 */
export async function discardRotaRevision(rotaId: string): Promise<Rota> {
  const { data, error } = await supabase.rpc('discard_rota_revision', {
    p_rota_id: rotaId,
  });
  if (error) throw error;
  return data;
}

/**
 * Publish a draft.
 *
 * If the draft is an amendment, the rota it supersedes is archived in the
 * same transaction, so staff never see two versions of a week or none of it.
 * The transition itself lives in the database (0061): a direct PATCH of
 * `rotas.status` is refused, which is what makes "Published" mean the same
 * thing to every caller, including a curl request with a manager's token.
 */
export async function publishRota(id: string): Promise<Rota> {
  const { data, error } = await supabase.rpc('publish_rota', { p_rota_id: id });
  if (error) throw error;

  const rota = data;
  // Publishing a rota is a deliberate act by a manager, which is exactly what
  // "last activity" is meant to record.
  touchOrgActivity(rota.org_id);
  return rota;
}

/**
 * Withdraw a published week from staff entirely.
 *
 * Distinct from amending it. Refused while an amendment is open (error code
 * `ROTA8`) rather than silently discarding the manager's unpublished work to
 * make room.
 */
export async function unpublishRota(id: string): Promise<Rota> {
  const { data, error } = await supabase.rpc('unpublish_rota', { p_rota_id: id });
  if (error) throw error;
  return data;
}
