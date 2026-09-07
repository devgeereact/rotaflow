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

/* ------------------------------------------------------------------ */
/* The three screens converted in the second pass                      */
/* ------------------------------------------------------------------ */

interface Case {
  id: string;
  reference: string;
  status: string;
  priority: string;
}

const CASE_ACCESSORS = {
  status: (c: Case) => c.status,
  priority: (c: Case) => c.priority,
};

const CASES: Case[] = [
  { id: '1', reference: 'SUP-001', status: 'open', priority: 'urgent' },
  { id: '2', reference: 'SUP-002', status: 'pending', priority: 'normal' },
  { id: '3', reference: 'SUP-003', status: 'closed', priority: 'urgent' },
];

describe('support cases', () => {
  it('asks about the working queue in one filter, not two visits', () => {
    // Both dimensions are `multi`, so "open or pending" is expressible. The
    // pair of selects this replaces could only ask about one value at a time.
    const state = setFilterValues({}, 'status', ['open', 'pending']);
    expect(
      CASES.filter((c) => matchesFilters(c, state, CASE_ACCESSORS)).map((c) => c.id),
    ).toEqual(['1', '2']);
  });

  it('ANDs status with priority', () => {
    let state = setFilterValues({}, 'status', ['open', 'pending']);
    state = setFilterValues(state, 'priority', ['urgent']);
    expect(
      CASES.filter((c) => matchesFilters(c, state, CASE_ACCESSORS)).map((c) => c.id),
    ).toEqual(['1']);
  });
});

interface SubRow {
  id: string;
  plan: string;
  state: string | null;
}

/**
 * A row with no subscription record filters as a value, not as a gap.
 *
 * "No record" is the state finance asks about most, and the previous version
 * expressed it as the magic string `'none'` inside the predicate — which
 * worked and could not be linked to.
 */
const NO_SUBSCRIPTION = 'none';

const SUB_ACCESSORS = {
  plan: (r: SubRow) => r.plan,
  state: (r: SubRow) => r.state ?? NO_SUBSCRIPTION,
};

const SUB_ROWS: SubRow[] = [
  { id: '1', plan: 'starter', state: 'active' },
  { id: '2', plan: 'business', state: 'past_due' },
  { id: '3', plan: 'starter', state: null },
];

describe('subscriptions', () => {
  it('finds the organisations with no subscription record at all', () => {
    const state = setFilterValues({}, 'state', [NO_SUBSCRIPTION]);
    expect(
      SUB_ROWS.filter((r) => matchesFilters(r, state, SUB_ACCESSORS)).map((r) => r.id),
    ).toEqual(['3']);
  });

  it('does not sweep those into a real subscription state', () => {
    const state = setFilterValues({}, 'state', ['active']);
    expect(
      SUB_ROWS.filter((r) => matchesFilters(r, state, SUB_ACCESSORS)).map((r) => r.id),
    ).toEqual(['1']);
  });
});

interface AuditRow {
  id: string;
  scope: string;
  orgId: string | null;
  severity: string;
}

const PLATFORM_SCOPE = '__platform__';

const AUDIT_ACCESSORS = {
  org: (e: AuditRow) =>
    e.scope === 'platform' ? PLATFORM_SCOPE : (e.orgId ?? PLATFORM_SCOPE),
  severity: (e: AuditRow) => e.severity,
};

const AUDIT: AuditRow[] = [
  { id: '1', scope: 'platform', orgId: null, severity: 'info' },
  { id: '2', scope: 'org', orgId: 'o1', severity: 'warning' },
  { id: '3', scope: 'org', orgId: 'o2', severity: 'info' },
];

describe('audit', () => {
  it('separates what platform staff did from what a tenant did', () => {
    const state = setFilterValue({}, 'org', PLATFORM_SCOPE);
    expect(
      AUDIT.filter((e) => matchesFilters(e, state, AUDIT_ACCESSORS)).map((e) => e.id),
    ).toEqual(['1']);
  });

  it('scopes to one tenant', () => {
    const state = setFilterValue({}, 'org', 'o1');
    expect(
      AUDIT.filter((e) => matchesFilters(e, state, AUDIT_ACCESSORS)).map((e) => e.id),
    ).toEqual(['2']);
  });

  it('combines a tenant with a result', () => {
    let state = setFilterValue({}, 'org', 'o2');
    state = setFilterValues(state, 'severity', ['warning']);
    expect(AUDIT.filter((e) => matchesFilters(e, state, AUDIT_ACCESSORS))).toHaveLength(
      0,
    );
  });
});
