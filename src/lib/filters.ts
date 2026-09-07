/**
 * One filter contract for the whole workspace.
 *
 * ## What was wrong
 *
 * Every filterable screen had grown its own version. `StaffPage` held three
 * `useState` strings and a `useMemo` predicate; `RotaBuilderPage` held eight;
 * the reports catalogue filtered a hard-coded array while the report *data*
 * behind it was filtered somewhere else entirely. None of them survived a
 * reload, none appeared in the URL, none could be linked to, and each one had
 * decided separately what an empty string meant, whether search was
 * case-sensitive, and whether a filter that matched nothing was different from
 * a query that failed.
 *
 * The individual bugs that came out of that are the reason this module is
 * shared rather than convenient: a directory filter that silently dropped every
 * inactive person so the Reactivate action could never be reached; a location
 * filter left pointing at another tenant's site after an organisation switch; a
 * "no results" panel shown for a request that had actually errored.
 *
 * ## The contract
 *
 * - **Dimensions are declared, with stable ids.** The id is the URL key and the
 *   test fixture key, so renaming a label never breaks a saved link.
 * - **Different dimensions combine with AND. Values inside one dimension
 *   combine with OR.** Location `A or B` *and* status `active` — which is what
 *   a person means when they tick two sites.
 * - **Text is normalised for matching and preserved for display.** The stored
 *   value is what the user typed; matching trims, collapses whitespace and
 *   lowercases a copy.
 * - **Search punctuation is literal.** `O'Brien` and `(bank)` match themselves.
 *   Nothing here builds a regular expression from user input, and the
 *   server-side helpers escape PostgREST's own metacharacters rather than
 *   interpolating a term into a filter string.
 * - **Filter and sort, then paginate.** Never the other way round: paginating
 *   first and filtering the page is how a search finds three of the eleven
 *   people it matched.
 * - **A dimension's values are pruned when its scope changes.** Switching
 *   organisation or site drops values that no longer exist and reports which,
 *   so the screen can explain the change instead of silently showing everything.
 */

/** Selected values, keyed by dimension id. An absent or empty entry is "no filter". */
export type FilterState = Readonly<Record<string, readonly string[]>>;

export type FilterKind =
  /** Free text. Exactly one value, matched as a literal substring. */
  | 'text'
  /** One id from a list. */
  | 'select'
  /** Any number of ids from a list; they OR together. */
  | 'multi'
  /** A single 'YYYY-MM-DD'. */
  | 'date'
  /** Exactly two 'YYYY-MM-DD' values, `[from, to]`. */
  | 'daterange';

export interface FilterOption {
  value: string;
  label: string;
}

export interface FilterDimension {
  /** Stable. This is the URL key; changing it invalidates saved links. */
  id: string;
  label: string;
  kind: FilterKind;
  /**
   * Keep this dimension's value out of the URL and out of anything logged.
   *
   * Set on free-text person search. A shareable link carrying a colleague's
   * name or an employee number turns a convenience into a disclosure the
   * moment it is pasted into a ticket, and it lands in server logs on the way
   * there. The filter still works; it just does not travel.
   */
  sensitive?: boolean;
  /**
   * The value the screen starts on, used to decide whether a dimension counts
   * as "applied" and what Clear all returns to. A status filter that defaults
   * to `active` is not an applied filter.
   */
  defaultValues?: readonly string[];
}

export const EMPTY_FILTERS: FilterState = Object.freeze({});

export function filterValues(state: FilterState, id: string): readonly string[] {
  return state[id] ?? [];
}

/** The single value of a one-value dimension, or `''`. */
export function filterValue(state: FilterState, id: string): string {
  return filterValues(state, id)[0] ?? '';
}

export function setFilterValues(
  state: FilterState,
  id: string,
  values: readonly string[],
): FilterState {
  const next: Record<string, readonly string[]> = { ...state };
  const cleaned = values.filter((v) => v !== '');
  if (cleaned.length === 0) delete next[id];
  else next[id] = cleaned;
  return next;
}

export function setFilterValue(
  state: FilterState,
  id: string,
  value: string,
): FilterState {
  return setFilterValues(state, id, value === '' ? [] : [value]);
}

