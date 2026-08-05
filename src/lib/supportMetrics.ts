/**
 * The figures the Support Centre reports, over case rows.
 *
 * Medians rather than means throughout. One case that sat over a bank holiday
 * weekend moves a mean by hours and tells you nothing about the queue; the
 * median is what the team actually experiences.
 *
 * Every function returns `null` when there is nothing to measure, and the
 * screen prints "—". A median first response of zero minutes would be the most
 * flattering possible reading of having answered nothing.
 */

export interface CaseLike {
  status: string;
  priority: string;
  created_at: string;
  first_response_at: string | null;
  resolved_at: string | null;
  csat: number | null;
}

const OPEN_STATUSES = new Set(['open', 'pending', 'on_hold']);

export function isOpen(status: string): boolean {
  return OPEN_STATUSES.has(status);
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function minutesBetween(from: string, to: string | null): number | null {
  if (!to) return null;
  const ms = Date.parse(to) - Date.parse(from);
  return Number.isFinite(ms) && ms >= 0 ? ms / 60_000 : null;
}

export function openCases(rows: readonly CaseLike[]): number {
  return rows.filter((r) => isOpen(r.status)).length;
}

export function urgentOpenCases(rows: readonly CaseLike[]): number {
  return rows.filter((r) => isOpen(r.status) && r.priority === 'urgent').length;
}

/**
 * Cases that are open and have never had a reply.
 *
 * The number that matters most on this screen: an unanswered case is the one
 * a customer is currently forming an opinion about.
 */
export function awaitingFirstResponse(rows: readonly CaseLike[]): number {
  return rows.filter((r) => isOpen(r.status) && r.first_response_at === null).length;
}

/** Median minutes from arrival to the first public reply, over answered cases. */
export function medianFirstResponseMinutes(rows: readonly CaseLike[]): number | null {
  return median(
    rows
      .map((r) => minutesBetween(r.created_at, r.first_response_at))
      .filter((v): v is number => v !== null),
  );
}

/** Median minutes from arrival to resolution, over resolved cases. */
export function medianResolutionMinutes(rows: readonly CaseLike[]): number | null {
  return median(
    rows
      .map((r) => minutesBetween(r.created_at, r.resolved_at))
      .filter((v): v is number => v !== null),
  );
}

/** Mean satisfaction out of 5, to one decimal, over cases that were rated. */
export function averageCsat(rows: readonly CaseLike[]): number | null {
  const scores = rows.map((r) => r.csat).filter((v): v is number => v !== null);
  if (scores.length === 0) return null;
  return Math.round((scores.reduce((a, b) => a + b, 0) / scores.length) * 10) / 10;
}

export function csatResponses(rows: readonly CaseLike[]): number {
  return rows.filter((r) => r.csat !== null).length;
}

/**
 * "2h 14m" / "35m" — durations in the units a support team talks in.
 *
 * Days appear above 24 hours, because "38h" is a number people have to convert
 * in their head before it means anything.
 */
export function formatMinutes(minutes: number | null): string {
  if (minutes === null || !Number.isFinite(minutes)) return '—';
  const total = Math.round(minutes);
  if (total < 60) return `${total}m`;
  if (total < 1440) {
    const h = Math.floor(total / 60);
    const m = total % 60;
    return m === 0 ? `${h}h` : `${h}h ${m}m`;
  }
  const d = Math.floor(total / 1440);
  const h = Math.round((total % 1440) / 60);
  return h === 0 ? `${d}d` : `${d}d ${h}h`;
}

/** Open cases by priority, urgent first — the queue's shape at a glance. */
export function openByPriority(
  rows: readonly CaseLike[],
): { priority: string; count: number }[] {
  const order = ['urgent', 'high', 'normal', 'low'];
  return order.map((priority) => ({
    priority,
    count: rows.filter((r) => isOpen(r.status) && r.priority === priority).length,
  }));
}
