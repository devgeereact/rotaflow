import { describe, expect, it } from 'vitest';
import {
  LATENCY_DEGRADED_MS,
  LATENCY_DOWN_MS,
  formatLatency,
  overallStatus,
  statusForLatency,
  statusLabel,
  summarise,
  type HealthCheck,
} from '@/lib/platformHealth';

function check(partial: Partial<HealthCheck>): HealthCheck {
  return { name: 'Service', status: 'operational', detail: 'ok', ...partial };
}

describe('statusForLatency', () => {
  it('calls a fast round trip operational', () => {
    expect(statusForLatency(0)).toBe('operational');
    expect(statusForLatency(120)).toBe('operational');
  });

  it('degrades exactly at the threshold, not just past it', () => {
    expect(statusForLatency(LATENCY_DEGRADED_MS - 1)).toBe('operational');
    expect(statusForLatency(LATENCY_DEGRADED_MS)).toBe('degraded');
  });

  it('reports down exactly at the threshold, not just past it', () => {
    expect(statusForLatency(LATENCY_DOWN_MS - 1)).toBe('degraded');
    expect(statusForLatency(LATENCY_DOWN_MS)).toBe('down');
  });
});

describe('overallStatus', () => {
  it('is unknown when nothing has run', () => {
    expect(overallStatus([])).toBe('unknown');
  });

  it('is operational only when every check is', () => {
    expect(overallStatus([check({}), check({})])).toBe('operational');
  });

  it('lets a single failure outrank any number of passes', () => {
    const checks = [check({}), check({}), check({ status: 'down' }), check({})];
    expect(overallStatus(checks)).toBe('down');
  });

  it('ranks down above degraded above unknown above operational', () => {
    expect(overallStatus([check({ status: 'degraded' }), check({})])).toBe('degraded');
    expect(overallStatus([check({ status: 'unknown' }), check({})])).toBe('unknown');
    expect(
      overallStatus([check({ status: 'down' }), check({ status: 'degraded' })]),
    ).toBe('down');
  });
});

describe('summarise', () => {
  it('says so when nothing has run', () => {
    expect(summarise([])).toBe('No checks have run yet');
  });

  it('counts by status, worst first', () => {
    const checks = [
      check({}),
      check({}),
      check({ status: 'degraded' }),
      check({ status: 'down' }),
    ];
    expect(summarise(checks)).toBe('1 down, 1 degraded, 2 operational');
  });

  it('omits statuses that did not occur', () => {
    expect(summarise([check({}), check({})])).toBe('2 operational');
  });
});

describe('formatLatency', () => {
  it('renders an em dash when nothing was measured', () => {
    expect(formatLatency(undefined)).toBe('-');
  });

  it('avoids spurious precision below a millisecond', () => {
    expect(formatLatency(0.4)).toBe('<1 ms');
  });

  it('rounds milliseconds', () => {
    expect(formatLatency(123.6)).toBe('124 ms');
  });

  it('switches to seconds at a thousand milliseconds', () => {
    expect(formatLatency(999)).toBe('999 ms');
    expect(formatLatency(1_000)).toBe('1.0 s');
    expect(formatLatency(2_450)).toBe('2.5 s');
  });
});

describe('statusLabel', () => {
  it('gives every status a word, including the fallback', () => {
    expect(statusLabel('operational')).toBe('Operational');
    expect(statusLabel('degraded')).toBe('Degraded');
    expect(statusLabel('down')).toBe('Down');
    expect(statusLabel('unknown')).toBe('Unknown');
  });
});
