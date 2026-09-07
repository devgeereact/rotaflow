import { describe, expect, it } from 'vitest';
import {
  CREATED_WINDOWS,
  createdWindowBounds,
  organisationQueryFrom,
} from './organisationDirectory';
import { EMPTY_FILTERS, setFilterValues, type FilterState } from './filters';

const at = (iso: string): Date => new Date(iso);

function withFilters(entries: Record<string, string[]>): FilterState {
  let state = EMPTY_FILTERS;
  for (const [id, values] of Object.entries(entries)) {
    state = setFilterValues(state, id, values);
  }
  return state;
}

const view = { sort: 'created_at', direction: 'desc' as const, page: 1, pageSize: 25 };

describe('organisationQueryFrom', () => {
  it('sends every declared dimension, so none silently stops filtering', () => {
    const query = organisationQueryFrom(
      withFilters({
        q: ['zulu'],
        status: ['active'],
        plan: ['enterprise'],
        subscription: ['past_due'],
        industry: ['care'],
        health: ['at_risk'],
      }),
      view,
    );

    expect(query.search).toBe('zulu');
    expect(query.status).toEqual(['active']);
    expect(query.plan).toEqual(['enterprise']);
    expect(query.subscriptionStatus).toEqual(['past_due']);
    expect(query.industry).toEqual(['care']);
    expect(query.health).toEqual(['at_risk']);
  });

  it('omits a dimension that holds nothing rather than sending an empty list', () => {
    // An empty array reaching the RPC would be indistinguishable from "filter
    // on nothing", which is only harmless because 0130 checks array_length.
    // Not sending it at all is the contract both sides can rely on.
    const query = organisationQueryFrom(EMPTY_FILTERS, view);
    expect(query.status).toBeUndefined();
    expect(query.plan).toBeUndefined();
    expect(query.search).toBeUndefined();
  });

  it('carries several values in one dimension, which OR together server-side', () => {
    const query = organisationQueryFrom(
      withFilters({ status: ['active', 'suspended'] }),
      view,
    );
    expect(query.status).toEqual(['active', 'suspended']);
  });

  it('passes the page and sort through unchanged', () => {
    const query = organisationQueryFrom(EMPTY_FILTERS, {
      sort: 'staff_active',
      direction: 'asc',
      page: 4,
      pageSize: 50,
    });
    expect(query.sort).toBe('staff_active');
    expect(query.direction).toBe('asc');
    expect(query.page).toBe(4);
    expect(query.pageSize).toBe(50);
  });

  it('falls back to created_at when no sort is chosen', () => {
    const query = organisationQueryFrom(EMPTY_FILTERS, { ...view, sort: '' });
    expect(query.sort).toBe('created_at');
  });
});

describe('createdWindowBounds', () => {
  it('offers only windows it can compute', () => {
    for (const option of CREATED_WINDOWS) {
      const bounds = createdWindowBounds(option.value, at('2026-09-06T12:00:00Z'));
      expect(bounds.from).not.toBeNull();
    }
  });

  it('makes last month a half-open range, so the 1st is not counted twice', () => {
    const bounds = createdWindowBounds('last_month', at('2026-09-06T12:00:00Z'));
    expect(bounds.from).toBe(new Date(2026, 7, 1).toISOString());
    expect(bounds.to).toBe(new Date(2026, 8, 1).toISOString());
  });

  it('leaves an open upper bound for a trailing window', () => {
    const bounds = createdWindowBounds('30d', at('2026-09-06T12:00:00Z'));
    expect(bounds.to).toBeNull();
  });

  it('crosses a month boundary without landing in the wrong month', () => {
    // 1 March looking back a month is February, whatever its length.
    const bounds = createdWindowBounds('last_month', at('2026-03-01T09:00:00Z'));
    expect(bounds.from).toBe(new Date(2026, 1, 1).toISOString());
    expect(bounds.to).toBe(new Date(2026, 2, 1).toISOString());
  });

  it('treats an unknown window as no filter, not as an empty result', () => {
    // A hand-edited or stale URL must degrade to the unfiltered view. An
    // impossible range would render an empty table, which reads as "this
    // deployment has no tenants".
    expect(createdWindowBounds('yesteryear', at('2026-09-06T12:00:00Z'))).toEqual({
      from: null,
      to: null,
    });
    expect(createdWindowBounds('', at('2026-09-06T12:00:00Z'))).toEqual({
      from: null,
      to: null,
    });
  });
});
