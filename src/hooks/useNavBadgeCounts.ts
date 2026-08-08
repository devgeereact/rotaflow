import { useEffect, useState } from 'react';
import { countPendingLeaveRequests } from '@/services/leaveService';
import { countSwapsNeedingAttention } from '@/services/swapService';
import { reportError } from '@/lib/sentry';

const POLL_MS = 60_000;

export interface NavBadgeCounts {
  leave: number;
  swaps: number;
}

/**
 * Pending-item counts for the sidebar's Leave and Shift Swaps rows.
 *
 * Polls rather than subscribing to Realtime, the same trade-off
 * `NotificationBell` already makes for the same reason: this mounts on every
 * `/app/*` page via `Sidebar`, and a live channel per tab for two numbers is
 * more infrastructure than the badge is worth. It would also collide: both
 * counts poll the same `leave_requests`/`shift_swaps` tables that
 * `LeavePage`/`SwapsPage` already subscribe to with `useRealtimeRefresh`, and
 * that hook names its channel from the table set alone, so a second
 * subscriber with the same org and the same tables reuses the first
 * subscriber's already-`subscribe()`d channel object and throws.
 *
 * RLS scopes each count to the caller already (leave is "own row or
 * manager", swaps are "involved staff or manager"), so this reads as "your
 * pending requests" for staff and "the approval queue" for a manager with no
 * role branching here.
 */
export function useNavBadgeCounts(orgId: string | null): NavBadgeCounts {
  const [counts, setCounts] = useState<NavBadgeCounts>({ leave: 0, swaps: 0 });

  useEffect(() => {
    if (!orgId) {
      setCounts({ leave: 0, swaps: 0 });
      return;
    }
    let active = true;

    const refresh = (): void => {
      void Promise.all([
        countPendingLeaveRequests(orgId),
        countSwapsNeedingAttention(orgId),
      ])
        .then(([leave, swaps]) => {
          if (active) setCounts({ leave, swaps });
        })
        .catch((err: unknown) => reportError(err, { area: 'navBadges:poll' }));
    };

    refresh();
    const interval = setInterval(refresh, POLL_MS);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [orgId]);

  return counts;
}
