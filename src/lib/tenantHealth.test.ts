import { describe, expect, it } from 'vitest';
import {
  healthBand,
  healthBreakdown,
  tenantsActiveWithin,
  type TenantLike,
} from '@/lib/tenantHealth';

const NOW = new Date('2026-08-06T12:00:00Z');

function hoursAgo(h: number): string {
  return new Date(NOW.getTime() - h * 3_600_000).toISOString();
}

function daysAgo(d: number): string {
  return hoursAgo(d * 24);
}

function org(over: Partial<TenantLike> = {}): TenantLike {
  return { id: 'o1', status: 'active', last_activity_at: hoursAgo(1), ...over };
}

describe('tenantsActiveWithin', () => {
  it('counts organisations that acted inside the window', () => {
    expect(
      tenantsActiveWithin(
        [org({ last_activity_at: hoursAgo(2) }), org({ last_activity_at: hoursAgo(40) })],
        NOW,
      ),
    ).toBe(1);
  });

  it('does not count one that has never been active', () => {
    expect(tenantsActiveWithin([org({ last_activity_at: null })], NOW)).toBe(0);
  });

  it('ignores an unparseable timestamp rather than counting it', () => {
    expect(tenantsActiveWithin([org({ last_activity_at: 'not a date' })], NOW)).toBe(0);
  });

  it('honours a wider window', () => {
    expect(
      tenantsActiveWithin([org({ last_activity_at: hoursAgo(100) })], NOW, 168),
    ).toBe(1);
  });
});

describe('healthBand', () => {
  it('is healthy when active recently and paying', () => {
    expect(healthBand(org(), 'active', NOW)).toBe('healthy');
  });

  it('is suspended whatever else is true', () => {
    // Active an hour ago and paying, but the account is suspended — that is
    // still the fact a reader needs first.
    expect(healthBand(org({ status: 'suspended' }), 'active', NOW)).toBe('suspended');
  });

  it('treats archived as suspended rather than healthy', () => {
    expect(healthBand(org({ status: 'archived' }), 'active', NOW)).toBe('suspended');
  });

  it('flags a failed payment ahead of a quiet fortnight', () => {
    expect(healthBand(org({ last_activity_at: hoursAgo(1) }), 'past_due', NOW)).toBe(
      'attention',
    );
  });

  it('needs attention after a fortnight of silence', () => {
    expect(healthBand(org({ last_activity_at: daysAgo(20) }), 'active', NOW)).toBe(
      'attention',
    );
  });

  it('is at risk after a month of silence', () => {
    expect(healthBand(org({ last_activity_at: daysAgo(45) }), 'active', NOW)).toBe(
      'at_risk',
    );
  });

  it('counts never-active as at risk, not healthy', () => {
    expect(healthBand(org({ last_activity_at: null }), 'active', NOW)).toBe('at_risk');
  });

  it('counts an organisation with no subscription on activity alone', () => {
    expect(healthBand(org(), undefined, NOW)).toBe('healthy');
  });
});

describe('healthBreakdown', () => {
  it('returns the four bands in severity order and sums to the tenant count', () => {
    const organisations = [
      org({ id: 'a' }),
      org({ id: 'b', last_activity_at: daysAgo(20) }),
      org({ id: 'c', last_activity_at: daysAgo(60) }),
      org({ id: 'd', status: 'suspended' }),
    ];
    const rows = healthBreakdown(organisations, [{ org_id: 'a', status: 'active' }], NOW);
    expect(rows.map((r) => r.band)).toEqual([
      'healthy',
      'attention',
      'at_risk',
      'suspended',
    ]);
    expect(rows.map((r) => r.count)).toEqual([1, 1, 1, 1]);
    expect(rows.reduce((t, r) => t + r.count, 0)).toBe(organisations.length);
  });

  it('is all zeroes for no tenants rather than throwing', () => {
    expect(healthBreakdown([], [], NOW).every((r) => r.count === 0)).toBe(true);
  });
});
