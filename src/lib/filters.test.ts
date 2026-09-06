import { describe, expect, it } from 'vitest';
import {
  UNASSIGNED,
  activeFilterCount,
  applySort,
  clearAllFilters,
  escapeLikePattern,
  escapeOrValue,
  filterChips,
  filtersEqual,
  ilikePattern,
  isDimensionApplied,
  listOutcome,
  matchesFilters,
  matchesSearch,
  normaliseSearchTerm,
  paginate,
  parseFilters,
  parsePage,
  pruneFilterValues,
  serialiseFilters,
  setFilterValue,
  setFilterValues,
  toggleFilterValue,
  type FilterDimension,
} from '@/lib/filters';

interface Person {
  id: string;
  name: string;
  jobTitleId: string | null;
  locationIds: string[];
  status: 'active' | 'inactive';
}

const DIMENSIONS: readonly FilterDimension[] = [
  { id: 'q', label: 'Search', kind: 'text', sensitive: true },
  { id: 'loc', label: 'Site', kind: 'multi' },
  { id: 'title', label: 'Job title', kind: 'multi' },
  { id: 'status', label: 'Status', kind: 'select', defaultValues: ['active'] },
];

const PEOPLE: Person[] = [
  {
    id: '1',
    name: "Siobhán O'Brien",
    jobTitleId: 't-nurse',
    locationIds: ['l1'],
    status: 'active',
  },
  {
    id: '2',
    name: 'Marcus Webb',
    jobTitleId: 't-carer',
    locationIds: ['l1', 'l2'],
    status: 'active',
  },
  {
    id: '3',
    name: 'Ada Chen',
    jobTitleId: null,
    locationIds: ['l2'],
    status: 'inactive',
  },
];

const ACCESSORS = {
  loc: (p: Person) => p.locationIds,
  title: (p: Person) => p.jobTitleId,
};

describe('combining dimensions', () => {
  it('ANDs across dimensions and ORs within one', () => {
    // Site l1 OR l2, AND job title nurse. Only person 1 satisfies both.
    let state = setFilterValues({}, 'loc', ['l1', 'l2']);
    state = setFilterValues(state, 'title', ['t-nurse']);
    expect(
      PEOPLE.filter((p) => matchesFilters(p, state, ACCESSORS)).map((p) => p.id),
    ).toEqual(['1']);
  });

  it('matches a person assigned to any one of several sites', () => {
    const state = setFilterValues({}, 'loc', ['l2']);
    expect(
      PEOPLE.filter((p) => matchesFilters(p, state, ACCESSORS)).map((p) => p.id),
    ).toEqual(['2', '3']);
  });

  it('an empty dimension is no filter at all, not a filter matching nothing', () => {
    const state = setFilterValues({}, 'loc', []);
    expect(PEOPLE.filter((p) => matchesFilters(p, state, ACCESSORS))).toHaveLength(3);
  });

  it('finds records with nothing set only through an explicit Unassigned', () => {
    const state = setFilterValues({}, 'title', [UNASSIGNED]);
    expect(
      PEOPLE.filter((p) => matchesFilters(p, state, ACCESSORS)).map((p) => p.id),
    ).toEqual(['3']);
    // And a real title never sweeps the unassigned in with it.
    const nurse = setFilterValues({}, 'title', ['t-nurse']);
    expect(
      PEOPLE.filter((p) => matchesFilters(p, nurse, ACCESSORS)).map((p) => p.id),
    ).toEqual(['1']);
  });

  it('filters on the job title id, so a rename does not break a saved filter', () => {
    const state = setFilterValues({}, 'title', ['t-nurse']);
    const renamed: Person = { ...PEOPLE[0]!, name: 'Registered Nurse holder' };
    expect(matchesFilters(renamed, state, ACCESSORS)).toBe(true);
  });
});

describe('text matching', () => {
  it('normalises case and whitespace for matching', () => {
    expect(normaliseSearchTerm('  Senior   CARER ')).toBe('senior carer');
  });

  it('treats punctuation as data, not as syntax', () => {
    expect(matchesSearch(["Siobhán O'Brien"], "o'brien")).toBe(true);
    // A regular-expression metacharacter must match itself, and must not throw.
    expect(matchesSearch(['Bank (relief)'], '(relief)')).toBe(true);
    expect(() => matchesSearch(['anything'], '(')).not.toThrow();
    expect(matchesSearch(['anything'], '(')).toBe(false);
    expect(matchesSearch(['anything'], '.*')).toBe(false);
  });

  it('matches across fields joined with a space', () => {
    expect(matchesSearch(['Marcus', 'Webb', 'Senior Carer'], 'webb senior')).toBe(true);
  });

  it('an empty term matches everything', () => {
    expect(matchesSearch(['anything'], '   ')).toBe(true);
  });
});

