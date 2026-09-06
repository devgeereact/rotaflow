import { describe, expect, it } from 'vitest';
import {
  clearAllFilters,
  filterValue,
  listOutcome,
  matchesFilters,
  matchesSearch,
  parseFilters,
  serialiseFilters,
  setFilterValue,
  setFilterValues,
  type FilterDimension,
} from '@/lib/filters';

/**
 * The Platform console on the shared filter contract (GAP-078).
 *
 * `src/lib/filters.ts` was written to be shared and, until this change, only
 * the organisation workspace used it. Every `/admin` list held its own
 * `useState` filters, so the two halves of the product disagreed about what an
 * empty select means, whether a filtered view survives a reload, and whether
 * "nothing here" means the query matched nothing or failed. Two systems
 * behaving differently is worse than both behaving the same way badly.
 *
 * These assertions mirror the dimensions and accessors the two converted
 * screens declare. They are here rather than in a component test because the
 * behaviour under test is the predicate and the URL, not the markup — and a
 * component test would need a router, a session and four services to reach it.
 */

interface Org {
  id: string;
  name: string;
  slug: string;
  status: string;
  plan: string;
}

const ORG_FILTERS: readonly FilterDimension[] = [
  { id: 'q', label: 'Search', kind: 'text' },
  { id: 'status', label: 'Status', kind: 'select' },
  { id: 'plan', label: 'Plan', kind: 'select' },
];

const ORG_ACCESSORS = {
  status: (o: Org) => o.status,
  plan: (o: Org) => o.plan,
};

const ORGS: Org[] = [
  {
    id: '1',
    name: 'Sunnyvale Care',
    slug: 'sunnyvale',
    status: 'active',
    plan: 'starter',
  },
  {
    id: '2',
    name: 'Riverside Homes',
    slug: 'riverside',
    status: 'suspended',
    plan: 'business',
  },
  { id: '3', name: "O'Brien Care", slug: 'obrien', status: 'active', plan: 'business' },
];

function visibleOrgs(state: Parameters<typeof filterValue>[0]): string[] {
  return ORGS.filter(
    (o) =>
      matchesFilters(o, state, ORG_ACCESSORS) &&
      matchesSearch([o.name, o.slug], filterValue(state, 'q')),
  ).map((o) => o.id);
}

describe('organisations', () => {
  it('combines status and plan with AND', () => {
    let state = setFilterValue({}, 'status', 'active');
    state = setFilterValue(state, 'plan', 'business');
    expect(visibleOrgs(state)).toEqual(['3']);
  });

  it('searches name and slug, punctuation included', () => {
    expect(visibleOrgs(setFilterValue({}, 'q', "o'brien"))).toEqual(['3']);
    expect(visibleOrgs(setFilterValue({}, 'q', 'riverside'))).toEqual(['2']);
    // A metacharacter matches itself and does not throw.
    expect(visibleOrgs(setFilterValue({}, 'q', '.*'))).toEqual([]);
  });

  it('an empty select is no filter, not a filter matching nothing', () => {
    expect(visibleOrgs(setFilterValue({}, 'status', ''))).toHaveLength(3);
  });

  it('survives a reload through the URL', () => {
    const state = setFilterValue(setFilterValue({}, 'status', 'active'), 'q', 'sunny');
    const params = serialiseFilters(state, ORG_FILTERS);
    const parsed = parseFilters(params, ORG_FILTERS);
    expect(filterValue(parsed, 'status')).toBe('active');
    // The console's search DOES travel, unlike the workspace's person search:
    // an organisation's name is its identity to platform staff and is in the
    // ticket already, and a linkable filtered view is the point of a console.
    expect(filterValue(parsed, 'q')).toBe('sunny');
  });

  it('drops a plan the deployment does not have', () => {
    const parsed = parseFilters(
      new URLSearchParams('plan=enterprise'),
      ORG_FILTERS,
      (id) => (id === 'plan' ? ['starter', 'business'] : null),
    );
    expect(parsed['plan']).toBeUndefined();
  });
});

