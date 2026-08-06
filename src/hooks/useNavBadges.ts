import { useCallback, useEffect, useState } from 'react';
import { countPendingLeaveRequests } from '@/services/leaveService';
import { countPendingShiftSwaps } from '@/services/swapService';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { reportError } from '@/lib/sentry';

export interface NavBadgeCounts {
  leave: number;
  swaps: number;
}

const EMPTY: NavBadgeCounts = { leave: 0, swaps: 0 };

/**
 * Live counts for the sidebar's Leave and Shift Swaps rows.
 *
 * Both counts come back already scoped correctly for whoever is signed in:
 * `countPendingLeaveRequests` / `countPendingShiftSwaps` run through RLS, so a
 * manager gets the org's pending queue and a staff member gets only their own
 * still-pending requests, the count of things *they* can act on, with no
 * role branching needed here.
 *
 * Realtime keeps it current without the sidebar polling on every screen; see
 * `useRealtimeRefresh`'s "signal, never data" rule, an approval elsewhere
 * re-queries the count rather than trusting the payload.
 */
export function useNavBadges(orgId: string | null): NavBadgeCounts {
  const [counts, setCounts] = useState<NavBadgeCounts>(EMPTY);

  const refresh = useCallback(() => {
    if (!orgId) {
      setCounts(EMPTY);
      return;
    }
    void Promise.all([countPendingLeaveRequests(orgId), countPendingShiftSwaps(orgId)])
      .then(([leave, swaps]) => setCounts({ leave, swaps }))
      .catch((err: unknown) => reportError(err, { area: 'useNavBadges' }));
  }, [orgId]);

  useEffect(refresh, [refresh]);

  useRealtimeRefresh({
    tables: ['leave_requests', 'shift_swaps'],
    scope: { column: 'org_id', value: orgId },
    onChange: refresh,
  });

  return counts;
}
