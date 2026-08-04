/**
 * Platform incidents — the pure half.
 *
 * Severity ordering, duration and the open/closed distinction. Kept out of
 * `services/` so it can be tested under Node without the Supabase client's
 * WebSocket.
 */

export type IncidentSeverity = 'critical' | 'high' | 'medium' | 'low';

export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';

export interface IncidentEvent {
  id: string;
  authorName: string | null;
  body: string;
  createdAt: string;
}

export interface Incident {
  id: string;
  title: string;
  severity: IncidentSeverity;
  status: IncidentStatus;
  service: string;
  impact: string;
  startedAt: string;
  resolvedAt: string | null;
  ownerName: string | null;
  events: IncidentEvent[];
}

export const SEVERITY_LABELS: Record<IncidentSeverity, string> = {
  critical: 'Critical',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
};

export const STATUS_LABELS: Record<IncidentStatus, string> = {
  investigating: 'Investigating',
  identified: 'Identified',
  monitoring: 'Monitoring',
  resolved: 'Resolved',
};

/**
 * Worst first. Used for sorting, so it is a number rather than a comparison
 * chain that has to be rewritten every time a severity is added.
 */
const SEVERITY_RANK: Record<IncidentSeverity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export function isOpen(status: IncidentStatus): boolean {
  return status !== 'resolved';
}

/**
 * Open incidents first, worst severity first within that, then most recent.
 *
 * The ordering is the screen's whole argument: an operator opening this page
 * during an outage should not have to scan past six resolved items to find the
 * one that is still burning.
 */
export function sortForTriage(incidents: readonly Incident[]): Incident[] {
  return [...incidents].sort((a, b) => {
    const openDiff = Number(isOpen(b.status)) - Number(isOpen(a.status));
    if (openDiff !== 0) return openDiff;

    const sevDiff = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sevDiff !== 0) return sevDiff;

    return b.startedAt.localeCompare(a.startedAt);
  });
}

/**
 * How long an incident ran, or has been running.
 *
 * `now` is a parameter so a list renders against one instant and the tests do
 * not depend on the wall clock.
 */
export function durationMs(
  incident: Pick<Incident, 'startedAt' | 'resolvedAt'>,
  now: Date,
): number {
  const start = new Date(incident.startedAt).getTime();
  const end =
    incident.resolvedAt === null
      ? now.getTime()
      : new Date(incident.resolvedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, end - start);
}

/** Duration in words: "42 minutes", "3 hours 5 minutes", "2 days". */
export function formatDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return 'under a minute';
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'}`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) {
    const rem = minutes % 60;
    const h = `${hours} hour${hours === 1 ? '' : 's'}`;
    return rem === 0 ? h : `${h} ${rem} minute${rem === 1 ? '' : 's'}`;
  }

  const days = Math.floor(hours / 24);
  const remH = hours % 24;
  const d = `${days} day${days === 1 ? '' : 's'}`;
  return remH === 0 ? d : `${d} ${remH} hour${remH === 1 ? '' : 's'}`;
}

/**
 * Mean time to resolve, across the incidents that actually resolved.
 *
 * Open incidents are excluded rather than counted as "so far": including them
 * drags the mean toward whatever is currently broken, which is the one moment
 * the number gets looked at and the one moment it should not move.
 */
export function meanTimeToResolve(incidents: readonly Incident[]): number | null {
  const closed = incidents.filter((i) => i.resolvedAt !== null);
  if (closed.length === 0) return null;
  const total = closed.reduce(
    (sum, i) =>
      sum +
      (new Date(i.resolvedAt as string).getTime() - new Date(i.startedAt).getTime()),
    0,
  );
  return total / closed.length;
}
