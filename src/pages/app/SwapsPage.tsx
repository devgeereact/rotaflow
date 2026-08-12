import { useCallback, useEffect, useMemo, useState } from 'react';
import { isThisMonth } from 'date-fns';
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
import {
  cancelShiftSwap,
  listMyShiftSwaps,
  listOrgShiftSwaps,
  requestShiftSwap,
  respondToShiftSwap,
  reviewShiftSwap,
  type ShiftSwapWithShift,
} from '@/services/swapService';
import { reportError } from '@/lib/sentry';
import { toSwapRow } from '@/lib/swapMapping';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { SwapsView, type SwapsTiles } from '@/components/swaps/SwapsView';
import type { OfferShiftDraft } from '@/components/swaps/OfferShiftModal';
import type { SwapRow } from '@/lib/swapRows';
import type { Location, Shift, StaffProfile } from '@/types';

/**
 * `/app/swaps` (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.swaps`):
 * request as staff, respond as the targeted colleague, approve or decline
 * as a manager.
 *
 * Approving moves the shift (see `handleManagerDecision`): it used to only
 * mark the row `approved`, leaving reassignment to the rota builder, but
 * that left the rota — what staff actually read — disagreeing with the
 * decision both parties had just been notified about.
 *
 * The reference's "Take this shift" button is deliberately absent: RLS only
 * lets a swap's already-named target respond (`0008_shift_swaps_target_
 * respond.sql`), nobody can write themselves onto an open request today, and
 * a fake claim button would tell a colleague their tap did something it did
 * not.
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
        const [mine, staffRows, locationRows] = await Promise.all([
          getMyStaffProfile(orgId, user.id),
          listActiveStaff(orgId),
          listLocations(orgId),
        ]);
        if (!active) return;
        setMyProfile(mine);
        setStaff(staffRows);
        setLocations(locationRows);

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

        // Managers review the whole org; staff only see swaps they are part of.
        const rows = canApprove
          ? await listOrgShiftSwaps(orgId)
          : mine
            ? await listMyShiftSwaps(mine.id)
            : [];
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
  }, [orgId, user, canApprove, reloadKey, showError]);

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
    () => ({ staffById, locationsById, userId: user?.id ?? null }),
    [staffById, locationsById, user],
  );

  const rows = useMemo<SwapRow[]>(
    () =>
      [...swaps]
        .sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        )
        .map((swap) => toSwapRow(swap, context)),
    [swaps, context],
  );

  const tiles = useMemo<SwapsTiles>(() => {
    const waitingOnYou = canApprove
      ? rows.filter((r) => r.status === 'open' || r.status === 'awaiting_manager').length
      : rows.filter(
          (r) => r.status === 'awaiting_colleague' && r.toStaffId === myProfile?.id,
        ).length;
    return {
      openOnBoard: rows.filter((r) => r.status === 'open').length,
      waitingOnYou,
      approvedThisMonth: swaps.filter(
        (s) =>
          s.status === 'approved' && isThisMonth(new Date(s.reviewed_at ?? s.updated_at)),
      ).length,
      declined: swaps.filter((s) => s.status === 'rejected').length,
    };
  }, [rows, swaps, canApprove, myProfile]);

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
          showSuccess('Posted to the swap board.');
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
            ? 'Swap accepted. Awaiting manager approval.'
            : 'Swap declined.',
        );
      } catch (err) {
        reportError(err, { area: 'swaps:respond' });
        showError('Could not respond to that swap.');
      }
    },
    [showError, showSuccess],
  );

  const handleManagerDecision = useCallback(
    async (row: SwapRow, status: 'approved' | 'rejected'): Promise<void> => {
      if (!user || !orgId) return;
      try {
        const swap = swaps.find((s) => s.id === row.id);
        await reviewShiftSwap(row.id, status, user.id);

        // An approved swap moves the shift. Ordered after `reviewShiftSwap`
        // deliberately: if the reassignment fails, the swap stays approved
        // and the shift stays put, which is visible and correctable.
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

  if (loading) {
    return <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>;
  }

  if (loadFailed) {
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
        canApprove={canApprove}
        viewerStaffId={myProfile?.id ?? null}
        tiles={tiles}
        rows={rows}
        emptyMessage="No swap requests."
        myShifts={myShifts}
        colleagues={colleagues}
        onOfferShift={handleOfferShift}
        offline={!online}
        onManagerDecision={handleManagerDecision}
        onColleagueDecision={handleColleagueDecision}
        onWithdraw={handleWithdraw}
      />
    </>
  );
}
