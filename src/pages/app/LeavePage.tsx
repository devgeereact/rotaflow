import { useCallback, useEffect, useMemo, useState } from 'react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { FailedWritesNotice } from '@/components/FailedWritesNotice';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { getMyStaffProfile, listActiveStaff } from '@/services/staffService';
import { listDepartments } from '@/services/locationService';
import {
  cancelLeaveRequest,
  createLeaveRequest,
  listMyLeaveRequests,
  listOrgLeaveRequests,
  reviewLeaveRequest,
} from '@/services/leaveService';
import { getOrganisation } from '@/services/orgService';
import { logAuditEvent } from '@/services/auditService';
import { reportError } from '@/lib/sentry';
import { DEFAULT_POLICIES, schedulingPolicies } from '@/lib/orgPreferences';
import type { BankHolidayRegion } from '@/lib/bankHolidays';
import { todayIso } from '@/lib/schedulePeriod';
import {
  computeAwaitingDecision,
  computeStaffLeaveTiles,
  countApprovedOverlapping,
  findCoverRisk,
  formatCoverRiskRange,
  sumSicknessDaysInMonth,
  teamEntitlementUsedFraction,
} from '@/lib/leaveInsights';
import {
  formatLeaveDuration,
  formatLeaveRange,
  formatRequestedAt,
  leaveDayCount,
  leaveTypeKey,
} from '@/lib/leaveRows';
import { LEAVE_TYPE_LABEL } from '@/lib/leaveStatus';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ManagerLeave, type ManagerLeaveTiles } from '@/components/leave/ManagerLeave';
import { StaffLeave, type StaffLeaveTiles } from '@/components/leave/StaffLeave';
import type { LeaveDisplayRow } from '@/components/leave/LeaveRowsTable';
import type { LeaveRequestDraft } from '@/components/leave/LeaveRequestModal';
import type { LeaveStatus } from '@/lib/leaveRows';
import type { Department, LeaveRequest, StaffProfile } from '@/types';

/**
 * The muted line under the status pill. Only ever states what the row
 * records: who reviewed it, or that it is still waiting. A decline reason
 * lives in the audit trail (`logAuditEvent('leave.reviewed', ...)`), not on
 * the row, so a declined row says that it was declined and never invents why.
 */
function statusNoteFor(request: LeaveRequest, viewerId: string | null): string | null {
  const mine = Boolean(request.reviewed_by) && request.reviewed_by === viewerId;
  switch (request.status) {
    case 'pending':
      return 'Needs approval';
    case 'approved':
      return mine ? 'Approved by you' : 'Approved';
    case 'rejected':
      return mine ? 'Declined by you' : 'Declined';
    case 'cancelled':
      return 'Cancelled by staff';
    default:
      return null;
  }
}

/**
 * `/app/leave` (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.leave`).
 * Staff see their own request history; managers and owners see the whole
 * organisation, its cover risk, and can approve or decline.
 *
 * Two things the reference draws are deliberately absent rather than
 * faked, because the schema cannot support them yet:
 *
 * - **Per-type allowances.** `staff_profiles.holiday_allowance` is a single
 *   annual figure, so entitlement is Annual Leave only.
 * - **Half days.** `leave_requests` stores whole dates, so "0.5 day" is not
 *   representable.
 */
