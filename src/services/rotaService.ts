import { activeOrgPath, api, ApiError, isApiCode, orgPath, seg } from '@/lib/api';
import type { Rota, RotaUpdate } from '@/types';
import { readOnlyErrorMessage } from '@/lib/billingState';

export interface CreateDraftRotaInput {
  orgId: string;
  name: string;
  periodStart: string; // date, 'YYYY-MM-DD'
  periodEnd: string; // date, 'YYYY-MM-DD'
  locationId?: string | null;
}

/** Create a draft rota for shifts to be attached to. */
export async function createDraftRota(input: CreateDraftRotaInput): Promise<Rota> {
  const r = await api.post<{ rota: Rota }>(orgPath(input.orgId, '/rotas'), {
    name: input.name,
    period_start: input.periodStart,
    period_end: input.periodEnd,
    location_id: input.locationId ?? null,
  });
  return r.rota;
}

export async function listRotas(orgId: string, locationId?: string): Promise<Rota[]> {
  const r = await api.get<{ rotas: Rota[] }>(orgPath(orgId, '/rotas'), {
    location_id: locationId,
  });
  return r.rotas;
}

/** Rotas overlapping [from, to], newest first: the API's own filter, narrowed further by the callers. */
async function rotasOverlapping(
  orgId: string,
  from: string,
  to: string,
): Promise<Rota[]> {
  const r = await api.get<{ rotas: Rota[] }>(orgPath(orgId, '/rotas'), { from, to });
  return [...r.rotas].sort((a, b) => b.created_at.localeCompare(a.created_at));
}

export interface RotaPeriodQuery {
  orgId: string;
  periodStart: string;
  periodEnd: string;
  locationId?: string | null;
}

