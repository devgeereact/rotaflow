import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Rota } from '@/types';

/**
 * HARDEN-006 — the builder resolves every location's rota in one round trip.
 *
 * It used to call `findRotaForPeriod` then a shift fetch per location, so
 * changing the week cost two queries per site and each rota lookup scanned
 * every rota the org had ever had. `Promise.all` hid the latency behind itself
 * but the database still did the work N times.
 *
 * The risk in batching is not speed, it is disagreement: two code paths
 * answering "which rota is this week?" differently is precisely BUG-007, which
 * is why `rotaService` says precedence is decided in one place. So what these
 * tests pin is that the batch path applies the SAME rule — amendment over
 * published, published over draft — and that it groups by location correctly,
 * since a bug there would silently show one site's shifts under another.
 */

let rotaRows: Rota[] = [];
let shiftRows: { id: string; rota_id: string }[] = [];
/** Every filter the fake builder saw, so "did it query at all" is assertable. */
const queries: { table: string; filters: [string, unknown][] }[] = [];

vi.mock('@/lib/supabase', () => {
  // eslint-disable-next-line @typescript-eslint/explicit-function-return-type
  const from = (table: string) => {
    const record: { table: string; filters: [string, unknown][] } = {
      table,
      filters: [],
    };
    const rows = (): unknown[] => (table === 'rotas' ? rotaRows : shiftRows);
    const builder = {
      select() {
        queries.push(record);
        return builder;
      },
      eq(column: string, value: unknown) {
        record.filters.push([column, value]);
        return builder;
      },
      in(column: string, value: unknown) {
        record.filters.push([column, value]);
        return builder;
      },
      is(column: string, value: unknown) {
        record.filters.push([column, value]);
        return builder;
      },
      // Chainable AND awaitable: PostgREST allows several `.order()` calls
      // and only resolves when awaited, so the fake has to do both.
      order() {
        return builder;
      },
      then(
        resolve: (value: { data: unknown[]; error: null }) => unknown,
      ): Promise<unknown> {
        return Promise.resolve(resolve({ data: rows(), error: null }));
      },
    };
    return builder;
  };
  return { supabase: { from } };
});

const { pickRotaToOpen, resolveRotaRows, resolveRotasForLocations } =
  await import('@/services/rotaService');
const { listShiftsForRotas } = await import('@/services/shiftService');

/** Only the fields precedence actually reads; the rest of `Rota` is noise here. */
function rota(partial: {
  id: string;
  status: string;
  location_id: string | null;
  supersedes_rota_id?: string | null;
}): Rota {
  return {
    id: partial.id,
    org_id: 'org-1',
    location_id: partial.location_id,
    name: 'Week of 2026-08-31',
    period_start: '2026-08-31',
    period_end: '2026-09-06',
    status: partial.status,
    supersedes_rota_id: partial.supersedes_rota_id ?? null,
  } as unknown as Rota;
}

const PERIOD = {
  orgId: 'org-1',
  periodStart: '2026-08-31',
  periodEnd: '2026-09-06',
};

beforeEach(() => {
  rotaRows = [];
  shiftRows = [];
  queries.length = 0;
});

