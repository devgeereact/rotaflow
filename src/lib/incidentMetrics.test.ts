import { describe, expect, it } from 'vitest';
import {
  criticalsSince,
  formatDuration,
  meanTimeToDetect,
  meanTimeToResolve,
  monthOverMonth,
  openIncidents,
  startedLastMonth,
  startedThisMonth,
  type IncidentLike,
} from '@/lib/incidentMetrics';

function incident(over: Partial<IncidentLike> = {}): IncidentLike {
  return {
    severity: 'medium',
    status: 'resolved',
    started_at: '2026-08-01T09:00:00Z',
    detected_at: '2026-08-01T09:04:00Z',
    resolved_at: '2026-08-01T10:06:00Z',
    ...over,
  };
}

describe('formatDuration', () => {
  it('shows seconds under a minute', () => {
    expect(formatDuration(0.5)).toBe('30s');
  });

  it('shows minutes and seconds under an hour', () => {
    expect(formatDuration(4 + 20 / 60)).toBe('4m 20s');
  });

  it('drops the seconds above an hour', () => {
    expect(formatDuration(66)).toBe('1h 06m');
  });

  it('drops a zero minutes remainder', () => {
    expect(formatDuration(120)).toBe('2h');
  });

  it('is an em dash when there is nothing to measure', () => {
    expect(formatDuration(null)).toBe('—');
  });
});

describe('openIncidents', () => {
  it('counts everything that is not resolved', () => {
    expect(
      openIncidents([
        incident({ status: 'investigating' }),
        incident({ status: 'monitoring' }),
        incident({ status: 'resolved' }),
      ]),
    ).toBe(2);
  });
});

describe('criticalsSince', () => {
  const now = new Date('2026-08-05T12:00:00Z');

  it('counts criticals inside the window', () => {
    expect(
      criticalsSince(
        [
          incident({ severity: 'critical', started_at: '2026-07-22T09:00:00Z' }),
          incident({ severity: 'high', started_at: '2026-07-22T09:00:00Z' }),
        ],
        now,
      ),
    ).toBe(1);
  });

  it('excludes a critical older than the window', () => {
    expect(
      criticalsSince(
        [incident({ severity: 'critical', started_at: '2026-01-01T09:00:00Z' })],
        now,
      ),
    ).toBe(0);
  });
});

describe('meanTimeToDetect', () => {
  it('averages the incidents that recorded a detection', () => {
    expect(
      meanTimeToDetect([
        incident({ detected_at: '2026-08-01T09:02:00Z' }),
        incident({ detected_at: '2026-08-01T09:06:00Z' }),
      ]),
    ).toBe(4);
  });

  it('ignores an incident with no detection time rather than counting it as zero', () => {
    expect(
      meanTimeToDetect([
        incident({ detected_at: '2026-08-01T09:10:00Z' }),
        incident({ detected_at: null }),
      ]),
    ).toBe(10);
  });

  it('is null when nothing recorded one', () => {
    expect(meanTimeToDetect([incident({ detected_at: null })])).toBeNull();
  });

  it('drops a detection dated before the start', () => {
    expect(
      meanTimeToDetect([
        incident({
          started_at: '2026-08-01T09:00:00Z',
          detected_at: '2026-08-01T08:00:00Z',
        }),
      ]),
    ).toBeNull();
  });
});

describe('meanTimeToResolve', () => {
  it('averages resolved incidents only', () => {
    expect(
      meanTimeToResolve([
        incident({ resolved_at: '2026-08-01T10:00:00Z' }),
        incident({ status: 'investigating', resolved_at: null }),
      ]),
    ).toBe(60);
  });
});

describe('month counting', () => {
  const now = new Date('2026-08-05T12:00:00Z');

  it('counts this month and last month separately', () => {
    const rows = [
      incident({ started_at: '2026-08-01T09:00:00Z' }),
      incident({ started_at: '2026-08-04T09:00:00Z' }),
      incident({ started_at: '2026-07-22T09:00:00Z' }),
    ];
    expect(startedThisMonth(rows, now)).toBe(2);
    expect(startedLastMonth(rows, now)).toBe(1);
  });

  it('rolls the year backwards in January', () => {
    const january = new Date('2026-01-15T12:00:00Z');
    expect(
      startedLastMonth([incident({ started_at: '2025-12-20T09:00:00Z' })], january),
    ).toBe(1);
  });

  it('does not land back in the same month from a 31st', () => {
    // `setMonth(-1)` on 31 March gives 3 March. Anchoring to day 1 first is
    // what stops last month being March again.
    const march31 = new Date('2026-03-31T12:00:00Z');
    expect(
      startedLastMonth([incident({ started_at: '2026-02-14T09:00:00Z' })], march31),
    ).toBe(1);
    expect(
      startedLastMonth([incident({ started_at: '2026-03-05T09:00:00Z' })], march31),
    ).toBe(0);
  });
});

describe('monthOverMonth', () => {
  it('signs an increase and a decrease', () => {
    expect(monthOverMonth(6, 4)).toBe('+2');
    expect(monthOverMonth(4, 6)).toBe('−2');
    expect(monthOverMonth(4, 4)).toBe('0');
  });
});
