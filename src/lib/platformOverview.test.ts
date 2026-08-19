import { describe, expect, it } from 'vitest';
import {
  countBy,
  humaniseKey,
  monthlyChurnCounts,
  monthlyGrowth,
  type OverviewOrg,
} from '@/lib/platformOverview';

const org = (created_at: string, status = 'active', plan = 'starter'): OverviewOrg => ({
  created_at,
  status,
  plan,
});

const sub = (canceled_at: string | null): { canceled_at: string | null } => ({
  canceled_at,
});

describe('monthlyGrowth', () => {
  const now = new Date('2026-08-05T09:00:00Z');

  it('returns one bucket per month, oldest first', () => {
    const points = monthlyGrowth([], now);
    expect(points).toHaveLength(12);
    expect(points[0]?.label).toBe('Sep');
    expect(points[11]?.label).toBe('Aug');
  });

  it('counts a signup into the month it happened', () => {
    const points = monthlyGrowth([org('2026-08-02T10:00:00Z')], now);
    expect(points[11]).toMatchObject({ label: 'Aug', created: 1, total: 1 });
    expect(points[10]?.created).toBe(0);
  });

  it('carries earlier organisations into every later total without recounting them', () => {
    const points = monthlyGrowth([org('2026-06-10T10:00:00Z')], now);
    expect(points[9]).toMatchObject({ label: 'Jun', created: 1, total: 1 });
    expect(points[10]).toMatchObject({ label: 'Jul', created: 0, total: 1 });
    expect(points[11]).toMatchObject({ label: 'Aug', created: 0, total: 1 });
  });

  it('counts an organisation created before the window in the totals only', () => {
    const points = monthlyGrowth([org('2019-01-01T00:00:00Z')], now);
    expect(points.every((p) => p.created === 0)).toBe(true);
    expect(points.every((p) => p.total === 1)).toBe(true);
  });

  it('excludes an organisation created after the window', () => {
    const points = monthlyGrowth([org('2027-01-01T00:00:00Z')], now);
    expect(points.every((p) => p.total === 0)).toBe(true);
  });

  /**
   * The bug this pins: a month boundary computed as `+30 days` drifts, and
   * across the October transition it lands an hour early. A signup at
   * 00:30 on the 1st then falls into the previous bucket. The suite runs in
   * Europe/London and CI builds in UTC, so this has to hold in both.
   */
  it('puts a signup just after a month boundary in the new month', () => {
    const points = monthlyGrowth(
      [org('2025-11-01T00:30:00Z')],
      new Date('2025-12-15T12:00:00Z'),
      3,
    );
    expect(points.map((p) => [p.label, p.created])).toEqual([
      ['Oct', 0],
      ['Nov', 1],
      ['Dec', 0],
    ]);
  });

  it('ignores an unparseable timestamp rather than throwing', () => {
    const points = monthlyGrowth([org('not-a-date'), org('2026-08-02T10:00:00Z')], now);
    expect(points[11]?.created).toBe(1);
  });

  it('honours a shorter window', () => {
    expect(monthlyGrowth([], now, 3)).toHaveLength(3);
  });
});

describe('monthlyChurnCounts', () => {
  const now = new Date('2026-08-05T09:00:00Z');

  it('returns one count per month, oldest first', () => {
    expect(monthlyChurnCounts([], now)).toHaveLength(12);
  });

  it('counts a cancellation into the month it happened', () => {
    const counts = monthlyChurnCounts([sub('2026-08-02T10:00:00Z')], now);
    expect(counts[11]).toBe(1);
    expect(counts[10]).toBe(0);
  });

  it('does not count a subscription that has not been canceled', () => {
    const counts = monthlyChurnCounts([sub(null)], now);
    expect(counts.every((c) => c === 0)).toBe(true);
  });

  /**
   * Same inclusive-start/exclusive-end convention `monthlyGrowth` pins above:
   * a cancellation exactly on a bucket's start boundary belongs to that
   * bucket, but one exactly on the boundary it shares with the next bucket
   * (that bucket's `nextStart`) belongs to the next bucket instead, not both
   * or neither.
   */
  it('counts a cancellation exactly at a bucket start, and rolls one exactly at nextStart into the next bucket', () => {
    const counts = monthlyChurnCounts(
      [sub('2025-11-01T00:00:00Z'), sub('2025-12-01T00:00:00Z')],
      new Date('2025-12-15T12:00:00Z'),
      3,
    );
    // Window is [Oct, Nov, Dec]. The Nov-01 cancellation lands in Nov (its
    // own bucket's start); the Dec-01 cancellation is Nov's `nextStart` and
    // must NOT land in Nov, only in Dec (its own bucket's start).
    expect(counts).toEqual([0, 1, 1]);
  });

  it('honours a shorter window', () => {
    expect(monthlyChurnCounts([], now, 3)).toHaveLength(3);
  });
});

describe('countBy', () => {
  it('counts and ranks, largest first', () => {
    const rows = [
      org('2026-01-01T00:00:00Z', 'active', 'pro'),
      org('2026-01-01T00:00:00Z', 'active', 'pro'),
      org('2026-01-01T00:00:00Z', 'suspended', 'starter'),
    ];
    expect(countBy(rows, 'plan')).toEqual([
      { label: 'pro', value: 2 },
      { label: 'starter', value: 1 },
    ]);
    expect(countBy(rows, 'status')).toEqual([
      { label: 'active', value: 2 },
      { label: 'suspended', value: 1 },
    ]);
  });

  it('breaks a tie alphabetically so the order does not flicker between reads', () => {
    const rows = [
      org('2026-01-01T00:00:00Z', 'active', 'zeta'),
      org('2026-01-01T00:00:00Z', 'active', 'alpha'),
    ];
    expect(countBy(rows, 'plan').map((r) => r.label)).toEqual(['alpha', 'zeta']);
  });

  it('folds blank values into Unknown', () => {
    expect(countBy([org('2026-01-01T00:00:00Z', 'active', '  ')], 'plan')).toEqual([
      { label: 'Unknown', value: 1 },
    ]);
  });

  it('returns nothing for no rows', () => {
    expect(countBy([], 'plan')).toEqual([]);
  });
});

describe('humaniseKey', () => {
  it('sentence-cases a snake_case key', () => {
    expect(humaniseKey('past_due')).toBe('Past due');
    expect(humaniseKey('active')).toBe('Active');
  });

  it('falls back to Unknown for an empty value', () => {
    expect(humaniseKey('   ')).toBe('Unknown');
  });
});
