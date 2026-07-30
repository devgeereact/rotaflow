import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Check, Repeat2, X } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { useInngestDispatch } from '@/hooks/useInngestDispatch';
import { useToast } from '@/hooks/useToast';
import { getMyStaffProfile, listActiveStaff } from '@/services/staffService';
import { listShiftsForPeriod } from '@/services/shiftService';
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
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Select } from '@/components/ui/Select';
import type { Shift, ShiftSwap, StaffProfile } from '@/types';

const STATUS_STYLE: Record<ShiftSwap['status'], string> = {
  pending: 'bg-warning/10 text-warning',
  accepted: 'bg-primary/10 text-primary',
  approved: 'bg-success/10 text-success',
  rejected: 'bg-danger/10 text-danger',
  cancelled:
    'bg-surface-border/60 text-content-muted dark:bg-surface-border-dark/60 dark:text-content-muted-dark',
};

const STATUS_LABEL: Record<ShiftSwap['status'], string> = {
  pending: 'Awaiting colleague',
  accepted: 'Awaiting manager',
  approved: 'Approved',
  rejected: 'Rejected',
  cancelled: 'Withdrawn',
};

/**
 * `/app/swaps` — request (staff), respond as the targeted colleague (staff),
 * final approve/reject (manager).
 *
 * Approving here only marks the row `approved` — it does not reassign the
 * shift on the rota. Actually moving the shift is the same write path as any
 * other reassignment in the rota builder, and folding it into an approval
 * click here would bypass that screen's conflict/coverage context. A manager
 * approves the swap here, then reassigns it in the rota builder.
 */
