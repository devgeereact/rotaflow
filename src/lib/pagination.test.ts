import { describe, expect, it, vi } from 'vitest';
import { fetchAllPages } from '@/lib/pagination';

/**
 * RF-09 — a query that hits the API row cap must not look like a complete one.
 *
 * The audited loaders issued one request and returned whatever came back.
 * PostgREST caps a response at `max_rows`, so an organisation with more than
 * a page of clock events in a period had its report quietly cut short: no
 * error, no partial-result indicator, and a total that was simply wrong.
 */
describe('fetchAllPages', () => {
  it('keeps reading while pages come back full', async () => {
    const rows = Array.from({ length: 2500 }, (_, i) => i);
    const fetchPage = vi.fn((from: number, to: number) =>
      Promise.resolve(rows.slice(from, to + 1)),
    );

    const all = await fetchAllPages(fetchPage, { pageSize: 1000 });

    expect(all).toHaveLength(2500);
    expect(all[2499]).toBe(2499);
    // Three full-ish pages: 1000, 1000, 500. The third is short, so it stops.
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('asks once more when the last page is exactly full', async () => {
    const rows = Array.from({ length: 2000 }, (_, i) => i);
    const fetchPage = vi.fn((from: number, to: number) =>
      Promise.resolve(rows.slice(from, to + 1)),
    );

    const all = await fetchAllPages(fetchPage, { pageSize: 1000 });

    expect(all).toHaveLength(2000);
    // A full final page is indistinguishable from a truncated one, so it has
    // to ask. Two pages plus one empty confirmation.
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('returns a single short page without a second request', async () => {
    const fetchPage = vi.fn(() => Promise.resolve([1, 2, 3]));
    expect(await fetchAllPages(fetchPage, { pageSize: 1000 })).toEqual([1, 2, 3]);
    expect(fetchPage).toHaveBeenCalledTimes(1);
  });

  it('handles an empty result', async () => {
    expect(await fetchAllPages(() => Promise.resolve([]), { pageSize: 10 })).toEqual([]);
  });

  it('throws rather than silently truncating past the guard', async () => {
    const fetchPage = (): Promise<number[]> =>
      Promise.resolve(Array.from({ length: 10 }, (_, i) => i));
    await expect(fetchAllPages(fetchPage, { pageSize: 10, maxRows: 30 })).rejects.toThrow(
      /Refusing to read more than 30 rows/,
    );
  });
});
