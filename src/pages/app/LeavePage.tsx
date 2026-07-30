import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { Calendar, Check, Plus, X } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { useInngestDispatch } from '@/hooks/useInngestDispatch';
import { useToast } from '@/hooks/useToast';
import { getMyStaffProfile, listActiveStaff } from '@/services/staffService';
import {
  cancelLeaveRequest,
  createLeaveRequest,
  listMyLeaveRequests,
  listOrgLeaveRequests,
  reviewLeaveRequest,
  sumApprovedLeaveDays,
} from '@/services/leaveService';
import { reportError } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import type { LeaveRequest, StaffProfile } from '@/types';

const STATUS_STYLE: Record<LeaveRequest['status'], string> = {
  pending: 'bg-warning/10 text-warning',
  approved: 'bg-success/10 text-success',
  rejected: 'bg-danger/10 text-danger',
  cancelled:
    'bg-surface-border/60 text-content-muted dark:bg-surface-border-dark/60 dark:text-content-muted-dark',
};

/**
 * `/app/leave` — request + entitlement (staff), approval queue (manager).
 *
 * Entitlement is `holiday_allowance` (staff_profiles) minus approved leave
 * days used in the current calendar year — a real number from real data, not
 * a business-rule engine. It does not account for a pro-rated allowance,
 * carry-over, or a non-calendar leave year; those are policy decisions no
 * part of the schema or PRD specifies.
 */