describe('resolveRotaRows', () => {
  it('prefers an open amendment over the published rota it supersedes', () => {
    const resolution = resolveRotaRows([
      rota({
        id: 'draft-1',
        status: 'draft',
        location_id: 'loc-1',
        supersedes_rota_id: 'pub-1',
      }),
      rota({ id: 'pub-1', status: 'published', location_id: 'loc-1' }),
    ]);
    expect(resolution.isAmendment).toBe(true);
    expect(pickRotaToOpen(resolution)?.id).toBe('draft-1');
  });

  it('prefers the published rota over a plain draft, which is what staff already see', () => {
    const resolution = resolveRotaRows([
      rota({ id: 'draft-2', status: 'draft', location_id: 'loc-1' }),
      rota({ id: 'pub-2', status: 'published', location_id: 'loc-1' }),
    ]);
    expect(resolution.isAmendment).toBe(false);
    expect(pickRotaToOpen(resolution)?.id).toBe('pub-2');
  });

  it('opens the draft when the week was never published', () => {
    const resolution = resolveRotaRows([
      rota({ id: 'draft-3', status: 'draft', location_id: 'loc-1' }),
    ]);
    expect(pickRotaToOpen(resolution)?.id).toBe('draft-3');
  });

  it('keeps archived versions out of the answer entirely', () => {
    const resolution = resolveRotaRows([
      rota({ id: 'old-1', status: 'archived', location_id: 'loc-1' }),
      rota({ id: 'old-2', status: 'archived', location_id: 'loc-1' }),
    ]);
    expect(resolution.archived.map((r) => r.id)).toEqual(['old-1', 'old-2']);
    expect(pickRotaToOpen(resolution)).toBeNull();
  });
});

describe('resolveRotasForLocations', () => {
  it('groups by location and applies the same precedence to each', async () => {
    rotaRows = [
      // loc-1: an amendment in progress.
      rota({
        id: 'a-draft',
        status: 'draft',
        location_id: 'loc-1',
        supersedes_rota_id: 'a-pub',
      }),
      rota({ id: 'a-pub', status: 'published', location_id: 'loc-1' }),
      // loc-2: published, nobody amending.
      rota({ id: 'b-pub', status: 'published', location_id: 'loc-2' }),
      rota({ id: 'b-draft', status: 'draft', location_id: 'loc-2' }),
    ];

    const byLocation = await resolveRotasForLocations({
      ...PERIOD,
      locationIds: ['loc-1', 'loc-2', 'loc-3'],
    });

    const first = byLocation.get('loc-1');
    const second = byLocation.get('loc-2');
    expect(first && pickRotaToOpen(first)?.id).toBe('a-draft');
    expect(second && pickRotaToOpen(second)?.id).toBe('b-pub');
    // A site nobody has scheduled is absent, not an empty resolution — the
    // caller decides whether to create, because creating is a write.
    expect(byLocation.has('loc-3')).toBe(false);
  });

  it('asks for the whole period in one query, not one per location', async () => {
    rotaRows = [rota({ id: 'a', status: 'draft', location_id: 'loc-1' })];
    await resolveRotasForLocations({
      ...PERIOD,
      locationIds: ['loc-1', 'loc-2', 'loc-3'],
    });
    // The point of the change: three sites, one round trip.
    expect(queries).toHaveLength(1);
    expect(queries[0]?.filters).toContainEqual([
      'location_id',
      ['loc-1', 'loc-2', 'loc-3'],
    ]);
  });

  it('ignores an org-wide rota, which has no location to group under', async () => {
    rotaRows = [rota({ id: 'orgwide', status: 'draft', location_id: null })];
    const byLocation = await resolveRotasForLocations({
      ...PERIOD,
      locationIds: ['loc-1'],
    });
    expect(byLocation.size).toBe(0);
  });

  it('does not query at all for an org with no locations', async () => {
    const byLocation = await resolveRotasForLocations({ ...PERIOD, locationIds: [] });
    expect(byLocation.size).toBe(0);
    // `in('location_id', [])` is valid SQL that matches nothing, so this is a
    // wasted round trip rather than an error — which is exactly why it is easy
    // to leave in.
    expect(queries).toHaveLength(0);
  });
});

describe('listShiftsForRotas', () => {
  it('fetches every rota’s shifts in one query', async () => {
    shiftRows = [
      { id: 's1', rota_id: 'r1' },
      { id: 's2', rota_id: 'r2' },
    ];
    const rows = await listShiftsForRotas(['r1', 'r2']);
    expect(rows.map((r) => r.id)).toEqual(['s1', 's2']);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.filters).toContainEqual(['rota_id', ['r1', 'r2']]);
  });

  it('short-circuits on an empty list', async () => {
    expect(await listShiftsForRotas([])).toEqual([]);
    expect(queries).toHaveLength(0);
  });
});