describe('escaping for the server', () => {
  it('escapes ilike wildcards so they are searched for literally', () => {
    expect(escapeLikePattern('50%_off')).toBe('50\\%\\_off');
    expect(ilikePattern(' 100% ')).toBe('%100\\%%');
  });

  it('escapes a backslash before the wildcards it would otherwise escape', () => {
    expect(escapeLikePattern('a\\b')).toBe('a\\\\b');
  });

  it('quotes a value going into an or() list so a comma cannot reshape the filter', () => {
    expect(escapeOrValue('Smith, John')).toBe('"Smith, John"');
    expect(escapeOrValue('say "hi"')).toBe('"say \\"hi\\""');
  });
});

describe('defaults and applied counts', () => {
  it('a dimension sitting on its default is not an applied filter', () => {
    const state = clearAllFilters(DIMENSIONS);
    expect(state['status']).toEqual(['active']);
    expect(isDimensionApplied(state, DIMENSIONS[3]!)).toBe(false);
    expect(activeFilterCount(state, DIMENSIONS)).toBe(0);
  });

  it('counts a changed default as applied', () => {
    const state = setFilterValue(clearAllFilters(DIMENSIONS), 'status', 'all');
    expect(activeFilterCount(state, DIMENSIONS)).toBe(1);
  });

  it('toggles a value in and out of a multi dimension', () => {
    let state = toggleFilterValue({}, 'loc', 'l1');
    expect(state['loc']).toEqual(['l1']);
    state = toggleFilterValue(state, 'loc', 'l2');
    expect(state['loc']).toEqual(['l1', 'l2']);
    state = toggleFilterValue(state, 'loc', 'l1');
    expect(state['loc']).toEqual(['l2']);
  });

  it('renders chips with the option label, not the raw id', () => {
    const state = setFilterValues({}, 'loc', ['l1']);
    const chips = filterChips(state, DIMENSIONS, (id) =>
      id === 'loc' ? [{ value: 'l1', label: 'Riverside House' }] : [],
    );
    expect(chips).toHaveLength(1);
    expect(chips[0]?.label).toBe('Riverside House');
    expect(chips[0]?.dimensionLabel).toBe('Site');
  });
});

describe('URL state', () => {
  it('round-trips a multi-valued dimension as repeated keys', () => {
    const state = setFilterValues({}, 'loc', ['l1', 'l2']);
    const params = serialiseFilters(state, DIMENSIONS);
    expect(params.getAll('loc')).toEqual(['l1', 'l2']);
    expect(parseFilters(params, DIMENSIONS)['loc']).toEqual(['l1', 'l2']);
  });

  it('never puts a sensitive dimension in the URL', () => {
    const state = setFilterValue({}, 'q', 'siobhan');
    const params = serialiseFilters(state, DIMENSIONS);
    expect(params.toString()).not.toContain('siobhan');
    expect(params.has('q')).toBe(false);
  });

  it('drops a value the screen does not offer, rather than filtering on it', () => {
    // A hand-edited or stale link — including one carrying another tenant's id.
    const params = new URLSearchParams('loc=l1&loc=other-tenant-site');
    const parsed = parseFilters(params, DIMENSIONS, (id) =>
      id === 'loc' ? ['l1'] : null,
    );
    expect(parsed['loc']).toEqual(['l1']);
  });

  it('falls back to the defaults when every value is rejected', () => {
    const params = new URLSearchParams('loc=gone');
    const parsed = parseFilters(params, DIMENSIONS, (id) => (id === 'loc' ? [] : null));
    expect(parsed['loc']).toBeUndefined();
    expect(parsed['status']).toEqual(['active']);
  });

  it('omits page 1 and reads a bad page as 1', () => {
    expect(serialiseFilters({}, DIMENSIONS, { page: 1 }).has('page')).toBe(false);
    expect(serialiseFilters({}, DIMENSIONS, { page: 3 }).get('page')).toBe('3');
    expect(parsePage(new URLSearchParams('page=0'))).toBe(1);
    expect(parsePage(new URLSearchParams('page=nonsense'))).toBe(1);
  });

  it('knows when the predicates changed, which is what resets the page', () => {
    const a = setFilterValues({}, 'loc', ['l1']);
    expect(filtersEqual(a, setFilterValues({}, 'loc', ['l1']))).toBe(true);
    expect(filtersEqual(a, setFilterValues({}, 'loc', ['l2']))).toBe(false);
    // Order within a dimension is part of the state, so a reorder is a change.
    expect(
      filtersEqual(
        setFilterValues({}, 'loc', ['l1', 'l2']),
        setFilterValues({}, 'loc', ['l2', 'l1']),
      ),
    ).toBe(false);
  });
});

