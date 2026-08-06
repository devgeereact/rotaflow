/**
 * The six figures the incident screen reports, derived from incident rows.
 *
 * In `lib` rather than beside the service because these are pure arithmetic
 * over data already fetched, and the suite runs them in Node. Importing a
 * service would pull in the Supabase client, which needs a WebSocket Node
 * does not have.
 *
 * Every function here returns `null` rather than a zero when there is nothing
 * to measure. A mean time to resolve of "0m" reads as instant recovery; "-"
 * reads as what it is.
 */

export interface IncidentLike {
  severity: string;
  status: string;
  started_at: string;
  detected_at: string | null;
  resolved_at: string | null;
}

/** Whole minutes between two ISO timestamps, or null if either is missing. */
function minutesBetween(from: string | null, to: string | null): number | null {
  if (!from || !to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  if (!Number.isFinite(ms) || ms < 0) return null;
  return ms / 60_000;
}

/**
 * "4m 20s". The shape an incident review reads in.
 *
 * Seconds are kept below an hour and dropped above it: nobody cares that the
 * outage lasted 1h 06m 12s, and the extra precision makes the number harder to
 * compare at a glance.
 */
export function formatDuration(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return '-';
  const total = Math.round(minutes * 60);
  if (total < 60) return `${total}s`;
  if (total < 3600) {
    const m = Math.floor(total / 60);
    const s = total % 60;
    return s === 0 ? `${m}m` : `${m}m ${s}s`;
  }
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  return m === 0 ? `${h}h` : `${h}h ${String(m).padStart(2, '0')}m`;
}

export function openIncidents(rows: readonly IncidentLike[]): number {
  return rows.filter((r) => r.status !== 'resolved').length;
}

/** Criticals started in the window. Counted by start, not by resolution. */
export function criticalsSince(
  rows: readonly IncidentLike[],
  now: Date,
  days = 90,
): number {
  const cutoff = now.getTime() - days * 86_400_000;
  return rows.filter(
    (r) => r.severity === 'critical' && Date.parse(r.started_at) >= cutoff,
  ).length;
}

/**
 * Mean minutes from start to detection.
 *
 * Only incidents that recorded a detection time count. An incident declared
 * the moment it was noticed has a detect time of zero, which is real and
 * should pull the mean down; one that never recorded detection is unknown and
 * must not count as zero.
 */
export function meanTimeToDetect(rows: readonly IncidentLike[]): number | null {
  const spans = rows
    .map((r) => minutesBetween(r.started_at, r.detected_at))
    .filter((v): v is number => v !== null);
  if (spans.length === 0) return null;
  return spans.reduce((a, b) => a + b, 0) / spans.length;
}

/** Mean minutes from start to resolution, over resolved incidents only. */
export function meanTimeToResolve(rows: readonly IncidentLike[]): number | null {
  const spans = rows
    .map((r) => minutesBetween(r.started_at, r.resolved_at))
    .filter((v): v is number => v !== null);
  if (spans.length === 0) return null;
  return spans.reduce((a, b) => a + b, 0) / spans.length;
}

/** Incidents started in the calendar month containing `now`. */
export function startedThisMonth(rows: readonly IncidentLike[], now: Date): number {
  return rows.filter((r) => {
    const d = new Date(r.started_at);
    return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth();
  }).length;
}

/** Incidents started in the calendar month before the one containing `now`. */
export function startedLastMonth(rows: readonly IncidentLike[], now: Date): number {
  // Day 1 avoids the 31st-of-the-month trap: `setMonth(-1)` on 31 March lands
  // in March again, and the comparison would then be month-against-itself.
  const previous = new Date(now.getFullYear(), now.getMonth(), 1);
  previous.setMonth(previous.getMonth() - 1);
  return rows.filter((r) => {
    const d = new Date(r.started_at);
    return (
      d.getFullYear() === previous.getFullYear() && d.getMonth() === previous.getMonth()
    );
  }).length;
}

/** "+2" / "−1" / "0", month over month. The sign is the point. */
export function monthOverMonth(current: number, previous: number): string {
  const delta = current - previous;
  if (delta === 0) return '0';
  // A real minus sign, not a hyphen: it sits on the digit baseline.
  return delta > 0 ? `+${delta}` : `−${Math.abs(delta)}`;
}
