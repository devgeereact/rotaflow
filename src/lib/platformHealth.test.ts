import { describe, expect, it } from 'vitest';
import {
  LATENCY_DEGRADED_MS,
  LATENCY_DOWN_MS,
  classifyProbeFailure,
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

describe('classifyProbeFailure', () => {
  // The defect this guards: every probe collapsed each of its failure modes to
  // `down`, and the page then WROTE that verdict into `platform_health_samples`.
  // Realtime has no scheduled probe (0076 covers database, auth and REST only),
  // so its uptime comes entirely from console samples — meaning one
  // administrator's blocked websocket permanently lowered the figure everyone
  // else reads.

  it('an offline browser cannot judge the platform, and is not recorded', () => {
    const result = classifyProbeFailure({ online: false });
    expect(result.status).toBe('unknown');
    expect(result.attributable).toBe(false);
  });

  it('an RLS refusal is an authorisation result, not an outage', () => {
    const result = classifyProbeFailure({ online: true, code: '42501' });
    expect(result.status).toBe('unknown');
    expect(result.attributable).toBe(false);
    expect(result.reason).toContain('42501');
  });

  it("a missing or expired JWT is the caller's problem, not the service's", () => {
    for (const code of ['PGRST301', 'PGRST302']) {
      const result = classifyProbeFailure({ online: true, code });
      expect(result.status).toBe('unknown');
      expect(result.attributable).toBe(false);
    }
  });

  it('a timeout with the browser online IS the platform, and is recorded', () => {
    const result = classifyProbeFailure({ online: true, timedOut: true });
    expect(result.status).toBe('down');
    expect(result.attributable).toBe(true);
  });

  it('an unrecognised error with the browser online is still an outage', () => {
    // The default must stay `down`. Treating an unknown code as "cannot check"
    // would be the opposite failure: a real outage recorded as nothing.
    const result = classifyProbeFailure({ online: true, code: '08006' });
    expect(result.status).toBe('down');
    expect(result.attributable).toBe(true);
  });

  it('offline outranks a caller-fault code', () => {
    const result = classifyProbeFailure({ online: false, code: '42501' });
    expect(result.reason).toContain('offline');
  });
});
