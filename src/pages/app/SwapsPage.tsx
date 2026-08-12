import { useCallback, useEffect, useMemo, useState } from 'react';
import { BadgeCheck, CalendarClock, Clock3, ShieldCheck, Users } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { FailedWritesNotice } from '@/components/FailedWritesNotice';
import { useInngestDispatch } from '@/hooks/useInngestDispatch';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { getMyStaffProfile, listActiveStaff } from '@/services/staffService';
import { listShiftsForPeriod, updateShift } from '@/services/shiftService';
import { listLocations } from '@/services/locationService';
import { getOrganisation } from '@/services/orgService';
import {
  cancelShiftSwap,
  claimShiftSwap,
  listOrgShiftSwaps,
  requestShiftSwap,
  respondToShiftSwap,
  reviewShiftSwap,
  type ShiftSwapWithShift,
} from '@/services/swapService';
import { reportError } from '@/lib/sentry';
import { toSwapRow } from '@/lib/swapMapping';
import { DEFAULT_POLICIES, schedulingPolicies } from '@/lib/orgPreferences';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SwapsView } from '@/components/swaps/SwapsView';
import type { OfferShiftDraft } from '@/components/swaps/OfferShiftModal';
import type { SwapRule } from '@/components/swaps/SwapRulesCard';
import type { SwapRow } from '@/lib/swapRows';
import type { Location, Shift, StaffProfile } from '@/types';

/**
 * `/app/swaps` (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.swaps`):
 * request as staff, respond as the targeted colleague or claim an open one,
 * then either that colleague's requester or a manager gives the final word
 * — unless Settings → Policies' "Swap approval" toggle keeps every swap
 * manager-gated, the reference's own default.
 *
 * Approving moves the shift (see `handleFinalize`): reassignment runs the
 * same way regardless of who gave the final approval, so the rota never
 * disagrees with what the requester and colleague already settled between
 * themselves (`0043_swap_requester_finalize.sql`).
 */
