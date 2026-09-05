/**
 * Read every row of a query, not just the first page.
 *
 * RF-09. Supabase's PostgREST applies a server-side row cap — 1,000 by
 * default, and `supabase/config.toml` sets `max_rows` for the local stack —
 * and a query that returns exactly the cap is indistinguishable from one that
 * returned everything. Every clock, shift and report loader in this project
 * took the single page it got back and treated it as the whole answer. A
 * report over a large organisation's month is well past 1,000 clock events, so
 * the totals were simply short, silently, with no error and nothing on screen
 * to suggest it.
 *
 * Raising `max_rows` is not the fix and never was: it moves the cliff rather
 * than removing it, and a bigger unpaginated read is still an unbounded one.
 *
 * The page fetcher must apply a deterministic total order — a unique
 * tie-breaker, not just a timestamp — or a row can be skipped between pages
 * when two share the ordering value. Every caller here orders by an instant
 * and then by `id`.
 */
export const DEFAULT_PAGE_SIZE = 1000;

export interface PagedFetchOptions {
  /**
   * Rows per request. Must not exceed the server's own cap: asking for more
   * than PostgREST will return makes the short page look like the last one,
   * which is the exact failure this function exists to remove.
   */
  pageSize?: number;
  /**
   * Refuse to keep reading past this many rows. A guard against a query whose
   * predicate is wrong, not a business limit — reaching it throws rather than
   * quietly truncating, because a truncated payroll total is the thing we are
   * trying to stop happening.
   */
  maxRows?: number;
}

export const DEFAULT_MAX_ROWS = 100_000;

export async function fetchAllPages<T>(
  fetchPage: (from: number, to: number) => Promise<T[]>,
  options: PagedFetchOptions = {},
): Promise<T[]> {
  const pageSize = options.pageSize ?? DEFAULT_PAGE_SIZE;
  const maxRows = options.maxRows ?? DEFAULT_MAX_ROWS;
  const all: T[] = [];

  for (let from = 0; ; from += pageSize) {
    const page = await fetchPage(from, from + pageSize - 1);
    all.push(...page);

    // A short page is the last page. A full one might be, but asking again is
    // the only way to know, and one extra empty request is cheaper than an
    // undercounted timesheet.
    if (page.length < pageSize) return all;

    if (all.length >= maxRows) {
      throw new Error(
        `Refusing to read more than ${maxRows} rows in one query. Narrow the period rather than returning a partial answer.`,
      );
    }
  }
}
