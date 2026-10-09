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

/** The minimum shape `dropSupersededShifts` reads off a shift row. */
export interface ShiftVersion {
  rota_id: string | null;
  rota?: { status?: string | null; supersedes_rota_id?: string | null } | null;
}

/**
 * One version of a week, never two.
 *
 * A manager amending a published week gets a second rota for the same scope:
 * `begin_rota_revision` copies every shift into a draft that carries
 * `supersedes_rota_id`, and the published version stays exactly as it is so
 * staff keep working to it. That is the right database shape, and it means a
 * draft-inclusive read (`publishedOnly: false`) returns **both copies** of
 * every shift in that week.
 *
 * It is not a display nicety. `/app/timesheets` reads the week draft-inclusive
 * and is the screen payroll is signed off from: with an amendment open it
 * showed every person twice, doubled "planned" hours, and doubled the
 * awaiting-approval count. The manager dashboard's cover chart and the
 * manager's day on `/app/schedule` read the same way.
 *
 * The amendment is the version being worked on, so it wins and the rota it
 * supersedes drops out. A published-only read never needs this: the draft is
 * already filtered out there, which is exactly what keeps staff on the
 * published version.
 */
export function dropSupersededShifts<T extends ShiftVersion>(rows: T[]): T[] {
  const superseded = new Set<string>();
  for (const row of rows) {
    const supersedes = row.rota?.supersedes_rota_id;
    // Only a live amendment supersedes anything. An archived predecessor is
    // history and is not in a draft-inclusive read to begin with.
    if (supersedes && row.rota?.status === 'draft') superseded.add(supersedes);
  }
  if (superseded.size === 0) return rows;
  return rows.filter((row) => row.rota_id === null || !superseded.has(row.rota_id));
}