export function toggleFilterValue(
  state: FilterState,
  id: string,
  value: string,
): FilterState {
  const current = filterValues(state, id);
  return setFilterValues(
    state,
    id,
    current.includes(value) ? current.filter((v) => v !== value) : [...current, value],
  );
}

export function clearFilter(state: FilterState, id: string): FilterState {
  return setFilterValues(state, id, []);
}

/** Back to every dimension's declared default, not to nothing. */
export function clearAllFilters(dimensions: readonly FilterDimension[]): FilterState {
  let next: FilterState = EMPTY_FILTERS;
  for (const dimension of dimensions) {
    if (dimension.defaultValues?.length) {
      next = setFilterValues(next, dimension.id, dimension.defaultValues);
    }
  }
  return next;
}

function sameValues(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

/** Whether a dimension is holding something other than its default. */
export function isDimensionApplied(
  state: FilterState,
  dimension: FilterDimension,
): boolean {
  const values = filterValues(state, dimension.id);
  if (values.length === 0) return false;
  return !sameValues(values, dimension.defaultValues ?? []);
}

export function activeFilterCount(
  state: FilterState,
  dimensions: readonly FilterDimension[],
): number {
  return dimensions.filter((dimension) => isDimensionApplied(state, dimension)).length;
}

export interface FilterChip {
  dimensionId: string;
  dimensionLabel: string;
  value: string;
  /** What to print. The option's own label, so the display name is preserved. */
  label: string;
}

/**
 * The removable chips above a table.
 *
 * A sensitive dimension still gets a chip — the person typing needs to see
 * that a search is applied — it simply never reaches the URL.
 */
export function filterChips(
  state: FilterState,
  dimensions: readonly FilterDimension[],
  optionsFor: (dimensionId: string) => readonly FilterOption[],
): FilterChip[] {
  const chips: FilterChip[] = [];
  for (const dimension of dimensions) {
    if (!isDimensionApplied(state, dimension)) continue;
    const options = optionsFor(dimension.id);
    for (const value of filterValues(state, dimension.id)) {
      chips.push({
        dimensionId: dimension.id,
        dimensionLabel: dimension.label,
        value,
        label: options.find((option) => option.value === value)?.label ?? value,
      });
    }
  }
  return chips;
}

/* ------------------------------------------------------------------ */
/* Text matching                                                       */
/* ------------------------------------------------------------------ */

/** Trim, collapse internal whitespace, lowercase. The matching form only. */
export function normaliseSearchTerm(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Case-insensitive literal substring match across several fields.
 *
 * Every part is joined with a space, so "sarah nurse" matches a row whose name
 * is Sarah and whose job title is Nurse. Punctuation is data, not syntax: no
 * regular expression is constructed from `term`, which is what stops a stray
 * `(` from throwing and a `.*` from matching everything.
 */
export function matchesSearch(
  parts: readonly (string | null | undefined)[],
  term: string,
): boolean {
  const needle = normaliseSearchTerm(term);
  if (needle === '') return true;
  const haystack = normaliseSearchTerm(parts.filter(Boolean).join(' '));
  return haystack.includes(needle);
}

/**
 * Escape a term for a PostgREST `ilike` pattern.
 *
 * `%` and `_` are wildcards there. A person searching for `50_%` means those
 * characters; unescaped, the query returns everybody. PostgREST's own escape
 * character is a backslash, which therefore has to be escaped first.
 */
export function escapeLikePattern(term: string): string {
  return term.replace(/\\/g, '\\\\').replace(/[%_]/g, (char) => `\\${char}`);
}

/**
 * Escape a value going into a PostgREST `or=(…)` list.
 *
 * The list is comma-separated and parenthesised, so a comma, a bracket or a
 * quote inside a user's search term changes the *shape* of the filter rather
 * than its content. Double-quoting the value and escaping any quote inside it
 * is what PostgREST documents for exactly this.
 */
export function escapeOrValue(term: string): string {
  return `"${term.replace(/["\\]/g, (char) => `\\${char}`)}"`;
}

/** A ready-to-send `ilike` pattern for a free-text term, wildcards and all escaped. */
export function ilikePattern(term: string): string {
  return `%${escapeLikePattern(term.trim())}%`;
}

/* ------------------------------------------------------------------ */
/* URL state                                                           */
/* ------------------------------------------------------------------ */

export interface UrlFilterOptions {
  /** 1-based. Omitted from the URL when it is 1. */
  page?: number;
  sort?: string;
  direction?: 'asc' | 'desc';
}

/**
 * Serialise filters, sort and page into search params.
 *
 * Multi-valued dimensions are written as repeated keys rather than a joined
 * string, so a value containing the separator cannot split into two. Sensitive
 * dimensions are omitted entirely — deliberately, not as an oversight, so that
 * a link a manager pastes into a support ticket cannot carry a colleague's name.
 */
export function serialiseFilters(
  state: FilterState,
  dimensions: readonly FilterDimension[],
  options: UrlFilterOptions = {},
): URLSearchParams {
  const params = new URLSearchParams();
  for (const dimension of dimensions) {
    if (dimension.sensitive) continue;
    if (!isDimensionApplied(state, dimension)) continue;
    for (const value of filterValues(state, dimension.id)) {
      params.append(dimension.id, value);
    }
  }
  if (options.sort) params.set('sort', options.sort);
  if (options.direction && options.direction !== 'asc') {
    params.set('dir', options.direction);
  }
  if (options.page && options.page > 1) params.set('page', String(options.page));
  return params;
}

/**
 * Read filters back out of search params.
 *
 * Anything the screen does not declare is dropped, and so is any value not in
 * the supplied option list. A hand-edited or stale URL therefore degrades to
 * the default view rather than to a filter the screen cannot render or, worse,
 * an id belonging to a different tenant.
 */
export function parseFilters(
  params: URLSearchParams,
  dimensions: readonly FilterDimension[],
  allowedValues?: (dimensionId: string) => readonly string[] | null,
): FilterState {
  let state = clearAllFilters(dimensions);
  for (const dimension of dimensions) {
    if (dimension.sensitive) continue;
    if (!params.has(dimension.id)) continue;
    const allowed = allowedValues?.(dimension.id) ?? null;
    const values = params
      .getAll(dimension.id)
      .filter((value) => value !== '')
      .filter((value) => allowed === null || allowed.includes(value));
    state =
      values.length > 0
        ? setFilterValues(state, dimension.id, values)
        : clearFilter(state, dimension.id);
  }
  return state;
}

export function parsePage(params: URLSearchParams): number {
  const raw = Number(params.get('page'));
  return Number.isInteger(raw) && raw > 0 ? raw : 1;
}

/** Whether two states would produce different rows. Drives "reset to page 1". */
export function filtersEqual(a: FilterState, b: FilterState): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if (!sameValues(filterValues(a, key), filterValues(b, key))) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Scope changes                                                       */
/* ------------------------------------------------------------------ */

export interface PruneResult {
  state: FilterState;
  /** Dimension ids whose values were dropped, so the screen can explain why. */
  dropped: string[];
}

/**
 * Drop values that no longer exist in the current scope.
 *
 * Two situations, and both have shipped as bugs. Changing organisation leaves
 * the previous tenant's location and department ids in state — they match
 * nothing, so the table reads as empty, and worse, they are another customer's
 * identifiers sitting in this customer's URL. Changing the selected location
 * leaves a department that belongs to a different site, which is a legitimate
 * value in the organisation and an impossible one in the current view; the
 * screen needs to say "that department is not at this site" rather than
 * silently show everything.
 */
export function pruneFilterValues(
  state: FilterState,
  allowedValues: (dimensionId: string) => readonly string[] | null,
): PruneResult {
  let next = state;
  const dropped: string[] = [];

  for (const id of Object.keys(state)) {
    const allowed = allowedValues(id);
    if (allowed === null) continue;
    const kept = filterValues(state, id).filter((value) => allowed.includes(value));
    if (kept.length === filterValues(state, id).length) continue;
    dropped.push(id);
    next = setFilterValues(next, id, kept);
  }

  return { state: next, dropped };
}

/* ------------------------------------------------------------------ */
/* Predicates, sorting, pagination                                     */
/* ------------------------------------------------------------------ */

/**
 * How a row supplies the values one dimension is matched against.
 *
 * Returning an array is what makes a many-to-many dimension work: a person
 * assigned to three sites matches a filter on any one of them. Returning
 * `null` means "this row has no value here", which only an explicit
 * unassigned filter matches — see `UNASSIGNED`.
 */
export type FilterAccessor<T> = (row: T) => string | readonly string[] | null;

/**
 * The value used to filter for records with nothing set.
 *
 * "Unassigned" has to be selectable, not merely a gap: a manager looking for
 * the people with no job title recorded cannot find them by choosing one.
 */
export const UNASSIGNED = '__unassigned__';

export function matchesDimension<T>(
  row: T,
  selected: readonly string[],
  accessor: FilterAccessor<T>,
): boolean {
  if (selected.length === 0) return true;
  const raw = accessor(row);
  // `Array.isArray` narrows a `readonly string[]` to `any[]` under this
  // tsconfig, so the branch is written on the string case instead — which
  // narrows cleanly and needs no assertion.
  const values: readonly string[] =
    raw === null ? [] : typeof raw === 'string' ? [raw] : raw;
  if (values.length === 0) return selected.includes(UNASSIGNED);
  // OR within the dimension.
  return values.some((value) => selected.includes(value));
}

/**
 * AND across dimensions, OR inside each. A dimension with no accessor is
 * ignored here, because it is handled by the caller (a date range compared as
 * instants, for instance) rather than as a set membership test.
 */
export function matchesFilters<T>(
  row: T,
  state: FilterState,
  accessors: Readonly<Record<string, FilterAccessor<T>>>,
): boolean {
  for (const [id, accessor] of Object.entries(accessors)) {
    if (!matchesDimension(row, filterValues(state, id), accessor)) return false;
  }
  return true;
}

export interface SortSpec<T> {
  id: string;
  label: string;
  /** Must impose a total order with the tie-breaker below, or paging repeats rows. */
  compare: (a: T, b: T) => number;
}

/**
 * Sort with an explicit tie-breaker.
 *
 * Two rows that compare equal are free to swap between renders, and between
 * pages: one gets read twice and the other never. Every sort here ends on a
 * unique key for that reason.
 */
export function applySort<T>(
  rows: readonly T[],
  spec: SortSpec<T> | null,
  direction: 'asc' | 'desc',
  tieBreak: (row: T) => string,
): T[] {
  const sorted = [...rows];
  const sign = direction === 'desc' ? -1 : 1;
  sorted.sort((a, b) => {
    const primary = spec ? spec.compare(a, b) * sign : 0;
    if (primary !== 0) return primary;
    return tieBreak(a).localeCompare(tieBreak(b));
  });
  return sorted;
}

export interface Page<T> {
  rows: T[];
  /** 1-based, clamped into range. */
  page: number;
  pageCount: number;
  /** Rows matching the predicates, before the page was taken. */
  total: number;
  /** 1-based index of the first row shown, or 0 when there are none. */
  from: number;
  to: number;
}

/**
 * Take one page of already-filtered, already-sorted rows.
 *
 * `total` is the count of everything that matched, which is what a "showing
 * 21-40 of 137" line and a bulk-action scope both need. A page length is not a
 * result count and must never be printed as one.
 */
export function paginate<T>(rows: readonly T[], page: number, pageSize: number): Page<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(1, page), pageCount);
  const start = (current - 1) * pageSize;
  return {
    rows: rows.slice(start, start + pageSize),
    page: current,
    pageCount,
    total,
    from: total === 0 ? 0 : start + 1,
    to: Math.min(total, start + pageSize),
  };
}

/* ------------------------------------------------------------------ */
/* Result states                                                       */
/* ------------------------------------------------------------------ */

/**
 * What a list should render.
 *
 * `error` is a separate state from `no-match` on purpose. A failed request
 * used to fall through to "No staff match these filters", which tells a
 * manager their organisation is empty when in fact the network dropped. A
 * request failure never means no results.
 */
export type ListOutcome = 'loading' | 'error' | 'empty-dataset' | 'no-match' | 'rows';

export function listOutcome(input: {
  loading: boolean;
  failed: boolean;
  totalRows: number;
  matchedRows: number;
}): ListOutcome {
  if (input.loading) return 'loading';
  if (input.failed) return 'error';
  if (input.totalRows === 0) return 'empty-dataset';
  if (input.matchedRows === 0) return 'no-match';
  return 'rows';
}