describe('pruning on a scope change', () => {
  it('drops values the new scope does not contain and names the dimension', () => {
    let state = setFilterValues({}, 'loc', ['old-tenant-site']);
    state = setFilterValues(state, 'title', ['t-nurse']);
    const result = pruneFilterValues(state, (id) =>
      id === 'loc' ? ['l1', 'l2'] : id === 'title' ? ['t-nurse'] : null,
    );
    expect(result.state['loc']).toBeUndefined();
    expect(result.state['title']).toEqual(['t-nurse']);
    expect(result.dropped).toEqual(['loc']);
  });

  it('leaves an open-set dimension alone', () => {
    const state = setFilterValue({}, 'q', 'anything');
    const result = pruneFilterValues(state, () => null);
    expect(result.state['q']).toEqual(['anything']);
    expect(result.dropped).toEqual([]);
  });
});

describe('sorting and pagination', () => {
  const rows = [
    { id: 'c', key: 'b' },
    { id: 'a', key: 'a' },
    { id: 'b', key: 'a' },
  ];

  it('breaks ties deterministically so a row cannot be paged twice', () => {
    const spec = {
      id: 'k',
      label: 'Key',
      compare: (x: (typeof rows)[0], y: (typeof rows)[0]) => x.key.localeCompare(y.key),
    };
    const first = applySort(rows, spec, 'asc', (r) => r.id).map((r) => r.id);
    const second = applySort([...rows].reverse(), spec, 'asc', (r) => r.id).map(
      (r) => r.id,
    );
    expect(first).toEqual(second);
    expect(first).toEqual(['a', 'b', 'c']);
  });

  it('reverses on desc while keeping the tie-break stable', () => {
    const spec = {
      id: 'k',
      label: 'Key',
      compare: (x: (typeof rows)[0], y: (typeof rows)[0]) => x.key.localeCompare(y.key),
    };
    expect(applySort(rows, spec, 'desc', (r) => r.id).map((r) => r.id)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('reports the matched total, not the page length', () => {
    const many = Array.from({ length: 137 }, (_, i) => ({ id: String(i) }));
    const page = paginate(many, 2, 50);
    expect(page.rows).toHaveLength(50);
    expect(page.total).toBe(137);
    expect(page.pageCount).toBe(3);
    expect(page.from).toBe(51);
    expect(page.to).toBe(100);
  });

  it('clamps an out-of-range page rather than showing nothing', () => {
    const page = paginate([{ id: '1' }], 9, 50);
    expect(page.page).toBe(1);
    expect(page.rows).toHaveLength(1);
  });

  it('reports 0 of 0 for an empty result without a phantom first row', () => {
    const page = paginate([], 1, 50);
    expect(page.from).toBe(0);
    expect(page.to).toBe(0);
    expect(page.pageCount).toBe(1);
  });
});

describe('listOutcome', () => {
  /**
   * The distinction that was missing: a failed request used to fall through to
   * "no staff match these filters", which tells a manager their organisation
   * is empty when in fact the network dropped.
   */
  it('separates an error from an empty dataset and from no matches', () => {
    expect(
      listOutcome({ loading: true, failed: false, totalRows: 0, matchedRows: 0 }),
    ).toBe('loading');
    expect(
      listOutcome({ loading: false, failed: true, totalRows: 0, matchedRows: 0 }),
    ).toBe('error');
    expect(
      listOutcome({ loading: false, failed: false, totalRows: 0, matchedRows: 0 }),
    ).toBe('empty-dataset');
    expect(
      listOutcome({ loading: false, failed: false, totalRows: 40, matchedRows: 0 }),
    ).toBe('no-match');
    expect(
      listOutcome({ loading: false, failed: false, totalRows: 40, matchedRows: 2 }),
    ).toBe('rows');
  });

  it('an error outranks having rows already on screen', () => {
    expect(
      listOutcome({ loading: false, failed: true, totalRows: 40, matchedRows: 40 }),
    ).toBe('error');
  });
});