/** Every rota for one org/location/period, newest first. */
async function listRotasForPeriod(input: RotaPeriodQuery): Promise<Rota[]> {
  const location = input.locationId ?? null;
  return (await rotasOverlapping(input.orgId, input.periodStart, input.periodEnd)).filter(
    (r) =>
      r.period_start === input.periodStart &&
      r.period_end === input.periodEnd &&
      r.location_id === location,
  );
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

/**
 * The precedence rule itself, over rows already fetched.
 *
 * Pure and shared, because the whole point of `RotaPeriodResolution` is that
 * precedence is decided in exactly one place. The batch loader below reads the
 * same rows in a single round trip and must reach the same answer as the
 * per-location path, so it calls this rather than repeating the `find`s.
 *
 * Expects rows newest-first within the scope, which is the order
 * `listRotasForPeriod` returns and the order the batch query asks for.
 */
export function resolveRotaRows(rows: Rota[]): RotaPeriodResolution {
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
 * Which of a resolution's rotas the builder should open. Same rule as
 * `findRotaForPeriod`, factored out so the batch path cannot drift from it.
 */
export function pickRotaToOpen(resolution: RotaPeriodResolution): Rota | null {
  const { published, draft, isAmendment } = resolution;
  if (isAmendment && draft) return draft;
  return published ?? draft ?? null;
}

export async function resolveRotaForPeriod(
  input: RotaPeriodQuery,
): Promise<RotaPeriodResolution> {
  return resolveRotaRows(await listRotasForPeriod(input));
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
  return pickRotaToOpen(await resolveRotaForPeriod(input));
}

export interface MultiLocationRotaQuery {
  orgId: string;
  periodStart: string;
  periodEnd: string;
  locationIds: string[];
}

/**
 * The rota to open for each of several locations, in ONE round trip.
 *
 * The builder shows every location at once, and used to resolve each one
 * separately — `findRotaForPeriod` then a shift fetch, so two queries per
 * location per week viewed (HARDEN-006). Six sites meant twelve round trips to
 * change the week, and `Promise.all` only hid the latency behind itself; the
 * database still did the work six times, and each of those lookups scanned
 * every rota the org had ever had (0072 indexes that too).
 *
 * Returns a map keyed by location id. A location with no rota yet is simply
 * absent — creating one is the caller's decision, because it is a write, and
 * merely looking at a week should not create rows for locations nobody has
 * scheduled.
 */
export interface MultiWeekRotaQuery {
  orgId: string;
  /** Monday of each week to resolve, 'YYYY-MM-DD'. */
  weekStarts: readonly string[];
  locationIds: readonly string[];
}

/** Key for the multiweek map: one location's rota for one week. */
export function rotaWeekKey(locationId: string, weekStart: string): string {
  return `${locationId}|${weekStart}`;
}

/**
 * Resolve every location's rota for several weeks in one query.
 *
 * The planner shows three weeks at once, and three separate
 * `resolveRotasForLocations` calls would be three round trips for rows one
 * `IN` covers. It also **never writes**: browsing a week that has no rota is
 * not an intention to create one, and the previous loader's
 * `getOrCreateRotaForPeriod` on load wrote an empty draft into the database
 * for every location every time somebody scrolled past an empty week. A draft
 * is created by the first real edit instead — see `ensureRotaForWeek`.
 */
export async function resolveRotasForWeeks(
  input: MultiWeekRotaQuery,
): Promise<Map<string, RotaPeriodResolution>> {
  const byKey = new Map<string, RotaPeriodResolution>();
  if (input.locationIds.length === 0 || input.weekStarts.length === 0) return byKey;

  const sorted = [...input.weekStarts].sort();
  const weeks = new Set(input.weekStarts);
  const sites = new Set(input.locationIds);
  const rows = (
    await rotasOverlapping(input.orgId, sorted[0] ?? '', sorted[sorted.length - 1] ?? '')
  ).filter(
    (r) =>
      weeks.has(r.period_start) && r.location_id !== null && sites.has(r.location_id),
  );

  const grouped = new Map<string, Rota[]>();
  for (const row of rows) {
    if (row.location_id === null) continue;
    const key = rotaWeekKey(row.location_id, row.period_start);
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }

  for (const [key, list] of grouped) byKey.set(key, resolveRotaRows(list));
  return byKey;
}

export async function resolveRotasForLocations(
  input: MultiLocationRotaQuery,
): Promise<Map<string, RotaPeriodResolution>> {
  const byLocation = new Map<string, RotaPeriodResolution>();
  if (input.locationIds.length === 0) return byLocation;

  const sites = new Set(input.locationIds);
  const rows = (
    await rotasOverlapping(input.orgId, input.periodStart, input.periodEnd)
  ).filter(
    (r) =>
      r.period_start === input.periodStart &&
      r.period_end === input.periodEnd &&
      r.location_id !== null &&
      sites.has(r.location_id),
  );

  const grouped = new Map<string, Rota[]>();
  for (const row of rows) {
    const key = row.location_id;
    if (key === null) continue;
    const bucket = grouped.get(key);
    if (bucket) bucket.push(row);
    else grouped.set(key, [row]);
  }

  for (const [locationId, list] of grouped) {
    byLocation.set(locationId, resolveRotaRows(list));
  }
  return byLocation;
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
    // Two tabs creating the same week: the second is refused (409 rota_exists) and reloads the winner.
    if (!isApiCode(err, 'rota_exists')) throw err;

    const winner = await findRotaForPeriod(input);
    if (winner) return winner;
    throw err;
  }
}

/**
 * The rota lifecycle's own refusals, as opposed to something going wrong.
 *
 * `0061` and `0080` raise with `ROTA4`–`ROTA8` and a message written for the
 * manager to read: "Ward A is 1 short of its 2-person minimum on Sat 05 Sep.
 * Fill the gap, or change that day's minimum in Settings → Policies."
 *
 * Those messages have to reach the screen. Every publish failure used to
 * render as "Could not publish this rota. Please try again.", which is not
 * only unhelpful for a rule violation but actively wrong advice — retrying
 * cannot satisfy a minimum-cover rule, and the manager needs to know which day
 * and which site.
 *
 * Only the `ROTA*` codes, and `BILL1` for a read-only organisation (0154),
 * are surfaced. A connection failure or a genuine 500 still gets the generic
 * line, because those really are "try again". Retrying a `BILL1` is not: the
 * trial has ended, and the message says to choose a plan.
 */
export function rotaRefusalMessage(err: unknown): string | null {
  // The API refuses a rota change with a 409 and a sentence written for the person (publish lock, minimum
  // cover, open amendment); read-only billing is a 402 with its own banner text.
  if (err instanceof ApiError && err.status === 409 && err.message) return err.message;
  return readOnlyErrorMessage(err);
}

export async function updateRota(id: string, patch: RotaUpdate): Promise<Rota> {
  const body: Record<string, unknown> = {};
  for (const k of ['name', 'period_start', 'period_end'] as const)
    if (k in patch) body[k] = patch[k];
  const r = await api.post<{ rota: Rota }>(activeOrgPath(`/rotas/${seg(id)}`), body);
  return r.rota;
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
  return (await api.post<{ rota: Rota }>(activeOrgPath(`/rotas/${seg(rotaId)}/revision`)))
    .rota;
}

/**
 * Throw away an amendment and go back to the published rota.
 *
 * The way out of BUG-029's one-way state. Without it, a manager who amends a
 * week and then changes their mind has no route back that does not involve
 * deleting rows by hand.
 */
export async function discardRotaRevision(rotaId: string): Promise<Rota> {
  return (await api.post<{ rota: Rota }>(activeOrgPath(`/rotas/${seg(rotaId)}/discard`)))
    .rota;
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
  return (await api.post<{ rota: Rota }>(activeOrgPath(`/rotas/${seg(id)}/publish`)))
    .rota;
}

/**
 * Withdraw a published week from staff entirely.
 *
 * Distinct from amending it. Refused while an amendment is open (error code
 * `ROTA8`) rather than silently discarding the manager's unpublished work to
 * make room.
 */
export async function unpublishRota(id: string): Promise<Rota> {
  return (await api.post<{ rota: Rota }>(activeOrgPath(`/rotas/${seg(id)}/unpublish`)))
    .rota;
}

export interface RepeatResult {
  weeksCreated: number;
  shiftsCreated: number;
  /** Weeks left alone: a published rota, or a draft already holding work. */
  weeksSkipped: number;
}

/**
 * Copy a week's shifts into the following N weeks (CAP-006, `0107`).
 *
 * One call, one transaction. The client could do this with the paste
 * machinery it already has, but twelve weeks that way is twelve rota
 * creations and several hundred round trips, each able to fail on its own —
 * leaving a quarter half-built with no record of where it stopped.
 *
 * It never writes over a published week or a draft somebody has already
 * started, and returns how many it left alone so the screen can say so
 * rather than implying the whole quarter is filled.
 */
export async function repeatRotaWeeks(
  rotaId: string,
  weeks: number,
): Promise<RepeatResult> {
  const r = await api.post<{
    weeks_created: number;
    shifts_created: number;
    weeks_skipped: number;
  }>(activeOrgPath(`/rotas/${seg(rotaId)}/repeat`), { weeks });
  return {
    weeksCreated: r.weeks_created,
    shiftsCreated: r.shifts_created,
    weeksSkipped: r.weeks_skipped,
  };
}