export function SwapsPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canApprove } = usePermissions();
  const { user } = useSupabaseAuth();
  const online = useOnlineStatus();
  const { enqueue, deadLettered, discard } = useSyncQueue();
  const { send } = useInngestDispatch();
  const { showError, showSuccess } = useToast();

  const [myProfile, setMyProfile] = useState<StaffProfile | null>(null);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [myShifts, setMyShifts] = useState<Shift[]>([]);
  const [swaps, setSwaps] = useState<ShiftSwapWithShift[]>([]);
  const [swapApprovalRequired, setSwapApprovalRequired] = useState(
    DEFAULT_POLICIES.swapApprovalRequired,
  );
  const [minRestHours, setMinRestHours] = useState(DEFAULT_POLICIES.minRestHours);
  const [maxWeeklyHours, setMaxWeeklyHours] = useState(DEFAULT_POLICIES.maxWeeklyHours);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useRealtimeRefresh({
    tables: ['shift_swaps', 'shifts'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => setReloadKey((k) => k + 1),
  });

  useEffect(() => {
    if (!orgId || !user) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const [mine, staffRows, locationRows, org] = await Promise.all([
          getMyStaffProfile(orgId, user.id),
          listActiveStaff(orgId),
          listLocations(orgId),
          getOrganisation(orgId),
        ]);
        if (!active) return;
        setMyProfile(mine);
        setStaff(staffRows);
        setLocations(locationRows);
        const policies = schedulingPolicies(org.settings);
        setSwapApprovalRequired(policies.swapApprovalRequired);
        setMinRestHours(policies.minRestHours);
        setMaxWeeklyHours(policies.maxWeeklyHours);

        if (mine) {
          const now = new Date();
          const inNinetyDays = new Date(now.getTime() + 90 * 86_400_000);
          const upcoming = await listShiftsForPeriod({
            orgId,
            fromIso: now.toISOString(),
            toIso: inNinetyDays.toISOString(),
            staffProfileId: mine.id,
          });
          if (!active) return;
          setMyShifts(upcoming);
        }

        // RLS scopes this correctly for both roles: a manager gets every
        // swap in the org, staff get their own (requester or target) plus
        // the open board (shift_swaps_select_open_board, 0044).
        const rows = await listOrgShiftSwaps(orgId);
        if (!active) return;
        setSwaps(rows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'swaps:load' });
        setLoadFailed(true);
        showError('Could not load shift swaps.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, user, reloadKey, showError]);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const locationsById = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations],
  );
  const colleagues = useMemo(
    () => staff.filter((s) => s.id !== myProfile?.id),
    [staff, myProfile],
  );

  const context = useMemo(
    () => ({
      staffById,
      locationsById,
      canApprove,
      userId: user?.id ?? null,
      viewerStaffId: myProfile?.id ?? null,
      swapApprovalRequired,
    }),
    [staffById, locationsById, canApprove, user, myProfile, swapApprovalRequired],
  );

  const rows: SwapRow[] = useMemo(
    () =>
      [...swaps]
        .sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
        .map((swap) => toSwapRow(swap, context)),
    [swaps, context],
  );

  const rules: SwapRule[] = useMemo(
    () => [
      {
        id: 'rest',
        icon: Clock3,
        label: 'Rest rule',
        value: `Under ${minRestHours} hours between shifts`,
      },
      {
        id: 'weekly',
        icon: CalendarClock,
        label: 'Weekly limit',
        value: `Taking it would pass ${maxWeeklyHours}h`,
      },
      {
        id: 'cover',
        icon: Users,
        label: 'Minimum cover',
        value: 'Set per location',
      },
      {
        id: 'qualification',
        icon: BadgeCheck,
        label: 'Qualification',
        value: 'Reviewed manually',
      },
      {
        id: 'availability',
        icon: ShieldCheck,
        label: 'Availability',
        value: 'Reviewed manually',
      },
    ],
    [minRestHours, maxWeeklyHours],
  );

  const handleOfferShift = useCallback(
    async (draft: OfferShiftDraft): Promise<void> => {
      if (!orgId || !myProfile) return;
      try {
        const input = {
          org_id: orgId,
          shift_id: draft.shiftId,
          requested_by: myProfile.id,
          target_staff_profile_id: draft.targetId || null,
          note: draft.note.trim() || null,
        };
        if (!online) {
          await enqueue('swap', input);
          showSuccess(
            'Swap request saved offline. It will sync when you’re back online.',
          );
        } else {
          await requestShiftSwap(input);
          showSuccess('Swap request submitted.');
          setReloadKey((k) => k + 1);
        }
      } catch (err) {
        reportError(err, { area: 'swaps:request' });
        showError('Could not submit that request. Please try again.');
      }
    },
    [orgId, myProfile, online, enqueue, showError, showSuccess],
  );

  const handleColleagueDecision = useCallback(
    async (row: SwapRow, status: 'accepted' | 'rejected'): Promise<void> => {
      try {
        await respondToShiftSwap(row.id, status);
        setReloadKey((k) => k + 1);
        showSuccess(
          status === 'accepted'
            ? swapApprovalRequired
              ? 'Swap accepted. A manager gives the final word next.'
              : 'Swap accepted. The requester gives the final word next.'
            : 'Swap declined.',
        );
      } catch (err) {
        reportError(err, { area: 'swaps:respond' });
        showError('Could not respond to that swap.');
      }
    },
    [swapApprovalRequired, showError, showSuccess],
  );

  const handleClaim = useCallback(
    async (row: SwapRow): Promise<void> => {
      if (!myProfile) return;
      try {
        await claimShiftSwap(row.id, myProfile.id);
        setReloadKey((k) => k + 1);
        showSuccess(
          `You have offered to take ${row.from.firstName} ${row.from.lastName}’s shift. It now needs approval.`,
        );
      } catch (err) {
        reportError(err, { area: 'swaps:claim' });
        showError('Could not claim that shift.');
      }
    },
    [myProfile, showError, showSuccess],
  );

  /** Shared by a manager's decision and the requester's own final approval — same call, different RLS policy grants it (0043). */
  const handleFinalize = useCallback(
    async (row: SwapRow, status: 'approved' | 'rejected'): Promise<void> => {
      if (!user || !orgId) return;
      try {
        const swap = swaps.find((s) => s.id === row.id);
        await reviewShiftSwap(row.id, status, user.id);

        if (status === 'approved' && swap?.shift_id && swap.target_staff_profile_id) {
          try {
            await updateShift(swap.shift_id, {
              staff_profile_id: swap.target_staff_profile_id,
            });
          } catch (err) {
            reportError(err, { area: 'swaps:reassign-shift' });
            showError(
              'The swap was approved but the shift could not be reassigned. Move it by hand in the Rota Builder.',
            );
          }
        }

        setReloadKey((k) => k + 1);
        showSuccess(
          status === 'approved'
            ? swap?.target_staff_profile_id
              ? 'Swap approved and the shift reassigned.'
              : 'Swap approved. Assign the shift to someone in the Rota Builder.'
            : 'Swap declined.',
        );

        const recipientUserId = swap
          ? staffById.get(swap.requested_by)?.user_id
          : undefined;
        if (recipientUserId) {
          void send('swap/reviewed', {
            orgId,
            userIds: [recipientUserId],
            type: 'swap',
            title: `Your shift swap was ${status}`,
          });
        }
      } catch (err) {
        reportError(err, { area: 'swaps:review' });
        showError('Could not update that swap.');
      }
    },
    [user, orgId, swaps, staffById, send, showError, showSuccess],
  );

  const handleWithdraw = useCallback(
    async (row: SwapRow): Promise<void> => {
      try {
        await cancelShiftSwap(row.id);
        setReloadKey((k) => k + 1);
      } catch (err) {
        reportError(err, { area: 'swaps:cancel' });
        showError('Could not withdraw that request.');
      }
    },
    [showError],
  );

  if (loadFailed && !loading) {
    return (
      <Card>
        <p className="mb-4 text-content-muted dark:text-content-muted-dark">
          Could not load shift swaps.
        </p>
        <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </Card>
    );
  }

  return (
    <>
      <FailedWritesNotice items={deadLettered} onDiscard={discard} className="mb-6" />
      <SwapsView
        rows={rows}
        loading={loading}
        emptyMessage="No swap requests."
        canApprove={canApprove}
        viewerStaffId={myProfile?.id ?? null}
        rules={rules}
        myShifts={myShifts}
        colleagues={colleagues}
        onOfferShift={handleOfferShift}
        offline={!online}
        onManagerDecision={handleFinalize}
        onColleagueDecision={handleColleagueDecision}
        onRequesterFinalize={handleFinalize}
        onClaim={handleClaim}
        onWithdraw={handleWithdraw}
      />
    </>
  );
}
