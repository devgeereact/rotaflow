/**
 * Rolling a set of overlapping rotas up into one week status.
 *
 * Two callers need this — the manager dashboard and the staff schedule — and
 * they had drifted into `overlapping.every(r => r.status === 'published')`,
 * which disagrees with `findRotaForPeriod`'s "a published rota wins over a
 * draft for the same scope". That disagreement is only invisible while one
 * rota exists per scope, which is what 0004's partial unique indexes were
 * supposed to guarantee — and those indexes turned out to be missing in
 * production, so duplicates existed and the two rules gave opposite answers.
 *
 * The observed failure: an empty orphan draft alongside the published rota
 * holding all the shifts made `every` false, so the manager dashboard and the
 * staff schedule both announced "Draft — not visible to staff" while the
 * Rota Builder said published, and staff read "still a draft, check back"
 * printed directly above their real published shifts. That is the
 * Draft ≠ Published distinction failing in the direction that leaves a shift
 * uncovered, because staff are given an explicit reason not to turn up.
 *
 * So the rollup is defined once, here, with the same precedence
 * findRotaForPeriod already uses.
 */

/** The minimum shape the rollup needs. Keeps this usable from any caller. */
export interface RotaScope {
  status: string;
  location_id: string | null;
  period_start: string;
  period_end: string;
}

export type RotaWeekStatus = 'none' | 'draft' | 'published';

/**
 * Superseded versions of a week (0061). They are history: never shown to
 * staff, never edited, and — the reason they are filtered here rather than
 * left to each caller — never evidence about the week's current status. An
 * archived rota left in the set would make `every(published)` false and
 * relabel a published week as a draft, which is the exact shape of BUG-007.
 */
function isCurrent(rota: RotaScope): boolean {
  return rota.status !== 'archived';
}

/**
 * One rota per (location, period) — the shape 0004's unique indexes describe.
 * Where duplicates exist a published one wins, matching findRotaForPeriod.
 *
 * This is deliberately tolerant rather than corrective: it does not assume the
 * database constraint holds. Restoring the index stops new duplicates, but
 * rows created while it was missing survive, and a rollup that only works on
 * clean data would keep mislabelling those weeks.
 */
export function dedupeRotasByScope<T extends RotaScope>(rotas: T[]): T[] {
  const winners = new Map<string, T>();
  for (const rota of rotas.filter(isCurrent)) {
    const key = `${rota.location_id ?? ''}|${rota.period_start}|${rota.period_end}`;
    const held = winners.get(key);
    if (!held || (held.status !== 'published' && rota.status === 'published')) {
      winners.set(key, rota);
    }
  }
  return [...winners.values()];
}

/**
 * The week's status across every rota overlapping it.
 *
 * `every` is kept, not replaced by `some`: a genuine multi-location org can
 * have one location published and another still drafting, and that week is
 * honestly still a draft for somebody. What changes is what `every` runs
 * over — one rota per scope rather than every duplicate row, so a stale
 * empty draft can no longer outvote the published rota it duplicates.
 */
export function rotaWeekStatus(overlapping: RotaScope[]): RotaWeekStatus {
  const scoped = dedupeRotasByScope(overlapping);
  if (scoped.length === 0) return 'none';
  return scoped.every((r) => r.status === 'published') ? 'published' : 'draft';
}

/** Convenience for callers that only need the boolean. */
export function isWeekPublished(overlapping: RotaScope[]): boolean {
  return rotaWeekStatus(overlapping) === 'published';
}
