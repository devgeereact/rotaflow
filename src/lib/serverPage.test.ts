import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  clampPageSize,
  fetchAllPages,
  offsetFor,
  serverPage,
} from './serverPage';

describe('clampPageSize', () => {
  it('falls back to the default when nothing was asked for', () => {
    expect(clampPageSize(undefined)).toBe(DEFAULT_PAGE_SIZE);
  });

  it('refuses a page larger than the database will return', () => {
    // 0130 clamps to 200 server-side. Asking for 1,000 and receiving 200 with
    // no complaint is exactly the silent truncation this module exists to stop.
    expect(clampPageSize(1000)).toBe(MAX_PAGE_SIZE);
  });

  it('refuses zero and negative pages', () => {
    expect(clampPageSize(0)).toBe(1);
    expect(clampPageSize(-5)).toBe(1);
  });
});

describe('offsetFor', () => {
  it('is zero on the first page', () => {
    expect(offsetFor(1, 25)).toBe(0);
  });

  it('counts whole pages, not rows returned', () => {
    expect(offsetFor(4, 25)).toBe(75);
  });

  it('treats a nonsense page as the first', () => {
    expect(offsetFor(0, 25)).toBe(0);
    expect(offsetFor(Number.NaN, 25)).toBe(0);
  });
});

describe('serverPage', () => {
  it('reports the server total, not the number of rows returned', () => {
    const page = serverPage({ rows: [1, 2, 3], total: 137, page: 1, pageSize: 3 });
    expect(page.total).toBe(137);
    expect(page.pageCount).toBe(46);
    expect(page.from).toBe(1);
    expect(page.to).toBe(3);
  });

  it('describes a middle page as a range within the total', () => {
    const page = serverPage({
      rows: Array.from({ length: 20 }, (_, i) => i),
      total: 137,
      page: 2,
      pageSize: 20,
    });
    expect(page.from).toBe(21);
    expect(page.to).toBe(40);
  });

  it('describes a short last page by what actually arrived', () => {
    const page = serverPage({ rows: [1, 2], total: 22, page: 3, pageSize: 10 });
    expect(page.from).toBe(21);
    expect(page.to).toBe(22);
  });

  it('clamps a page past the end rather than showing an empty page 9', () => {
    const page = serverPage({ rows: [], total: 12, page: 9, pageSize: 10 });
    expect(page.page).toBe(2);
  });

  it('reads as empty, not as page one of one row', () => {
    const page = serverPage({ rows: [], total: 0, page: 1, pageSize: 25 });
    expect(page.total).toBe(0);
    expect(page.from).toBe(0);
    expect(page.to).toBe(0);
    expect(page.pageCount).toBe(1);
  });
});

describe('fetchAllPages', () => {
  const rowsFor = (offset: number, limit: number, total: number): number[] =>
    Array.from(
      { length: Math.max(0, Math.min(limit, total - offset)) },
      (_, i) => offset + i,
    );

  it('walks past the first page — the whole point of it', async () => {
    const fetchPage = vi.fn((offset: number, limit: number) =>
      Promise.resolve({ rows: rowsFor(offset, limit, 450), total: 450 }),
    );

    const result = await fetchAllPages(fetchPage, { pageSize: 200 });

    expect(result.rows).toHaveLength(450);
    expect(result.truncated).toBe(false);
    expect(fetchPage).toHaveBeenCalledTimes(3);
  });

  it('says so when it stopped at the cap instead of quietly returning less', async () => {
    const result = await fetchAllPages(
      (offset: number, limit: number) =>
        Promise.resolve({ rows: rowsFor(offset, limit, 5000), total: 5000 }),
      { pageSize: 200, maxRows: 400 },
    );

    expect(result.rows).toHaveLength(400);
    expect(result.total).toBe(5000);
    expect(result.truncated).toBe(true);
  });

  it('stops on a short page even when the total disagrees', async () => {
    // A row deleted between two pages leaves the total higher than what can be
    // read. Trusting the total alone loops until the tab dies.
    let call = 0;
    const result = await fetchAllPages(
      () => {
        call += 1;
        return Promise.resolve(
          call === 1 ? { rows: [1, 2, 3], total: 99 } : { rows: [], total: 99 },
        );
      },
      { pageSize: 3 },
    );

    expect(result.rows).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it('reads nothing when nothing matched', async () => {
    const result = await fetchAllPages(() => Promise.resolve({ rows: [], total: 0 }), {
      pageSize: 50,
    });
    expect(result.rows).toEqual([]);
    expect(result.truncated).toBe(false);
  });
});