export function LeavePage(): JSX.Element {
  const { orgId } = useOrg();
  const { canApprove } = usePermissions();
  const { user } = useSupabaseAuth();
  const online = useOnlineStatus();
  const { enqueue, deadLettered, discard, retry } = useSyncQueue();
  const { showError, showSuccess } = useToast();

  const [myProfile, setMyProfile] = useState<StaffProfile | null>(null);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [bankHolidayRegion, setBankHolidayRegion] = useState<BankHolidayRegion>(
    DEFAULT_POLICIES.bankHolidayRegion,
  );
  const [search, setSearch] = useState('');
  // Lands on Pending by default so a reviewer sees what needs a decision
  // first, not buried in a list of settled requests with nothing to do.
  const [statusFilter, setStatusFilter] = useState<LeaveStatus | ''>('pending');

  useRealtimeRefresh({
    tables: ['leave_requests'],
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
        const [mine, staffRows, departmentRows, org] = await Promise.all([
          getMyStaffProfile(orgId, user.id),
          canApprove ? listActiveStaff(orgId) : Promise.resolve<StaffProfile[]>([]),
          listDepartments(orgId),
          getOrganisation(orgId),
        ]);
        if (!active) return;
        setMyProfile(mine);
        setStaff(staffRows);
        setDepartments(departmentRows);
        // Which nation's bank holidays to name in the request form (CAP-009).
        setBankHolidayRegion(schedulingPolicies(org.settings).bankHolidayRegion);

        const rows = canApprove
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
  }, [orgId, user, canApprove, reloadKey, showError]);

  const staffById = useMemo(() => {
    const map = new Map<string, StaffProfile>(staff.map((s) => [s.id, s]));
    if (myProfile) map.set(myProfile.id, myProfile);
    return map;
  }, [staff, myProfile]);

  const departmentById = useMemo(
    () => new Map(departments.map((d) => [d.id, d])),
    [departments],
  );

  const allRows = useMemo<{ row: LeaveDisplayRow; request: LeaveRequest }[]>(() => {
    const now = new Date();
    return requests.map((request) => {
      // A request outlives the staff profile it was raised against (`on
      // delete cascade` only fires on a real delete, not a deactivation), so
      // the name has to degrade rather than crash.
      const person = staffById.get(request.staff_profile_id);
      const department = person?.department_id
        ? (departmentById.get(person.department_id)?.name ?? null)
        : null;
      return {
        request,
        row: {
          id: request.id,
          firstName: person?.first_name ?? 'Former',
          lastName: person?.last_name ?? 'member',
          department,
          photoUrl: person?.photo_url ?? null,
          type: leaveTypeKey(request.type),
          dateLabel: formatLeaveRange(request.start_date, request.end_date),
          durationDays: leaveDayCount(request.start_date, request.end_date),
          status: request.status as LeaveStatus,
          statusNote: statusNoteFor(request, user?.id ?? null),
          requestedLabel: formatRequestedAt(request.created_at, now),
        },
      };
    });
  }, [requests, staffById, departmentById, user]);

  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase();
    return allRows.filter(({ row }) => {
      if (statusFilter && row.status !== statusFilter) return false;
      if (query) {
        const haystack =
          `${row.firstName} ${row.lastName} ${LEAVE_TYPE_LABEL[row.type]}`.toLowerCase();
        if (!haystack.includes(query)) return false;
      }
      return true;
    });
  }, [allRows, statusFilter, search]);

  const managerTiles = useMemo<ManagerLeaveTiles>(() => {
    const now = new Date();
    const today = todayIso();
    const awaiting = computeAwaitingDecision(requests, now);
    const coverRisk = findCoverRisk(requests, today, 60);
    const teamFraction = teamEntitlementUsedFraction(staff, requests, today);
    return {
      awaitingDecision: awaiting.count,
      oldestPendingLabel:
        awaiting.oldestPendingDays != null
          ? `oldest ${awaiting.oldestPendingDays} ${awaiting.oldestPendingDays === 1 ? 'day' : 'days'}`
          : null,
      approvedNext30Days: countApprovedOverlapping(requests, today, 30),
      sicknessDaysThisMonth: sumSicknessDaysInMonth(requests, today),
      coverRiskLabel: coverRisk
        ? formatCoverRiskRange(coverRisk.startDate, coverRisk.endDate)
        : 'Clear',
      coverRiskSubLabel: coverRisk
        ? `${coverRisk.approvedCount} approved, ${coverRisk.pendingCount} pending`
        : null,
      teamEntitlementUsedLabel:
        teamFraction != null ? `${Math.round(teamFraction * 100)}%` : 'No allowances set',
    };
  }, [requests, staff]);

  const staffTiles = useMemo<StaffLeaveTiles>(() => {
    const today = todayIso();
    const computed = myProfile
      ? computeStaffLeaveTiles(myProfile, requests, today)
      : { entitlementDays: null, takenDays: 0, remainingDays: null, pendingDays: 0 };
    return {
      entitlementLabel:
        computed.entitlementDays != null
          ? formatLeaveDuration(computed.entitlementDays)
          : 'Not set',
      takenLabel: formatLeaveDuration(computed.takenDays),
      remainingLabel:
        computed.remainingDays != null
          ? formatLeaveDuration(computed.remainingDays)
          : '-',
      remainingSubLabel: computed.remainingDays != null ? 'book before 31 Dec' : null,
      pendingLabel: formatLeaveDuration(computed.pendingDays),
    };
  }, [myProfile, requests]);

  const handleRequest = useCallback(
    async (draft: LeaveRequestDraft): Promise<void> => {
      if (!orgId || !myProfile) return;
      try {
        const input = {
          org_id: orgId,
          staff_profile_id: myProfile.id,
          type: draft.type,
          start_date: draft.startDate,
          end_date: draft.endDate,
          reason: draft.reason.trim() || null,
        };

        if (!online) {
          await enqueue('leave', input);
          showSuccess(
            'Leave request saved offline. It will sync when you’re back online.',
          );
        } else {
          const created = await createLeaveRequest(input);
          setRequests((prev) => [created, ...prev]);
          showSuccess('Leave request submitted.');
        }
      } catch (err) {
        reportError(err, { area: 'leave:request' });
        showError('Could not submit that request. Please try again.');
      }
    },
    [orgId, myProfile, online, enqueue, showError, showSuccess],
  );

  // Telling the staff member their request was decided is the database's job
  // now (`leave_requests_enqueue_reviewed`, 0087): the notification is written
  // into the outbox in the same transaction as the decision, so the two cannot
  // come apart. It was dispatched from here, after the update had committed
  // and the toast was already up — closing the tab on that toast recorded a
  // decision the person it was about never heard (GAP-026).

  const handleApprove = useCallback(
    async (row: LeaveDisplayRow): Promise<void> => {
      if (!user) return;
      try {
        const updated = await reviewLeaveRequest(row.id, 'approved', user.id);
        if (!updated) {
          // Another manager decided it first (BUG-061). Saying "approved" here
          // would be a lie — the stored decision is theirs, not this one — and
          // the staff member would be told twice, differently.
          setReloadKey((k) => k + 1);
          showError(
            'Another manager has already decided this request. Reloading so you can see their decision.',
          );
          return;
        }
        setRequests((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
        showSuccess('Leave request approved.');
      } catch (err) {
        reportError(err, { area: 'leave:approve' });
        showError('Could not approve that request.');
      }
    },
    [user, showError, showSuccess],
  );

  const handleDecline = useCallback(
    async (row: LeaveDisplayRow, reason: string): Promise<void> => {
      if (!user || !orgId) return;
      try {
        const updated = await reviewLeaveRequest(row.id, 'rejected', user.id);
        if (!updated) {
          setReloadKey((k) => k + 1);
          showError(
            'Another manager has already decided this request. Reloading so you can see their decision.',
          );
          return;
        }
        setRequests((prev) => prev.map((r) => (r.id === row.id ? updated : r)));
        showSuccess('Leave request declined.');
        void logAuditEvent(orgId, 'leave.reviewed', 'leave_requests', row.id, {
          decision: 'declined',
          reason,
        });
      } catch (err) {
        reportError(err, { area: 'leave:decline' });
        showError('Could not decline that request.');
      }
    },
    [user, orgId, showError, showSuccess],
  );

  const handleWithdraw = useCallback(
    async (row: LeaveDisplayRow): Promise<void> => {
      try {
        await cancelLeaveRequest(row.id);
        setRequests((prev) =>
          prev.map((r) => (r.id === row.id ? { ...r, status: 'cancelled' } : r)),
        );
      } catch (err) {
        reportError(err, { area: 'leave:cancel' });
        showError('Could not cancel that request.');
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
          Could not load leave requests.
        </p>
        <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </Card>
    );
  }

  const rows = filtered.map((entry) => entry.row);

  return (
    <>
      {/* P0-1's dead-letter surface: a leave request that can never sync has
          to be visible here, not just in the outbox. */}
      <FailedWritesNotice
        items={deadLettered}
        onDiscard={discard}
        onRetry={retry}
        className="mb-6"
      />

      {canApprove ? (
        <ManagerLeave
          tiles={managerTiles}
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          rows={rows}
          totalRowCount={allRows.length}
          onRequestLeave={handleRequest}
          offline={!online}
          onApprove={handleApprove}
          bankHolidayRegion={bankHolidayRegion}
          onDecline={handleDecline}
        />
      ) : (
        <StaffLeave
          tiles={staffTiles}
          search={search}
          onSearchChange={setSearch}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          rows={rows}
          totalRowCount={allRows.length}
          onRequestLeave={handleRequest}
          offline={!online}
          onWithdraw={handleWithdraw}
          bankHolidayRegion={bankHolidayRegion}
        />
      )}
    </>
  );
}
