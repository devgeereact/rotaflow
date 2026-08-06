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
  return requests
    .filter(
      (r) => r.status === 'approved' && r.start_date < toDate && r.end_date >= fromDate,
    )
    .reduce((total, r) => {
      const start = new Date(r.start_date).getTime();
      const end = new Date(r.end_date).getTime();
      const days = Math.round((end - start) / 86_400_000) + 1;
      return total + Math.max(0, days);
    }, 0);
}