export function LeavePage(): JSX.Element {
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
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [reason, setReason] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!orgId || !user) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const [mine, staffRows] = await Promise.all([
          getMyStaffProfile(orgId, user.id),
          teamMode ? listActiveStaff(orgId) : Promise.resolve<StaffProfile[]>([]),
        ]);
        if (!active) return;
        setMyProfile(mine);
        setStaff(staffRows);

        const rows = teamMode
          ? await listOrgLeaveRequests(orgId)
          : mine
            ? await listMyLeaveRequests(mine.id)
            : [];
        if (!active) return;
        setRequests(rows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'leave:load' });
        setLoadFailed(true);
        showError('Could not load leave requests.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, user, teamMode, reloadKey, showError]);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  const entitlement = useMemo(() => {
    if (!myProfile?.holiday_allowance) return null;
    const yearStart = `${new Date().getFullYear()}-01-01`;
    const yearEnd = `${new Date().getFullYear() + 1}-01-01`;
    const used = sumApprovedLeaveDays(requests, yearStart, yearEnd);
    return {
      allowance: myProfile.holiday_allowance,
      used,
      remaining: myProfile.holiday_allowance - used,
    };
  }, [myProfile, requests]);

  const handleRequest = useCallback(async (): Promise<void> => {
    if (!orgId || !myProfile || !startDate || !endDate) return;
    setSubmitting(true);
    try {
      const input = {
        org_id: orgId,
        staff_profile_id: myProfile.id,
        start_date: startDate,
        end_date: endDate,
        reason: reason.trim() || null,
      };

      if (!online) {
        await enqueue('leave', input);
        showSuccess(
          'Leave request saved offline — it will sync when you’re back online.',
        );
      } else {
        const created = await createLeaveRequest(input);
        setRequests((prev) => [created, ...prev]);
        showSuccess('Leave request submitted.');
      }
      setStartDate('');
      setEndDate('');
      setReason('');
    } catch (err) {
      reportError(err, { area: 'leave:request' });
      showError('Could not submit that request. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }, [
    orgId,
    myProfile,
    startDate,
    endDate,
    reason,
    online,
    enqueue,
    showError,
    showSuccess,
  ]);

  const handleReview = useCallback(
    async (id: string, status: 'approved' | 'rejected'): Promise<void> => {
      if (!user || !orgId) return;
      try {
        const updated = await reviewLeaveRequest(id, status, user.id);
        setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
        showSuccess(`Leave request ${status}.`);

        // Fire-and-forget, after the write already succeeded and the UI
        // already reflects it — a failed dispatch must not undo the review.
        const recipientUserId = staffById.get(updated.staff_profile_id)?.user_id;
        if (recipientUserId) {
          void send('leave/reviewed', {
            orgId,
            userIds: [recipientUserId],
            type: 'leave',
            title: `Your leave request was ${status}`,
            body: `${format(new Date(updated.start_date), 'd MMM')} – ${format(new Date(updated.end_date), 'd MMM yyyy')}`,
          });
        }
      } catch (err) {
        reportError(err, { area: 'leave:review' });
        showError('Could not update that request.');
      }
    },
    [user, orgId, staffById, send, showError, showSuccess],
  );

  const handleCancel = useCallback(
    async (id: string): Promise<void> => {
      try {
        await cancelLeaveRequest(id);
        setRequests((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: 'cancelled' } : r)),
        );
      } catch (err) {
        reportError(err, { area: 'leave:cancel' });
        showError('Could not cancel that request.');
      }
    },
    [showError],
  );

  if (loadFailed && !loading) {
    return (
      <Card>
        <p className="mb-4 text-content-muted dark:text-content-muted-dark">
          Could not load leave requests.
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
        <div>
          <h1 className="font-display text-2xl text-content dark:text-content-dark">
            {teamMode ? 'Leave approvals' : 'Leave'}
          </h1>
        </div>
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
              My leave
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
        <>
          {entitlement && (
            <Card className="mb-4 flex items-center gap-3 p-4">
              <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
                <Calendar size={18} aria-hidden="true" />
              </span>
              <div>
                <p className="text-xs text-content-muted dark:text-content-muted-dark">
                  {new Date().getFullYear()} holiday allowance
                </p>
                <p className="font-display text-lg font-semibold text-content dark:text-content-dark">
                  {entitlement.remaining} of {entitlement.allowance} days remaining
                </p>
              </div>
            </Card>
          )}

          <Card className="mb-6">
            <h2 className="mb-4 font-medium text-content dark:text-content-dark">
              Request leave
            </h2>
            <div className="grid gap-4 sm:grid-cols-3">
              <div>
                <Label htmlFor="leave-start">Start date</Label>
                <Input
                  id="leave-start"
                  type="date"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="leave-end">End date</Label>
                <Input
                  id="leave-end"
                  type="date"
                  value={endDate}
                  min={startDate || undefined}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </div>
              <div>
                <Label htmlFor="leave-reason">Reason (optional)</Label>
                <Input
                  id="leave-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Annual leave"
                />
              </div>
            </div>
            <Button
              size="sm"
              className="mt-4"
              onClick={() => void handleRequest()}
              disabled={submitting || !startDate || !endDate}
            >
              <Plus size={14} aria-hidden="true" className="mr-1.5" />
              {submitting ? 'Submitting…' : 'Submit request'}
            </Button>
          </Card>
        </>
      )}

      {loading ? (
        <Card>
          <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
        </Card>
      ) : requests.length === 0 ? (
        <Card>
          <p className="text-content-muted dark:text-content-muted-dark">
            No leave requests{teamMode ? ' from your team' : ''} yet.
          </p>
        </Card>
      ) : (
        <Card className="p-0">
          <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
            {requests.map((request) => {
              const person = teamMode
                ? staffById.get(request.staff_profile_id)
                : myProfile;
              return (
                <li key={request.id} className="flex flex-wrap items-center gap-3 p-4">
                  <div className="min-w-0 flex-1">
                    {teamMode && person && (
                      <p className="text-sm font-medium text-content dark:text-content-dark">
                        {person.first_name} {person.last_name}
                      </p>
                    )}
                    <p className="text-sm text-content dark:text-content-dark">
                      {format(new Date(request.start_date), 'd MMM')} –{' '}
                      {format(new Date(request.end_date), 'd MMM yyyy')}
                    </p>
                    {request.reason && (
                      <p className="text-xs text-content-muted dark:text-content-muted-dark">
                        {request.reason}
                      </p>
                    )}
                  </div>
                  <span
                    className={cn(
                      'rounded-full px-2.5 py-0.5 text-xs font-medium capitalize',
                      STATUS_STYLE[request.status],
                    )}
                  >
                    {request.status}
                  </span>
                  {teamMode && request.status === 'pending' && (
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void handleReview(request.id, 'approved')}
                      >
                        <Check size={14} aria-hidden="true" className="mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void handleReview(request.id, 'rejected')}
                      >
                        <X size={14} aria-hidden="true" className="mr-1" />
                        Reject
                      </Button>
                    </div>
                  )}
                  {!teamMode && request.status === 'pending' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => void handleCancel(request.id)}
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
