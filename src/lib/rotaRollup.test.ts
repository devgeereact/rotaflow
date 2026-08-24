import { describe, expect, it } from 'vitest';
import {
  dedupeRotasByScope,
  isWeekPublished,
  rotaWeekStatus,
  type RotaScope,
} from './rotaRollup';

const WEEK_START = '2026-08-17';
const WEEK_END = '2026-08-23';

function rota(status: string, overrides: Partial<RotaScope> = {}): RotaScope {
  return {
    status,
    location_id: 'loc-1',
    period_start: WEEK_START,
    period_end: WEEK_END,
    ...overrides,
  };
}

describe('rotaWeekStatus', () => {
  it('reports no rota for an empty week', () => {
    expect(rotaWeekStatus([])).toBe('none');
  });

  it('reports published when the only rota is published', () => {
    expect(rotaWeekStatus([rota('published')])).toBe('published');
  });

  it('reports draft when the only rota is a draft', () => {
    expect(rotaWeekStatus([rota('draft')])).toBe('draft');
  });

  // The exact production failure this module exists to fix. Two rotas for the
  // same org/location/period were created 73ms apart because 0004's partial
  // unique indexes were missing: one published holding every shift, one an
  // empty orphan draft. `overlapping.every(published)` returned false, so
  // staff were told "still a draft, check back" above their real shifts.
  it('reports published when an orphan draft duplicates the published rota', () => {
    expect(rotaWeekStatus([rota('published'), rota('draft')])).toBe('published');
  });

  it('is order-independent — the orphan arriving first must not win', () => {
    expect(rotaWeekStatus([rota('draft'), rota('published')])).toBe('published');
  });

  // The other direction matters just as much: dedupe must not flatten genuinely
  // distinct scopes into a false "published", or a location still being drafted
  // would be announced to its staff as ready.
  it('reports draft when a second location is still drafting', () => {
    expect(
      rotaWeekStatus([rota('published'), rota('draft', { location_id: 'loc-2' })]),
    ).toBe('draft');
  });

  it('treats a null location as its own scope, not as a wildcard', () => {
    expect(
      rotaWeekStatus([rota('published'), rota('draft', { location_id: null })]),
    ).toBe('draft');
  });

  it('does not merge rotas for different periods', () => {
    expect(
      rotaWeekStatus([
        rota('published'),
        rota('draft', { period_start: '2026-08-24', period_end: '2026-08-30' }),
      ]),
    ).toBe('draft');
  });

  it('reports published when every scope has a published rota despite duplicates', () => {
    expect(
      rotaWeekStatus([
        rota('draft'),
        rota('published'),
        rota('published', { location_id: 'loc-2' }),
        rota('draft', { location_id: 'loc-2' }),
      ]),
    ).toBe('published');
  });
});

describe('dedupeRotasByScope', () => {
  it('keeps one rota per location and period', () => {
    const kept = dedupeRotasByScope([
      rota('draft'),
      rota('published'),
      rota('draft', { location_id: 'loc-2' }),
    ]);
    expect(kept).toHaveLength(2);
  });

  it('prefers the published rota, matching findRotaForPeriod', () => {
    const kept = dedupeRotasByScope([rota('draft'), rota('published')]);
    expect(kept.map((r) => r.status)).toEqual(['published']);
  });

  it('keeps the first when neither is published', () => {
    const kept = dedupeRotasByScope([
      rota('draft', { period_start: WEEK_START }),
      rota('archived'),
    ]);
    expect(kept.map((r) => r.status)).toEqual(['draft']);
  });

  it('preserves extra fields on the winning row', () => {
    const withId = { ...rota('published'), id: 'keeper' };
    const kept = dedupeRotasByScope([{ ...rota('draft'), id: 'orphan' }, withId]);
    expect(kept[0]?.id).toBe('keeper');
  });
});

// 0061 added a third status. A superseded version of a week is history: it is
// never shown to staff and, crucially, is not evidence about the week's
// current state. Left in the set it would make `every(published)` false and
// relabel a published week as a draft — BUG-007's failure, reintroduced by the
// fix for BUG-028.
describe('archived rotas (0061 amendments)', () => {
  it('ignores the superseded version of a published week', () => {
    expect(rotaWeekStatus([rota('published'), rota('archived')])).toBe('published');
  });

  it('ignores it whichever order it arrives in', () => {
    expect(rotaWeekStatus([rota('archived'), rota('published')])).toBe('published');
  });

  it('reports published while an amendment of that week is open', () => {
    // The amendment is a draft, but staff are still being shown the published
    // rota it supersedes — so the week is published, not draft.
    expect(rotaWeekStatus([rota('published'), rota('draft'), rota('archived')])).toBe(
      'published',
    );
  });

  it('reports none for a week whose only rota is archived', () => {
    // Nothing is published and nothing is in progress: there is no current
    // rota for this week, which is not the same as a draft awaiting work.
    expect(rotaWeekStatus([rota('archived')])).toBe('none');
  });

  it('keeps a second location honest — archived elsewhere, draft here', () => {
    expect(
      rotaWeekStatus([
        rota('published'),
        rota('archived'),
        rota('draft', { location_id: 'loc-2' }),
      ]),
    ).toBe('draft');
  });

  it('drops archived rows from the deduped set entirely', () => {
    const kept = dedupeRotasByScope([rota('archived'), rota('published')]);
    expect(kept.map((r) => r.status)).toEqual(['published']);
  });
});

describe('isWeekPublished', () => {
  it('is false for a week with no rota at all', () => {
    expect(isWeekPublished([])).toBe(false);
  });

  it('agrees with rotaWeekStatus on the orphan-draft case', () => {
    expect(isWeekPublished([rota('published'), rota('draft')])).toBe(true);
  });
});
