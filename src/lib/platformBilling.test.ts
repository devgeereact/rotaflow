import { describe, expect, it } from 'vitest';
import {
  daysUntil,
  needsAttention,
  renewalBreakdown,
  renewalBucket,
  type BillingSubscription,
} from '@/lib/platformBilling';

const sub = (overrides: Partial<BillingSubscription> = {}): BillingSubscription => ({
  org_id: 'org-1',
  plan: 'starter',
  status: 'active',
  provider: null,
  current_period_end: null,
  ...overrides,
});

const NOW = new Date('2026-08-05T09:00:00Z');

describe('daysUntil', () => {
  it('counts whole calendar days ahead', () => {
    expect(daysUntil('2026-08-12T09:00:00Z', NOW)).toBe(7);
  });

  it('returns a negative count once the period has passed', () => {
    expect(daysUntil('2026-08-01T09:00:00Z', NOW)).toBe(-4);
  });

  /**
   * The bug this pins: elapsed milliseconds divided by 86,400,000 makes
   * "renews tomorrow" report 0 or 1 depending on what time of day the page was
   * opened, because 09:00 to 08:00 the next morning is 23 hours. Calendar days
   * do not care what time it is.
   */
  it('calls tomorrow one day away whatever time of day it is asked', () => {
    expect(daysUntil('2026-08-06T00:05:00Z', NOW)).toBe(1);
    expect(daysUntil('2026-08-06T08:00:00Z', NOW)).toBe(1);
    expect(daysUntil('2026-08-06T18:00:00Z', NOW)).toBe(1);
  });

  /**
   * And the consequence of choosing calendar days: they are the *reader's*
   * days. This suite runs in Europe/London, where 23:55 UTC on the 6th is
   * already 00:55 on the 7th, so it is two days out, not one. That is correct
   * for a UK product whose organisations are on Europe/London: "renews
   * tomorrow" should mean the tomorrow the manager is living in. It is pinned
   * because it is surprising, and because a future move to UTC-day arithmetic
   * would silently change what every renewal date on the console claims.
   */
  it('counts in local calendar days, not UTC ones', () => {
    expect(daysUntil('2026-08-06T23:55:00Z', NOW)).toBe(2);
  });

  it('returns null for a missing or unparseable period end', () => {
    expect(daysUntil(null, NOW)).toBeNull();
    expect(daysUntil('not-a-date', NOW)).toBeNull();
  });
});

describe('renewalBucket', () => {
  it('places a period end in the right window', () => {
    expect(renewalBucket('2026-08-01T09:00:00Z', NOW)).toBe('overdue');
    expect(renewalBucket('2026-08-05T23:00:00Z', NOW)).toBe('week');
    expect(renewalBucket('2026-08-12T09:00:00Z', NOW)).toBe('week');
    expect(renewalBucket('2026-08-20T09:00:00Z', NOW)).toBe('month');
    expect(renewalBucket('2026-10-01T09:00:00Z', NOW)).toBe('quarter');
    expect(renewalBucket('2027-06-01T09:00:00Z', NOW)).toBe('later');
    expect(renewalBucket(null, NOW)).toBe('none');
  });

  it('treats the boundary days as inside the narrower window', () => {
    expect(renewalBucket('2026-08-12T09:00:00Z', NOW)).toBe('week');
    expect(renewalBucket('2026-08-13T09:00:00Z', NOW)).toBe('month');
    expect(renewalBucket('2026-09-04T09:00:00Z', NOW)).toBe('month');
    expect(renewalBucket('2026-09-05T09:00:00Z', NOW)).toBe('quarter');
  });
});

describe('renewalBreakdown', () => {
  it('returns every window in display order, including empty ones', () => {
    const rows = renewalBreakdown([], NOW);
    expect(rows.map((r) => r.bucket)).toEqual([
      'overdue',
      'week',
      'month',
      'quarter',
      'later',
      'none',
    ]);
    expect(rows.every((r) => r.count === 0)).toBe(true);
  });

  it('counts subscriptions into their windows', () => {
    const rows = renewalBreakdown(
      [
        sub({ current_period_end: '2026-08-01T09:00:00Z' }),
        sub({ current_period_end: '2026-08-10T09:00:00Z' }),
        sub({ current_period_end: '2026-08-11T09:00:00Z' }),
        sub({ current_period_end: null }),
      ],
      NOW,
    );
    const byBucket = Object.fromEntries(rows.map((r) => [r.bucket, r.count]));
    expect(byBucket).toMatchObject({ overdue: 1, week: 2, none: 1, month: 0 });
  });
});

describe('needsAttention', () => {
  it('flags anything marked past due', () => {
    const rows = needsAttention([sub({ status: 'past_due' })], NOW);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.why).toBe('Marked past due');
  });

  it('flags an active subscription whose period has already ended', () => {
    const rows = needsAttention(
      [sub({ status: 'active', current_period_end: '2026-08-04T09:00:00Z' })],
      NOW,
    );
    expect(rows[0]?.why).toBe('Active, but the period ended 1 day ago');
  });

  it('pluralises the lapsed-day count', () => {
    const rows = needsAttention(
      [sub({ status: 'active', current_period_end: '2026-08-01T09:00:00Z' })],
      NOW,
    );
    expect(rows[0]?.why).toBe('Active, but the period ended 4 days ago');
  });

  it('leaves healthy and cancelled subscriptions alone', () => {
    expect(
      needsAttention(
        [
          sub({ status: 'active', current_period_end: '2026-12-01T09:00:00Z' }),
          sub({ status: 'canceled', current_period_end: '2026-01-01T09:00:00Z' }),
          sub({ status: 'active', current_period_end: null }),
        ],
        NOW,
      ),
    ).toEqual([]);
  });

  it('does not double-report a past-due row that has also lapsed', () => {
    const rows = needsAttention(
      [sub({ status: 'past_due', current_period_end: '2026-01-01T09:00:00Z' })],
      NOW,
    );
    expect(rows).toHaveLength(1);
  });
});
