import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  clearAllFilters,
  filtersEqual,
  parseFilters,
  parsePage,
  pruneFilterValues,
  serialiseFilters,
  setFilterValue,
  setFilterValues,
  toggleFilterValue,
  type FilterDimension,
  type FilterState,
} from '@/lib/filters';

export interface UseFilterStateOptions {
  dimensions: readonly FilterDimension[];
  /**
   * The values each dimension may legally hold right now.
   *
   * Return `null` for a dimension with an open set (free text, a status
   * enumeration that is already exhaustive). Anything else is pruned when the
   * scope changes — see `pruneFilterValues` for the two bugs that motivated it.
   */
  allowedValues?: (dimensionId: string) => readonly string[] | null;
  /**
   * A value that identifies the current tenant scope. When it changes, values
   * that no longer exist are dropped and `droppedDimensions` names them so the
   * screen can explain the change rather than silently showing everything.
   */
  scopeKey?: string;
  defaultSort?: string;
  defaultDirection?: 'asc' | 'desc';
}

export interface FilterStateApi {
  filters: FilterState;
  /** Free text lives in state like everything else; this is the shorthand. */
  setValue: (dimensionId: string, value: string) => void;
  setValues: (dimensionId: string, values: readonly string[]) => void;
  toggle: (dimensionId: string, value: string) => void;
  clearOne: (dimensionId: string, value?: string) => void;
  clearAll: () => void;
  page: number;
  setPage: (page: number) => void;
  sort: string;
  direction: 'asc' | 'desc';
  setSort: (sort: string, direction: 'asc' | 'desc') => void;
  /**
   * Dimensions whose values were dropped by the last scope change. Cleared
   * once the screen has acknowledged them with `dismissDropped`.
   */
  droppedDimensions: string[];
  dismissDropped: () => void;
}

/**
 * Filter, sort and page state that lives in the URL.
 *
 * ## Why the URL and not component state
 *
 * Every filterable screen in this product used `useState`, so a filtered view
 * survived neither a reload nor the back button, and could not be linked to.
 * That is not only a convenience: the dashboard's whole premise is that a tile
 * drills through to the rows behind it *with the scope kept*, and a drill-down
 * that cannot carry its filters in a link cannot do that.
 *
 * ## What is deliberately not in the URL
 *
 * Dimensions marked `sensitive` — the free-text person search. `serialiseFilters`
 * drops them, so the search still works and still shows a chip, it simply does
 * not travel into a pasted link or a server log.
 *
 * ## Page resets
 *
 * Any change to the predicates resets to page 1. Without it, narrowing a
 * filter while on page 4 of 4 lands on an empty page that reads as "no
 * results" for a filter that matched plenty.
 */
