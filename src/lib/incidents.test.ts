import { describe, expect, it } from 'vitest';
import {
  durationMs,
  formatDuration,
  isOpen,
  meanTimeToResolve,
  sortForTriage,
  type Incident,
  type IncidentSeverity,
  type IncidentStatus,
} from '@/lib/incidents';

const NOW = new Date('2026-08-04T12:00:00.000Z');
const at = (offsetMs: number): string => new Date(NOW.getTime() + offsetMs).toISOString();

function incident(partial: Partial<Incident>): Incident {
  return {
    id: Math.random().toString(36).slice(2),
    title: 'Something is wrong',
    severity: 'medium',
    status: 'investigating',
    service: 'API',
    impact: 'Requests are slow.',
    startedAt: at(-3_600_000),
    resolvedAt: null,
    ownerName: null,
    events: [],
    ...partial,
  };
}

describe('isOpen', () => {
  it('treats everything except resolved as open', () => {
    const open: IncidentStatus[] = ['investigating', 'identified', 'monitoring'];
    for (const status of open) expect(isOpen(status)).toBe(true);
    expect(isOpen('resolved')).toBe(false);
  });
});

describe('sortForTriage', () => {
  it('puts open incidents above resolved ones regardless of severity', () => {
    // A resolved critical must not outrank a live low — the page is read
    // during an outage and the live one is the job.
    const resolvedCritical = incident({
      id: 'a',
      severity: 'critical',
      status: 'resolved',
      resolvedAt: at(-60_000),
    });
    const openLow = incident({ id: 'b', severity: 'low' });
    expect(sortForTriage([resolvedCritical, openLow]).map((i) => i.id)).toEqual([
      'b',
      'a',
    ]);
  });

  it('ranks by severity within the open set', () => {
    const order: IncidentSeverity[] = ['low', 'critical', 'medium', 'high'];
    const rows = order.map((severity, n) =>
      incident({ id: severity, severity, startedAt: at(-n * 1_000) }),
    );
    expect(sortForTriage(rows).map((i) => i.id)).toEqual([
      'critical',
      'high',
      'medium',
      'low',
    ]);
  });

  it('breaks a severity tie with the most recent first', () => {
    const older = incident({ id: 'older', startedAt: at(-7_200_000) });
    const newer = incident({ id: 'newer', startedAt: at(-600_000) });
    expect(sortForTriage([older, newer]).map((i) => i.id)).toEqual(['newer', 'older']);
  });

  it('does not mutate the array it was given', () => {
    const rows = [
      incident({ id: 'a', severity: 'low' }),
      incident({ id: 'b', severity: 'critical' }),
    ];
    const before = rows.map((i) => i.id);
    sortForTriage(rows);
    expect(rows.map((i) => i.id)).toEqual(before);
  });
});

describe('durationMs', () => {
  it('measures a resolved incident between its own timestamps', () => {
    const i = incident({ startedAt: at(-7_200_000), resolvedAt: at(-3_600_000) });
    expect(durationMs(i, NOW)).toBe(3_600_000);
  });

  it('measures an open incident up to now', () => {
    const i = incident({ startedAt: at(-1_800_000), resolvedAt: null });
    expect(durationMs(i, NOW)).toBe(1_800_000);
  });

  it('never goes negative on a clock-skewed row', () => {
    const i = incident({ startedAt: at(60_000), resolvedAt: null });
    expect(durationMs(i, NOW)).toBe(0);
  });

  it('returns zero rather than NaN for an unparseable timestamp', () => {
    expect(durationMs({ startedAt: 'nope', resolvedAt: null }, NOW)).toBe(0);
  });
});

describe('formatDuration', () => {
  it('handles the sub-minute case', () => {
    expect(formatDuration(30_000)).toBe('under a minute');
  });

  it('pluralises minutes and hours', () => {
    expect(formatDuration(60_000)).toBe('1 minute');
    expect(formatDuration(42 * 60_000)).toBe('42 minutes');
    expect(formatDuration(60 * 60_000)).toBe('1 hour');
    expect(formatDuration(2 * 60 * 60_000)).toBe('2 hours');
  });

  it('adds the remainder only when there is one', () => {
    expect(formatDuration((3 * 60 + 5) * 60_000)).toBe('3 hours 5 minutes');
    expect(formatDuration(3 * 60 * 60_000)).toBe('3 hours');
  });

  it('switches to days past twenty-four hours', () => {
    expect(formatDuration(24 * 60 * 60_000)).toBe('1 day');
    expect(formatDuration(50 * 60 * 60_000)).toBe('2 days 2 hours');
  });
});

describe('meanTimeToResolve', () => {
  it('is null when nothing has resolved', () => {
    expect(meanTimeToResolve([incident({}), incident({})])).toBeNull();
  });

  it('averages only the resolved ones', () => {
    const rows = [
      incident({ startedAt: at(-7_200_000), resolvedAt: at(-3_600_000) }), // 1h
      incident({ startedAt: at(-10_800_000), resolvedAt: at(-3_600_000) }), // 2h
      incident({ startedAt: at(-86_400_000), resolvedAt: null }), // open, huge
    ];
    // The open one would drag this to over eight hours if counted — and it is
    // exactly the moment someone looks at the number.
    expect(meanTimeToResolve(rows)).toBe(1.5 * 3_600_000);
  });
});
