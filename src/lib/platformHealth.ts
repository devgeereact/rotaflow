/**
 * Platform health — the pure half.
 *
 * Status derivation, thresholds and summarising live here rather than in
 * `services/` so they can be unit-tested under Node. Anything importing
 * `lib/supabase` drags in a WebSocket the test environment does not have, so
 * the probes themselves sit in `services/platformHealthService.ts` and hand
 * their raw results back here to be judged.
 */

/** Where a check ended up. Ordered worst-last so `Math.max` picks the winner. */
export type HealthStatus = 'operational' | 'degraded' | 'down' | 'unknown';

const SEVERITY: Record<HealthStatus, number> = {
  operational: 0,
  unknown: 1,
  degraded: 2,
  down: 3,
};

export interface HealthCheck {
  /** Service name as an administrator would say it out loud. */
  name: string;
  status: HealthStatus;
  /** Round-trip in milliseconds, where the check measured one. */
  latencyMs?: number;
  /** One line explaining the status. Always populated — never leave a bare pill. */
  detail: string;
  /**
   * True when the answer comes from configuration rather than a live probe.
   * Surfaced in the UI so nobody reads "operational" as "we just checked".
   */
  configuredOnly?: boolean;
}

/**
 * Latency thresholds for a Supabase round trip from a browser.
 *
 * Generous on purpose: this measures the user's own connection as much as the
 * platform's, so a manager on hotel wifi should not see "degraded" for what is
 * their own network. The point of the number is to catch an order-of-magnitude
 * change, not to police a hundred milliseconds.
 */
export const LATENCY_DEGRADED_MS = 1_500;
export const LATENCY_DOWN_MS = 5_000;

/** Judge a completed round trip. Exported for the probe layer and its tests. */
export function statusForLatency(ms: number): HealthStatus {
  if (ms >= LATENCY_DOWN_MS) return 'down';
  if (ms >= LATENCY_DEGRADED_MS) return 'degraded';
  return 'operational';
}

/**
 * The worst status across a set of checks — that is what the page headline
 * should report. A single hard failure outranks any number of green ticks.
 */
export function overallStatus(checks: readonly HealthCheck[]): HealthStatus {
  if (checks.length === 0) return 'unknown';
  return checks.reduce<HealthStatus>(
    (worst, check) => (SEVERITY[check.status] > SEVERITY[worst] ? check.status : worst),
    'operational',
  );
}

/** Human summary for the headline, e.g. "1 degraded, 6 operational". */
export function summarise(checks: readonly HealthCheck[]): string {
  if (checks.length === 0) return 'No checks have run yet';
  const counts = new Map<HealthStatus, number>();
  for (const check of checks) {
    counts.set(check.status, (counts.get(check.status) ?? 0) + 1);
  }
  const order: HealthStatus[] = ['down', 'degraded', 'unknown', 'operational'];
  const label: Record<HealthStatus, string> = {
    down: 'down',
    degraded: 'degraded',
    unknown: 'unknown',
    operational: 'operational',
  };
  return order
    .filter((status) => counts.has(status))
    .map((status) => `${counts.get(status) ?? 0} ${label[status]}`)
    .join(', ');
}

/** Pill copy. Sentence case, because these sit inside prose-ish cards. */
export function statusLabel(status: HealthStatus): string {
  switch (status) {
    case 'operational':
      return 'Operational';
    case 'degraded':
      return 'Degraded';
    case 'down':
      return 'Down';
    default:
      return 'Unknown';
  }
}

/**
 * Latency, rounded the way a person would say it. Sub-millisecond readings are
 * meaningless over a network, so anything under 1ms reports as "<1 ms" rather
 * than a spuriously precise "0.4 ms".
 */
export function formatLatency(ms: number | undefined): string {
  if (ms === undefined) return '—';
  if (ms < 1) return '<1 ms';
  if (ms < 1_000) return `${Math.round(ms)} ms`;
  return `${(ms / 1_000).toFixed(1)} s`;
}
