import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { getMyStaffProfile, listActiveStaff } from '@/services/staffService';
import {
  cancelOvertimeRequest,
  createOvertimeRequest,
  listMyOvertimeRequests,
  listOrgOvertimeRequests,
  reviewOvertimeRequest,
} from '@/services/overtimeService';
import {
  buildOvertimeRows,
  formatOvertimeHours,
  sumHoursInMonth,
  type OvertimeRow,
} from '@/lib/overtimeRows';
import { todayIso } from '@/lib/schedulePeriod';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { OvertimeView, type OvertimeTiles } from '@/components/overtime/OvertimeView';
import type { RaiseClaimDraft } from '@/components/overtime/RaiseClaimModal';
import type { OvertimeRequest, StaffProfile } from '@/types';

/**
 * `/app/overtime` (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.overtime`).
 * `overtime_requests` is a real, working feature (audit01 P2-7 closed it;
 * see `overtimeService.ts`), not the stub `LeavePage.tsx`'s comment used to
 * describe.
 *
 * A single view for everyone, matching the reference: a manager sees the
 * whole organisation's claims (their own included, as just another row) and
 * decides on pending ones; staff see the same table already scoped to their
 * own claims by RLS, and can withdraw a still-pending one.
 */
export function OvertimePage(): JSX.Element {
  const { orgId } = useOrg();
  const { canApprove } = usePermissions();
  const { user } = useSupabaseAuth();
  const { showError, showSuccess } = useToast();

  const [myProfile, setMyProfile] = useState<StaffProfile | null>(null);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [requests, setRequests] = useState<OvertimeRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useRealtimeRefresh({
    tables: ['overtime_requests'],
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
        const [mine, staffRows] = await Promise.all([
          getMyStaffProfile(orgId, user.id),
          canApprove ? listActiveStaff(orgId) : Promise.resolve<StaffProfile[]>([]),
        ]);
        if (!active) return;
        setMyProfile(mine);
        setStaff(staffRows);

        const rows = canApprove
          ? await listOrgOvertimeRequests(orgId)
          : mine
            ? await listMyOvertimeRequests(mine.id)
            : [];
        if (!active) return;
        setRequests(rows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'overtime:load' });
        setLoadFailed(true);
        showError('Could not load overtime requests.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, user, canApprove, reloadKey, showError]);

  const staffById = useMemo(() => {
    const map = new Map(staff.map((s) => [s.id, s]));
    if (myProfile) map.set(myProfile.id, myProfile);
    return map;
  }, [staff, myProfile]);

  const rows = useMemo<OvertimeRow[]>(
    () => buildOvertimeRows({ requests, staffById, currentUserId: user?.id ?? null }),
    [requests, staffById, user],
  );

  const tiles = useMemo<OvertimeTiles>(() => {
    const today = todayIso();
    const pending = rows.filter((r) => r.status === 'pending');
    const pendingHours = pending.reduce((sum, r) => sum + r.hours, 0);
    if (canApprove) {
      return {
        awaitingDecision: pending.length,
        awaitingDecisionHoursLabel: formatOvertimeHours(pendingHours),
        secondLabel: 'Approved this month',
        secondValue: formatOvertimeHours(sumHoursInMonth(rows, today, ['approved'])),
        requestsShown: rows.length,
      };
    }
    return {
      awaitingDecision: pending.length,
      awaitingDecisionHoursLabel: formatOvertimeHours(pendingHours),
      secondLabel: 'Approved',
      secondValue: formatOvertimeHours(
        rows.filter((r) => r.status === 'approved').reduce((sum, r) => sum + r.hours, 0),
      ),
      requestsShown: rows.length,
    };
  }, [rows, canApprove]);

  const handleRaiseClaim = useCallback(
    async (draft: RaiseClaimDraft): Promise<void> => {
      if (!orgId || !myProfile) return;
      try {
        const created = await createOvertimeRequest({
          org_id: orgId,
          staff_profile_id: myProfile.id,
          date: draft.date,
          hours: draft.hours,
          note: draft.note || null,
          status: 'pending',
        });
        setRequests((prev) => [created, ...prev]);
        showSuccess('Overtime claim submitted.');
      } catch (err) {
        reportError(err, { area: 'overtime:create' });
        showError('Could not submit that claim. Please try again.');
      }
    },
    [orgId, myProfile, showError, showSuccess],
  );

  const handleReview = useCallback(
    async (row: OvertimeRow, status: 'approved' | 'rejected'): Promise<void> => {
      if (!user) return;
      try {
        const updated = await reviewOvertimeRequest(row.id, status, user.id);
        setRequests((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
        showSuccess(
          status === 'approved'
            ? `${row.hoursLabel} approved and sent to payroll.`
            : 'Claim declined.',
        );
      } catch (err) {
        reportError(err, { area: 'overtime:review' });
        showError('Could not record that decision.');
      }
    },
    [user, showError, showSuccess],
  );

  const handleWithdraw = useCallback(
    async (row: OvertimeRow): Promise<void> => {
      try {
        await cancelOvertimeRequest(row.id);
        setRequests((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, status: 'cancelled' } : r)),
        );
      } catch (err) {
        reportError(err, { area: 'overtime:cancel' });
        showError('Could not withdraw that claim.');
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
          Could not load overtime requests.
        </p>
        <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </Card>
    );
  }

  return (
    <OvertimeView
      canApprove={canApprove}
      tiles={tiles}
      rows={rows}
      viewerStaffId={myProfile?.id ?? null}
      emptyMessage={
        canApprove ? 'No overtime claims.' : 'You have not raised any overtime.'
      }
      onRaiseClaim={handleRaiseClaim}
      onApprove={(row) => handleReview(row, 'approved')}
      onDecline={(row) => handleReview(row, 'rejected')}
      onWithdraw={handleWithdraw}
    />
  );
}