export function useFilterState(options: UseFilterStateOptions): FilterStateApi {
  const {
    dimensions,
    allowedValues,
    scopeKey,
    defaultSort = '',
    defaultDirection = 'asc',
  } = options;
  const [searchParams, setSearchParams] = useSearchParams();

  // Sensitive dimensions never reach the URL, so their values have to be held
  // here or they would be lost on the next write of the search params.
  const [privateFilters, setPrivateFilters] = useState<FilterState>({});
  const [droppedDimensions, setDroppedDimensions] = useState<string[]>([]);
  const lastScope = useRef<string | undefined>(scopeKey);

  const sensitiveIds = useMemo(
    () => new Set(dimensions.filter((d) => d.sensitive).map((d) => d.id)),
    [dimensions],
  );

  const urlFilters = useMemo(
    () => parseFilters(searchParams, dimensions, allowedValues),
    [searchParams, dimensions, allowedValues],
  );

  const filters = useMemo<FilterState>(
    () => ({ ...urlFilters, ...privateFilters }),
    [urlFilters, privateFilters],
  );

  const page = parsePage(searchParams);
  const sort = searchParams.get('sort') ?? defaultSort;
  const direction = searchParams.get('dir') === 'desc' ? 'desc' : defaultDirection;

  const write = useCallback(
    (
      next: FilterState,
      nextPage: number,
      nextSort: string,
      nextDirection: 'asc' | 'desc',
    ) => {
      const params = serialiseFilters(next, dimensions, {
        page: nextPage,
        sort: nextSort || undefined,
        direction: nextDirection,
      });
      // `replace`, so a filter change does not push a history entry per
      // keystroke and Back still leaves the screen rather than walking through
      // every intermediate state.
      setSearchParams(params, { replace: true });
    },
    [dimensions, setSearchParams],
  );

  const apply = useCallback(
    (next: FilterState) => {
      const privateNext: Record<string, readonly string[]> = {};
      const publicNext: Record<string, readonly string[]> = {};
      for (const [id, values] of Object.entries(next)) {
        if (sensitiveIds.has(id)) privateNext[id] = values;
        else publicNext[id] = values;
      }
      setPrivateFilters(privateNext);
      // Page 1 whenever the predicates move. Sorting is not a predicate and
      // keeps the page.
      const samePredicates = filtersEqual(filters, next);
      write(publicNext, samePredicates ? page : 1, sort, direction);
    },
    [sensitiveIds, filters, page, sort, direction, write],
  );

  const setValues = useCallback(
    (dimensionId: string, values: readonly string[]) => {
      apply(setFilterValues(filters, dimensionId, values));
    },
    [apply, filters],
  );

  const setValue = useCallback(
    (dimensionId: string, value: string) => {
      apply(setFilterValue(filters, dimensionId, value));
    },
    [apply, filters],
  );

  const toggle = useCallback(
    (dimensionId: string, value: string) => {
      apply(toggleFilterValue(filters, dimensionId, value));
    },
    [apply, filters],
  );

  const clearOne = useCallback(
    (dimensionId: string, value?: string) => {
      apply(
        value === undefined
          ? setFilterValues(filters, dimensionId, [])
          : toggleFilterValue(filters, dimensionId, value),
      );
    },
    [apply, filters],
  );

  const clearAll = useCallback(() => {
    apply(clearAllFilters(dimensions));
  }, [apply, dimensions]);

  const setPage = useCallback(
    (nextPage: number) => {
      const publicOnly: Record<string, readonly string[]> = {};
      for (const [id, values] of Object.entries(filters)) {
        if (!sensitiveIds.has(id)) publicOnly[id] = values;
      }
      write(publicOnly, nextPage, sort, direction);
    },
    [filters, sensitiveIds, write, sort, direction],
  );

  const setSort = useCallback(
    (nextSort: string, nextDirection: 'asc' | 'desc') => {
      const publicOnly: Record<string, readonly string[]> = {};
      for (const [id, values] of Object.entries(filters)) {
        if (!sensitiveIds.has(id)) publicOnly[id] = values;
      }
      write(publicOnly, page, nextSort, nextDirection);
    },
    [filters, sensitiveIds, write, page],
  );

  /**
   * Drop values that the new scope does not contain.
   *
   * Runs on a scope change only, not on every render: pruning continuously
   * would fight a screen whose option lists are still loading and would clear
   * a perfectly valid filter during the first paint.
   */
  useEffect(() => {
    if (scopeKey === lastScope.current) return;
    lastScope.current = scopeKey;
    setDroppedDimensions([]);
    if (!allowedValues) return;

    const result = pruneFilterValues(filters, allowedValues);
    if (result.dropped.length === 0) return;
    setDroppedDimensions(result.dropped);
    apply(result.state);
    // `filters`/`apply` are deliberately absent: this must fire on a scope
    // change and nothing else. Including them would re-run the prune on every
    // keystroke, against option lists that may not have loaded yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scopeKey, allowedValues]);

  const dismissDropped = useCallback(() => setDroppedDimensions([]), []);

  return {
    filters,
    setValue,
    setValues,
    toggle,
    clearOne,
    clearAll,
    page,
    setPage,
    sort,
    direction,
    setSort,
    droppedDimensions,
    dismissDropped,
  };
}