export function SwapsPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canApprove } = usePermissions();
  const { user } = useSupabaseAuth();
  const online = useOnlineStatus();
  const { enqueue } = useSyncQueue();
  const { send } = useInngestDispatch();
  const { showError, showSuccess } = useToast();

  const [teamMode, setTeamMode] = useState(false);
  const [myProfile, setMyProfile] = useState<StaffProfile | null>(null);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [myShifts, setMyShifts] = useState<Shift[]>([]);
  const [swaps, setSwaps] = useState<ShiftSwapWithShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [shiftId, setShiftId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!orgId || !user) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const mine = await getMyStaffProfile(orgId, user.id);
        if (!active) return;
        setMyProfile(mine);

        const staffRows = await listActiveStaff(orgId);
        if (!active) return;
        setStaff(staffRows);

        if (mine && !teamMode) {
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

        const rows = teamMode
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
  }, [orgId, user, teamMode, reloadKey, showError]);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);
  const colleagues = useMemo(
    () => staff.filter((s) => s.id !== myProfile?.id),
    [staff, myProfile],
  );

  const personName = useCallback(
    (id: string | null): string => {
      if (!id) return '—';
      const person = staffById.get(id);
      return person ? `${person.first_name} ${person.last_name}` : 'Unknown';
    },
    [staffById],
  );

  const handleRequest = useCallback(async (): Promise<void> => {
    if (!orgId || !myProfile || !shiftId) return;
    setSubmitting(true);
    try {
      const input = {
        org_id: orgId,
        shift_id: shiftId,
        requested_by: myProfile.id,
        target_staff_profile_id: targetId || null,
        note: note.trim() || null,
      };

      if (!online) {
        await enqueue('swap', input);
        showSuccess('Swap request saved offline — it will sync when you’re back online.');
      } else {
        await requestShiftSwap(input);
        showSuccess('Swap request submitted.');
        setReloadKey((k) => k + 1);
      }
      setShiftId('');
      setTargetId('');
      setNote('');
    } catch (err) {
      reportError(err, { area: 'swaps:request' });
      showError('Could not submit that request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [
    orgId,
    myProfile,
    shiftId,
    targetId,
    note,
    online,
    enqueue,
    showError,
    showSuccess,
  ]);

  const handleRespond = useCallback(
    async (id: string, status: 'accepted' | 'rejected'): Promise<void> => {
      try {
        await respondToShiftSwap(id, status);
        setReloadKey((k) => k + 1);
        showSuccess(
          status === 'accepted'
            ? 'Swap accepted — awaiting manager approval.'
            : 'Swap declined.',
        );
      } catch (err) {
        reportError(err, { area: 'swaps:respond' });
        showError('Could not respond to that swap.');
      }
    },
    [showError, showSuccess],
  );

  const handleReview = useCallback(
    async (id: string, status: 'approved' | 'rejected'): Promise<void> => {
      if (!user || !orgId) return;
      try {
        const swap = swaps.find((s) => s.id === id);
        await reviewShiftSwap(id, status, user.id);
        setReloadKey((k) => k + 1);
        showSuccess(`Swap ${status}.`);

        // Notifies the requester — the swap outcome is theirs, even when the
        // target colleague accepted it first. Fire-and-forget after the write
        // already succeeded and the UI already reflects it.
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

  const handleCancel = useCallback(
    async (id: string): Promise<void> => {
      try {
        await cancelShiftSwap(id);
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
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-2xl text-content dark:text-content-dark">
          {teamMode ? 'Swap approvals' : 'Shift swaps'}
        </h1>
        {canApprove && (
          <div className="flex gap-1" role="group" aria-label="Scope">
            <button
              type="button"
              onClick={() => setTeamMode(false)}
              aria-pressed={!teamMode}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium',
                !teamMode
                  ? 'bg-surface text-primary dark:bg-surface-dark'
                  : 'text-content-muted dark:text-content-muted-dark',
              )}
            >
              My swaps
            </button>
            <button
              type="button"
              onClick={() => setTeamMode(true)}
              aria-pressed={teamMode}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium',
                teamMode
                  ? 'bg-surface text-primary dark:bg-surface-dark'
                  : 'text-content-muted dark:text-content-muted-dark',
              )}
            >
              Approvals
            </button>
          </div>
        )}
      </div>

      {!teamMode && (
        <Card className="mb-6">
          <h2 className="mb-4 font-medium text-content dark:text-content-dark">
            Request a swap
          </h2>
          {myShifts.length === 0 ? (
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              You have no published upcoming shifts to swap.
            </p>
          ) : (
            <>
              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <Label htmlFor="swap-shift">Your shift</Label>
                  <Select
                    id="swap-shift"
                    value={shiftId}
                    onChange={(e) => setShiftId(e.target.value)}
                  >
                    <option value="">Select a shift</option>
                    {myShifts.map((shift) => (
                      <option key={shift.id} value={shift.id}>
                        {format(new Date(shift.starts_at), 'EEE d MMM, HH:mm')}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="swap-target">Offer to (optional)</Label>
                  <Select
                    id="swap-target"
                    value={targetId}
                    onChange={(e) => setTargetId(e.target.value)}
                  >
                    <option value="">Anyone / manager decides</option>
                    {colleagues.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.first_name} {c.last_name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="swap-note">Note (optional)</Label>
                  <Input
                    id="swap-note"
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    placeholder="Reason for the swap"
                  />
                </div>
              </div>
              <Button
                size="sm"
                className="mt-4"
                onClick={() => void handleRequest()}
                disabled={submitting || !shiftId}
              >
                <Repeat2 size={14} aria-hidden="true" className="mr-1.5" />
                {submitting ? 'Submitting…' : 'Request swap'}
              </Button>
            </>
          )}
        </Card>
      )}

      {loading ? (
        <Card>
          <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
        </Card>
      ) : swaps.length === 0 ? (
        <Card>
          <p className="text-content-muted dark:text-content-muted-dark">
            No shift swaps{teamMode ? ' across the team' : ''} yet.
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
            {swaps.map((swap) => {
              const isTarget =
                !teamMode && swap.target_staff_profile_id === myProfile?.id;
              const isRequester = !teamMode && swap.requested_by === myProfile?.id;

              return (
                <li key={swap.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    {swap.shift && (
                      <p className="text-sm font-medium text-content dark:text-content-dark">
                        {format(new Date(swap.shift.starts_at), 'EEE d MMM, HH:mm')}
                      </p>
                    )}
                    <p className="text-xs text-content-muted dark:text-content-muted-dark">
                      {personName(swap.requested_by)}
                      {swap.target_staff_profile_id
                        ? ` → ${personName(swap.target_staff_profile_id)}`
                        : ' → anyone'}
                    </p>
                    {swap.note && (
                      <p className="text-xs text-content-muted dark:text-content-muted-dark">
                        {swap.note}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-medium',
                      STATUS_STYLE[swap.status],
                    )}
                  >
                    {STATUS_LABEL[swap.status]}
                  </span>

                  {teamMode &&
                    (swap.status === 'accepted' ||
                      (swap.status === 'pending' && !swap.target_staff_profile_id)) && (
                      <div className="flex gap-2">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => void handleReview(swap.id, 'approved')}
                        >
                          <Check size={14} aria-hidden="true" className="mr-1" />
                          Approve
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => void handleReview(swap.id, 'rejected')}
                        >
                          <X size={14} aria-hidden="true" className="mr-1" />
                          Reject
                        </Button>
                      </div>
                    )}
                  {isTarget && swap.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleRespond(swap.id, 'accepted')}
                      >
                        <Check size={14} aria-hidden="true" className="mr-1" />
                        Accept
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleRespond(swap.id, 'rejected')}
                      >
                        <X size={14} aria-hidden="true" className="mr-1" />
                        Decline
                      </Button>
                    </div>
                  )}
                  {isRequester &&
                    (swap.status === 'pending' || swap.status === 'accepted') && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleCancel(swap.id)}
                      >
                        Withdraw
                      </Button>
                    )}
                </li>
              );
            })}
          </ul>
        </Card>
      )}
    </div>
  );
}
