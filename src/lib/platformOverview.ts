import { format, isBefore, startOfMonth, subMonths } from 'date-fns';

/**
 * Derivations behind `/admin`. The platform overview.
 *
 * Pure, and in `lib` rather than `services`, for the reason the rest of this
 * folder is: the service layer imports the Supabase client, which reaches for a
 * WebSocket that does not exist under Node, so anything imported by a test has
 * to sit this side of the line.
 *
 * Every figure here is derived from rows the console already reads. Where the
 * console reference shows a metric this deployment genuinely cannot produce,
 * that is stated on the screen itself (`DEMO_SECTIONS` in
 * `adminOverviewDemo.ts`) rather than invented here.
 */

/** Organisation columns these derivations need. Narrower than the row type so
 *  the functions can be tested with plain objects. */
export interface OverviewOrg {
  created_at: string;
  status: string;
  plan: string;
}

export interface GrowthPoint {
  /** Short month label, e.g. "Aug". */
  label: string;
  /** Organisations created within that month. */
  created: number;
  /** Organisations in existence by the end of that month. */
  total: number;
}

/**
 * Twelve months of organisation growth, oldest first.
 *
 * Month boundaries come from `date-fns` rather than arithmetic on epoch
 * milliseconds: the tests run in Europe/London and CI builds in UTC, and a
 * month is not a fixed number of milliseconds in either. Adding 30 days across
 * the March or October transition lands an hour out and silently moves a
 * signup between buckets.
 */
export function monthlyGrowth(
  orgs: readonly OverviewOrg[],
  now: Date,
  months = 12,
): GrowthPoint[] {
  const buckets: GrowthPoint[] = [];

  for (let i = months - 1; i >= 0; i -= 1) {
    const start = startOfMonth(subMonths(now, i));
    const nextStart = startOfMonth(subMonths(now, i - 1));

    let created = 0;
    let total = 0;
    for (const org of orgs) {
      const at = new Date(org.created_at);
      if (Number.isNaN(at.getTime())) continue;
      // `isBefore(at, nextStart)` rather than `<= end`: an inclusive end
      // boundary double-counts anything created exactly at midnight on the 1st.
      if (isBefore(at, nextStart)) {
        total += 1;
        if (!isBefore(at, start)) created += 1;
      }
    }

    buckets.push({ label: format(start, 'MMM'), created, total });
  }

  return buckets;
}

export interface Breakdown {
  label: string;
  value: number;
}

/** Counts by a string column, largest first, empty values folded into "Unknown". */
export function countBy(
  rows: readonly OverviewOrg[],
  key: 'plan' | 'status',
): Breakdown[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const raw = row[key]?.trim();
    const label = raw ? raw : 'Unknown';
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value || a.label.localeCompare(b.label));
}

/** Sentence-cases a `snake_case` status or plan for display. */
export function humaniseKey(value: string): string {
  const spaced = value.replace(/_/g, ' ').trim();
  if (!spaced) return 'Unknown';
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}