interface Account {
  id: string;
  email: string;
  name: string;
  platformAdmin: boolean;
  orgRoles: string[];
}

const USER_FILTERS: readonly FilterDimension[] = [
  { id: 'q', label: 'Search', kind: 'text' },
  { id: 'access', label: 'Platform access', kind: 'select' },
  { id: 'role', label: 'Organisation role', kind: 'multi' },
];

const USER_ACCESSORS = {
  access: (a: Account) => (a.platformAdmin ? 'platform' : 'standard'),
  role: (a: Account) => a.orgRoles,
};

const ACCOUNTS: Account[] = [
  {
    id: '1',
    email: 'ada@example.test',
    name: 'Ada Chen',
    platformAdmin: true,
    orgRoles: ['owner'],
  },
  {
    id: '2',
    email: 'marcus@example.test',
    name: 'Marcus Webb',
    platformAdmin: false,
    orgRoles: ['manager', 'staff'],
  },
  {
    id: '3',
    email: 'priya@example.test',
    name: 'Priya Shah',
    platformAdmin: false,
    orgRoles: [],
  },
];

function visibleAccounts(state: Parameters<typeof filterValue>[0]): string[] {
  return ACCOUNTS.filter(
    (a) =>
      matchesFilters(a, state, USER_ACCESSORS) &&
      matchesSearch([a.email, a.name], filterValue(state, 'q')),
  ).map((a) => a.id);
}

describe('accounts', () => {
  it('separates platform administrators from standard accounts', () => {
    expect(visibleAccounts(setFilterValue({}, 'access', 'platform'))).toEqual(['1']);
    expect(visibleAccounts(setFilterValue({}, 'access', 'standard'))).toEqual(['2', '3']);
  });

  it('matches any organisation role the account holds', () => {
    // Somebody who is a manager in one tenant and staff in another matches
    // either — the OR-within-a-dimension rule, which the hand-rolled
    // `roles.includes(orgRole)` also did but only for one value at a time.
    expect(visibleAccounts(setFilterValues({}, 'role', ['staff']))).toEqual(['2']);
    expect(visibleAccounts(setFilterValues({}, 'role', ['owner', 'staff']))).toEqual([
      '1',
      '2',
    ]);
  });

  it('an account with no organisation membership matches no role filter', () => {
    expect(visibleAccounts(setFilterValues({}, 'role', ['owner']))).not.toContain('3');
  });

  it('ANDs access with role', () => {
    let state = setFilterValue({}, 'access', 'standard');
    state = setFilterValues(state, 'role', ['owner', 'manager']);
    expect(visibleAccounts(state)).toEqual(['2']);
  });

  it('clear-all returns to every account', () => {
    expect(visibleAccounts(clearAllFilters(USER_FILTERS))).toHaveLength(3);
  });
});

describe('both screens tell an error apart from an empty deployment', () => {
  /**
   * The distinction neither console screen could draw. Both rendered one
   * `emptyMessage` — "No organisation matches these filters." — for a
   * deployment with no organisations, for a filter that matched none, and for
   * a read that failed. The first is a fresh install, the second is a filter
   * to widen, and the third is a problem.
   */
  it('names the three states separately', () => {
    expect(
      listOutcome({ loading: false, failed: false, totalRows: 0, matchedRows: 0 }),
    ).toBe('empty-dataset');
    expect(
      listOutcome({ loading: false, failed: false, totalRows: 40, matchedRows: 0 }),
    ).toBe('no-match');
    expect(
      listOutcome({ loading: false, failed: true, totalRows: 0, matchedRows: 0 }),
    ).toBe('error');
  });

  it('an error outranks rows already on screen', () => {
    expect(
      listOutcome({ loading: false, failed: true, totalRows: 40, matchedRows: 40 }),
    ).toBe('error');
  });
});
