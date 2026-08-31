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
  getOvertimeEvidence,
  listMyOvertimeRequests,
  listOrgOvertimeRequests,
  reviewOvertimeRequest,
} from '@/services/overtimeService';
import {
  buildOvertimeRows,
  formatOvertimeHours,
  sumHoursInMonth,
  type OvertimeRow,
  type OvertimeStatus,
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
 * `overtime_requests` is a real, working feature (the 2026-08-04 audit (now `docs/SAAS.md`) P2-7 closed it;
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
  // Lands on Pending by default so a reviewer sees what needs a decision
  // first, not buried in a list of already-settled claims.
  const [statusFilter, setStatusFilter] = useState<OvertimeStatus | ''>('pending');

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

  /**
   * What the clock recorded, per pending row (CAP-087).
   *
   * Only for an approver, and only for rows they can still act on: this is
   * one query per row, and a decided claim is not being judged any more.
   *
   * Failures are silent and per-row. The evidence is context for a decision,
   * not the decision — an approvals screen that broke because a supporting
   * query failed would be a worse outcome than one without the extra line.
   */
  const [evidence, setEvidence] = useState<Record<string, string | undefined>>({});

  const rows = useMemo<OvertimeRow[]>(
    () => buildOvertimeRows({ requests, staffById, currentUserId: user?.id ?? null }),
    [requests, staffById, user],
  );

  const filteredRows = useMemo(
    () => (statusFilter ? rows.filter((r) => r.status === statusFilter) : rows),
    [rows, statusFilter],
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

  useEffect(() => {
    if (!orgId || !canApprove) return;
    const pendingRows = rows.filter((r) => r.status === 'pending');
    if (pendingRows.length === 0) return;

    let active = true;
    void (async () => {
      const entries = await Promise.all(
        pendingRows.map(async (row) => {
          const found = await getOvertimeEvidence(orgId, row.staffProfileId, row.date);
          if (!found) return [row.id, undefined] as const;
          const worked = formatOvertimeHours(found.workedMinutes / 60);
          const scheduled = formatOvertimeHours(found.scheduledMinutes / 60);
          // The unpaired case is named rather than folded into the number:
          // "we do not know" and "they worked nothing" must not read alike.
          const caveat = found.unpairedEvents > 0 ? ' · a clock-out is missing' : '';
          return [
            row.id,
            `Clock: ${worked} worked / ${scheduled} rostered${caveat}`,
          ] as const;
        }),
      );
      if (!active) return;
      setEvidence(Object.fromEntries(entries));
    })();
    return () => {
      active = false;
    };
  }, [orgId, canApprove, rows]);

  const handleReview = useCallback(
    async (row: OvertimeRow, status: 'approved' | 'rejected'): Promise<void> => {
      if (!user) return;
      try {
        const updated = await reviewOvertimeRequest(row.id, status, user.id);
        if (!updated) {
          setReloadKey((k) => k + 1);
          showError(
            'This claim has already been decided or withdrawn. Reloading so you can see where it stands.',
          );
          return;
        }
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
        const withdrawn = await cancelOvertimeRequest(row.id);
        if (!withdrawn) {
          // A manager decided it first. Painting the row 'cancelled' would
          // contradict what payroll has.
          setReloadKey((k) => k + 1);
          showError(
            'A manager has already decided this claim, so it cannot be withdrawn.',
          );
          return;
        }
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
      evidence={evidence}
      tiles={tiles}
      rows={filteredRows}
      totalRowCount={rows.length}
      statusFilter={statusFilter}
      onStatusFilterChange={setStatusFilter}
      viewerStaffId={myProfile?.id ?? null}
      emptyMessage={
        canApprove
          ? 'No overtime claims match this filter.'
          : 'You have not raised any overtime.'
      }
      onRaiseClaim={handleRaiseClaim}
      onApprove={(row) => handleReview(row, 'approved')}
      onDecline={(row) => handleReview(row, 'rejected')}
      onWithdraw={handleWithdraw}
    />
  );
}
