import type { LeaveRequest } from '@/types';

/**
 * Leave entitlement arithmetic.
 *
 * Lives in `src/lib`, not `src/services`, because it is pure: it takes rows and
 * returns a number, and touches no SDK. That is not a stylistic preference,
 * `src/services/leaveService.ts` imports `@/lib/supabase`, which calls
 * `createClient` at module scope, which initialises Realtime, which needs a
 * global `WebSocket`. Node 20 does not have one, so merely importing the
 * service to reach this function crashed the test run with
 * "Node.js detected but native WebSocket not found". A pure helper should never
 * drag a websocket client behind it.
 */

/**
 * Approved leave days used within [fromDate, toDate), for the entitlement
 * summary against `staff_profiles.holiday_allowance`. Counts inclusive
 * calendar days per request (end_date - start_date + 1), not working days:
 * the schema has no working-pattern data to exclude weekends/off-days
 * correctly, so a coarser count is honest where a precise one would be a
 * guess dressed up as precision.
 */
export function sumApprovedLeaveDays(
  requests: LeaveRequest[],
  fromDate: string,
  toDate: string,
): number {
  // [fromDate, toDate) — clip each request to this window before counting.
  // A request overlapping the boundary (28 Dec – 3 Jan across a year split)
  // used to count its FULL span against both years, so 9 days taken read as
  // 9+9=18 days of allowance consumed. The overlap filter below already
  // selects the request; only the day count needs clipping.
  const windowStart = new Date(fromDate).getTime();
  const windowLastDay = new Date(toDate).getTime() - 86_400_000;
  return requests
    .filter(
      (r) => r.status === 'approved' && r.start_date < toDate && r.end_date >= fromDate,
    )
    .reduce((total, r) => {
      const start = Math.max(new Date(r.start_date).getTime(), windowStart);
      const end = Math.min(new Date(r.end_date).getTime(), windowLastDay);
      const days = Math.round((end - start) / 86_400_000) + 1;
      return total + Math.max(0, days);
    }, 0);
}
