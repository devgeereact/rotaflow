/**
 * Paging arithmetic for a list the database pages, not the browser.
 *
 * `src/lib/filters.ts` has `paginate()`, which slices an array the client
 * already holds. That is the right tool when the whole set is small enough to
 * load, and the wrong one everywhere else: it can only page what was
 * returned, so above PostgREST's `db.max_rows` cap it pages a truncated array
 * and reports the truncation as the total.
 *
 * These helpers are the other half. The server returns one page and the exact
 * count of everything matching the same predicates; this turns that pair into
 * the numbers a "showing 21-40 of 137" line, a page control and a bulk-action
 * scope all need — without ever inferring a total from a page length.
 */

export interface ServerPage<T> {
  rows: readonly T[];
  /** Rows matching the predicates, before the page was taken. From the server. */
  total: number;
  /** 1-based. */
  page: number;
  pageSize: number;
  pageCount: number;
  /** 1-based index of the first row shown, or 0 when there are none. */
  from: number;
  to: number;
}

export const DEFAULT_PAGE_SIZE = 25;

/**
 * The database's own ceiling on one page.
 *
 * Mirrors the `least(greatest(...), 200)` clamp in
 * `platform_organisation_directory` (0130). Stated here as well so a caller
 * asking for 1,000 rows is corrected before the round trip rather than
 * silently given 200 and left to believe it received everything.
 */
export const MAX_PAGE_SIZE = 200;

export function clampPageSize(requested: number | undefined): number {
  if (!Number.isFinite(requested) || requested === undefined) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_PAGE_SIZE);
}

/** 1-based page to a zero-based row offset. */
export function offsetFor(page: number, pageSize: number): number {
  const safePage = Number.isFinite(page) ? Math.max(1, Math.trunc(page)) : 1;
  return (safePage - 1) * clampPageSize(pageSize);
}

/**
 * Assemble the page description from what came back.
 *
 * `total` is the server's count under the same predicates, never
 * `rows.length`. The two differ on every page but the last, and treating a
 * page length as a result count is how a table says "3 results" about a
 * search that matched 137.
 */
export function serverPage<T>(input: {
  rows: readonly T[];
  total: number;
  page: number;
  pageSize: number;
}): ServerPage<T> {
  const pageSize = clampPageSize(input.pageSize);
  const total = Math.max(0, Math.trunc(input.total));
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(Math.max(1, Math.trunc(input.page)), pageCount);
  const start = (page - 1) * pageSize;
  return {
    rows: input.rows,
    total,
    page,
    pageSize,
    pageCount,
    from: total === 0 || input.rows.length === 0 ? 0 : start + 1,
    to: total === 0 ? 0 : Math.min(total, start + input.rows.length),
  };
}

/** What an export covered, and whether it covered all of it. */
export interface FetchAllResult<T> {
  rows: T[];
  /** The server's count for the predicates, whether or not every row was read. */
  total: number;
  /**
   * True when the walk stopped at `maxRows` before exhausting the match set.
   *
   * The caller must say so. An export labelled "all 4,300 organisations" that
   * holds 2,000 of them is worse than one that refuses, because nothing about
   * the file says which 2,000.
   */
  truncated: boolean;
}

/**
 * Read every matching row by walking the server's pages.
 *
 * Exists because "export the filtered set" and "show me a page" are different
 * questions with the same predicates, and answering the first with the second
 * is the bug this module was written for. The walk is bounded: an export is a
 * file a person opens, not a database dump, and an unbounded loop against a
 * growing table is a way to hang a browser tab.
 *
 * It stops on three conditions — the total is reached, a page comes back
 * short, or `maxRows` is hit — and the third is reported rather than hidden.
 */
export async function fetchAllPages<T>(
  fetchPage: (offset: number, limit: number) => Promise<{ rows: T[]; total: number }>,
  options: { pageSize?: number; maxRows?: number } = {},
): Promise<FetchAllResult<T>> {
  const pageSize = clampPageSize(options.pageSize ?? MAX_PAGE_SIZE);
  const maxRows = Math.max(1, options.maxRows ?? 10_000);

  const rows: T[] = [];
  let offset = 0;
  let total = 0;

  for (;;) {
    const page = await fetchPage(offset, Math.min(pageSize, maxRows - rows.length));
    total = page.total;
    rows.push(...page.rows);

    // A short page means the server had nothing more to give, whatever the
    // total said. Trusting the total alone loops forever if a row is deleted
    // between two pages.
    if (page.rows.length === 0) break;
    if (rows.length >= total) break;
    if (rows.length >= maxRows) return { rows, total, truncated: rows.length < total };
    offset = rows.length;
  }

  return { rows, total, truncated: rows.length < total };
}
