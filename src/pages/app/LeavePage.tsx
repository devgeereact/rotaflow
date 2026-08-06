import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { BarChart3, CalendarDays, Settings } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { sumApprovedLeaveDays } from '@/lib/leaveEntitlement';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { FailedWritesNotice } from '@/components/FailedWritesNotice';
import { useInngestDispatch } from '@/hooks/useInngestDispatch';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { getMyStaffProfile, listActiveStaff } from '@/services/staffService';
import { listDepartments, listLocations } from '@/services/locationService';
import { listOrgShiftSwaps } from '@/services/swapService';
import {
  cancelLeaveRequest,
  createLeaveRequest,
  listMyLeaveRequests,
  listOrgLeaveRequests,
  reviewLeaveRequest,
} from '@/services/leaveService';
import { reportError } from '@/lib/sentry';
import { downloadCsv } from '@/lib/csv';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { LeaveRequestModal } from '@/components/leave/LeaveRequestModal';
import { LeaveReviewModal } from '@/components/leave/LeaveReviewModal';
import { LeaveView } from '@/components/leave/LeaveView';
import {
  countLeaveDaysByType,
  formatLeaveDays,
  formatLeaveDuration,
  formatLeaveRange,
  formatRequestedAt,
  leaveDayCount,
  leaveTypeKey,
} from '@/lib/leaveRows';
import { LEAVE_TYPE_LABEL } from '@/lib/leaveStatus';
import type { LeaveRequestDraft } from '@/components/leave/LeaveRequestModal';
import type { LeaveFilterSelect } from '@/components/leave/LeaveFilterBar';
import type { LeaveSort } from '@/components/leave/LeaveTable';
import type { LeaveTab } from '@/components/leave/LeaveTabs';
import type {
  LeaveApprovalCount,
  LeaveBalance,
  LeaveRow,
  LeaveStatus,
  LeaveTypeKey,
} from '@/lib/leaveRows';
import type { Department, LeaveRequest, Location, StaffProfile } from '@/types';

const TAB_STATUS: Record<Exclude<LeaveTab, 'all'>, LeaveStatus> = {
  pending: 'pending',
  approved: 'approved',
  declined: 'rejected',
  cancelled: 'cancelled',
};

const TYPE_KEYS: LeaveTypeKey[] = ['annual', 'sick', 'personal', 'carer', 'other'];

/** One decimal at most, `holiday_allowance` is `numeric(6,2)`. */
function days(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * The muted line under the status pill. Only ever states what the row records:
 * who reviewed it, or that it is still waiting. A decline reason is not stored
 * separately (`reason` belongs to the requester), so a declined row says that
 * it was declined and never invents why.
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
 * `/app/leave`. The request table, its filters and the balances rail
 * (design/Leave.png). Staff see their own history; managers and owners see the
 * whole organisation and can approve.
 *
 * Three things the reference draws are deliberately absent rather than faked,
 * because the schema cannot support them yet (see design/.loop/leave-log.md):
 *
 * - **Per-type allowances.** `staff_profiles.holiday_allowance` is a single
 *   annual figure, so Leave Balances renders the one row it can measure. The
 *   reference's Sick / Personal / Carer's rows need a `leave_entitlements`
 *   table that does not exist.
 * - **The overtime queue.** `overtime_requests` has no reader or writer
 *   anywhere in the app (docs/audit01.md P2-7), so counting it would mean
 *   inventing a number.
 * - **Half days.** `leave_requests` stores whole dates, so "0.5 day" is not
 *   representable.
 */
export function LeavePage(): JSX.Element {
  const navigate = useNavigate();
  const { orgId } = useOrg();
  const { canApprove } = usePermissions();
  const { user } = useSupabaseAuth();
  const online = useOnlineStatus();
  const { enqueue, deadLettered, discard } = useSyncQueue();
  const { send } = useInngestDispatch();
  const { showError, showSuccess } = useToast();

  const [myProfile, setMyProfile] = useState<StaffProfile | null>(null);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [requests, setRequests] = useState<LeaveRequest[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [pendingSwaps, setPendingSwaps] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [tab, setTab] = useState<LeaveTab>('all');
  const [locationId, setLocationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [typeFilter, setTypeFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [sort, setSort] = useState<LeaveSort | null>(null);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [requestOpen, setRequestOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [openRowId, setOpenRowId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /**
   * The period window, as ISO dates. Empty means unbounded on that side, so
   * the default (both empty) shows everything and the filter costs nothing
   * until someone sets it.
   *
   * A request is kept when it *overlaps* the window rather than when it starts
   * inside it, a fortnight of leave beginning in March is still March leave
   * when you ask for April, and dropping it would hide someone who is away.
   */
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [balancesOpen, setBalancesOpen] = useState(false);

  // Live updates: refetch when someone else changes this data.
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
        const [mine, staffRows, locationRows, departmentRows] = await Promise.all([
          getMyStaffProfile(orgId, user.id),
          canApprove ? listActiveStaff(orgId) : Promise.resolve<StaffProfile[]>([]),
          listLocations(orgId),
          listDepartments(orgId),
        ]);
        if (!active) return;
        setMyProfile(mine);
        setStaff(staffRows);
        setLocations(locationRows);
        setDepartments(departmentRows);

        const rows = canApprove
          ? await listOrgLeaveRequests(orgId)
          : mine
            ? await listMyLeaveRequests(mine.id)
            : [];
        if (!active) return;
        setRequests(rows);

        // Only a manager has an approval queue to count, and a failure here
        // must not blank the screen the user actually came for.
        if (canApprove) {
          try {
            const swaps = await listOrgShiftSwaps(orgId);
            if (active) {
              setPendingSwaps(swaps.filter((s) => s.status === 'pending').length);
            }
          } catch (err) {
            reportError(err, { area: 'leave:swap-count' });
          }
        }
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

  /** Every request in the reference's row shape, paired with its source row. */
  const allRows = useMemo<{ row: LeaveRow; request: LeaveRequest }[]>(() => {
    const now = new Date();
    return requests.map((request) => {
      const person = staffById.get(request.staff_profile_id);
      return {
        request,
        row: {
          id: request.id,
          // A request outlives the staff profile it was raised against
          // (`on delete cascade` only fires on a real delete, not a
          // deactivation), so the name has to degrade rather than crash.
          firstName: person?.first_name ?? 'Former',
          lastName: person?.last_name ?? 'member',
          jobTitle: person?.job_title ?? null,
          photoUrl: person?.photo_url ?? null,
          type: leaveTypeKey(request.type),
          dateLabel: formatLeaveRange(request.start_date, request.end_date),
          dayLabel: formatLeaveDays(request.start_date, request.end_date),
          durationLabel: formatLeaveDuration(
            leaveDayCount(request.start_date, request.end_date),
          ),
          status: request.status as LeaveStatus,
          statusNote: statusNoteFor(request, user?.id ?? null),
          requestedLabel: formatRequestedAt(request.created_at, now),
          requestedBy: person
            ? `${person.first_name} ${person.last_name}`
            : 'Former team member',
        },
      };
    });
  }, [requests, staffById, user]);

  /** Which staff ids survive the location / department filters. */
  const scopedStaffIds = useMemo<Set<string> | null>(() => {
    if (!locationId && !departmentId) return null;
    const ids = new Set<string>();
    for (const person of staffById.values()) {
      if (departmentId && person.department_id !== departmentId) continue;
      const department = person.department_id
        ? departmentById.get(person.department_id)
        : undefined;
      if (locationId && department?.location_id !== locationId) continue;
      ids.add(person.id);
    }
    return ids;
  }, [locationId, departmentId, staffById, departmentById]);

  const filtered = useMemo(() => {
    const tabStatus = tab === 'all' ? null : TAB_STATUS[tab];
    const kept = allRows.filter(({ row, request }) => {
      if (tabStatus && row.status !== tabStatus) return false;
      if (statusFilter && row.status !== statusFilter) return false;
      if (typeFilter && row.type !== typeFilter) return false;
      if (scopedStaffIds && !scopedStaffIds.has(request.staff_profile_id)) return false;
      // Overlap, not containment. See the `fromDate`/`toDate` note above.
      if (fromDate && request.end_date < fromDate) return false;
      if (toDate && request.start_date > toDate) return false;
      return true;
    });

    if (!sort) return kept;
    const direction = sort.direction === 'asc' ? 1 : -1;
    return [...kept].sort((a, b) => {
      if (sort.key === 'staff') {
        const nameA = `${a.row.lastName} ${a.row.firstName}`;
        const nameB = `${b.row.lastName} ${b.row.firstName}`;
        return direction * nameA.localeCompare(nameB);
      }
      const field = sort.key === 'dates' ? 'start_date' : 'created_at';
      return direction * a.request[field].localeCompare(b.request[field]);
    });
  }, [allRows, tab, statusFilter, typeFilter, scopedStaffIds, sort, fromDate, toDate]);

  const total = filtered.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = filtered
    .slice((safePage - 1) * pageSize, safePage * pageSize)
    .map((entry) => entry.row);

  const pendingCount = allRows.filter((entry) => entry.row.status === 'pending').length;

  const counts = useMemo(
    () => countLeaveDaysByType(requests, LEAVE_TYPE_LABEL),
    [requests],
  );

  /**
   * The one balance the schema can measure: `holiday_allowance` is a single
   * annual figure with no per-type breakdown, so this is Annual Leave, for the
   * signed-in person, in the current calendar year.
   */
  const balances = useMemo<LeaveBalance[]>(() => {
    const allowance = myProfile?.holiday_allowance;
    if (!allowance || allowance <= 0) return [];
    const year = new Date().getFullYear();
    const mine = requests.filter((r) => r.staff_profile_id === myProfile?.id);
    const used = sumApprovedLeaveDays(mine, `${year}-01-01`, `${year + 1}-01-01`);
    const balance = Math.max(0, allowance - used);
    return [
      {
        type: 'annual',
        label: LEAVE_TYPE_LABEL.annual,
        balanceDays: days(balance),
        allowanceDays: days(allowance),
        fraction: balance / allowance,
      },
    ];
  }, [myProfile, requests]);

  const approvalQueues = useMemo<LeaveApprovalCount[]>(() => {
    if (!canApprove) return [];
    return [
      {
        id: 'leave',
        label: 'Leave requests',
        note: 'Needs your approval',
        count: pendingCount,
      },
      {
        id: 'swaps',
        label: 'Swap requests',
        note: 'Needs your approval',
        count: pendingSwaps,
      },
    ];
  }, [canApprove, pendingCount, pendingSwaps]);

  const selects = useMemo<LeaveFilterSelect[]>(
    () => [
      {
        id: 'locations',
        allLabel: 'All Locations',
        ariaLabel: 'Filter by location',
        value: locationId,
        onChange: setLocationId,
        options: locations.map((l) => ({ id: l.id, name: l.name })),
      },
      {
        id: 'departments',
        allLabel: 'All Departments',
        ariaLabel: 'Filter by department',
        value: departmentId,
        onChange: setDepartmentId,
        options: departments.map((d) => ({ id: d.id, name: d.name })),
      },
      {
        id: 'types',
        allLabel: 'All Leave Types',
        ariaLabel: 'Filter by leave type',
        value: typeFilter,
        onChange: setTypeFilter,
        options: TYPE_KEYS.map((key) => ({ id: key, name: LEAVE_TYPE_LABEL[key] })),
      },
      {
        id: 'statuses',
        allLabel: 'All Statuses',
        ariaLabel: 'Filter by status',
        value: statusFilter,
        onChange: setStatusFilter,
        options: [
          { id: 'pending', name: 'Pending' },
          { id: 'approved', name: 'Approved' },
          { id: 'rejected', name: 'Declined' },
          { id: 'cancelled', name: 'Cancelled' },
        ],
      },
    ],
    [locationId, departmentId, typeFilter, statusFilter, locations, departments],
  );

  const handleRequest = useCallback(
    async (draft: LeaveRequestDraft): Promise<void> => {
      if (!orgId || !myProfile) return;
      setSubmitting(true);
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
        setRequestOpen(false);
      } catch (err) {
        reportError(err, { area: 'leave:request' });
        showError('Could not submit that request. Please try again.');
      } finally {
        setSubmitting(false);
      }
    },
    [orgId, myProfile, online, enqueue, showError, showSuccess],
  );

  const handleReview = useCallback(
    async (id: string, status: 'approved' | 'rejected'): Promise<void> => {
      if (!user || !orgId) return;
      const verb = status === 'approved' ? 'approved' : 'declined';
      setBusy(true);
      try {
        const updated = await reviewLeaveRequest(id, status, user.id);
        setRequests((prev) => prev.map((r) => (r.id === id ? updated : r)));
        setOpenRowId(null);
        showSuccess(`Leave request ${verb}.`);

        // Fire-and-forget, after the write already succeeded and the UI
        // already reflects it, a failed dispatch must not undo the review.
        const recipientUserId = staffById.get(updated.staff_profile_id)?.user_id;
        if (recipientUserId) {
          void send('leave/reviewed', {
            orgId,
            userIds: [recipientUserId],
            type: 'leave',
            title: `Your leave request was ${verb}`,
            body: formatLeaveRange(updated.start_date, updated.end_date),
          });
        }
      } catch (err) {
        reportError(err, { area: 'leave:review' });
        showError('Could not update that request.');
      } finally {
        setBusy(false);
      }
    },
    [user, orgId, staffById, send, showError, showSuccess],
  );

  const handleWithdraw = useCallback(
    async (id: string): Promise<void> => {
      setBusy(true);
      try {
        await cancelLeaveRequest(id);
        setRequests((prev) =>
          prev.map((r) => (r.id === id ? { ...r, status: 'cancelled' } : r)),
        );
        setOpenRowId(null);
      } catch (err) {
        reportError(err, { area: 'leave:cancel' });
        showError('Could not cancel that request.');
      } finally {
        setBusy(false);
      }
    },
    [showError],
  );

  /**
   * CSV of what is on screen, not of the whole table.
   *
   * `filtered` is post-tab, post-filter and post-sort but pre-pagination, so
   * the file matches the rows the manager is looking at rather than page one
   * of them. §47 of the build prompt requires exports to honour the current
   * filters; exporting `requests` would quietly ignore every one.
   */
  const handleExport = useCallback((): void => {
    if (filtered.length === 0) {
      showError('There are no leave requests matching these filters to export.');
      return;
    }
    downloadCsv(`rotaflow-leave-${new Date().toISOString().slice(0, 10)}`, filtered, [
      { label: 'Staff member', value: (e) => `${e.row.firstName} ${e.row.lastName}` },
      { label: 'Job title', value: (e) => e.row.jobTitle ?? '' },
      { label: 'Leave type', value: (e) => LEAVE_TYPE_LABEL[e.row.type] },
      { label: 'Start date', value: (e) => e.request.start_date },
      { label: 'End date', value: (e) => e.request.end_date },
      { label: 'Days', value: (e) => e.row.durationLabel },
      { label: 'Status', value: (e) => e.row.status },
      { label: 'Reason', value: (e) => e.request.reason ?? '' },
      { label: 'Requested', value: (e) => e.request.created_at },
    ]);
    showSuccess(`Exported ${filtered.length} leave requests.`);
  }, [filtered, showError, showSuccess]);

  /**
   * Annual-leave balances for everyone the viewer can see.
   *
   * Same arithmetic as `balances` above, applied per staff profile instead of
   * only to the signed-in user. Staff with no `holiday_allowance` recorded are
   * omitted rather than shown as zero. Zero remaining is a very different
   * statement from "nobody has entered an allowance".
   */
  /**
   * What the period control reads. Reflects the actual window rather than
   * always printing today's month, which is what it used to do, a label that
   * never changes while the data behind it does is worse than no label.
   */
  const periodLabel = useMemo(() => {
    if (!fromDate && !toDate) return 'All dates';
    const pretty = (iso: string): string =>
      format(new Date(`${iso}T00:00:00`), 'd MMM yyyy');
    if (fromDate && toDate) return `${pretty(fromDate)}, ${pretty(toDate)}`;
    return fromDate ? `From ${pretty(fromDate)}` : `Until ${pretty(toDate)}`;
  }, [fromDate, toDate]);

  const allBalances = useMemo(() => {
    const year = new Date().getFullYear();
    return [...staffById.values()]
      .filter((person) => (person.holiday_allowance ?? 0) > 0)
      .map((person) => {
        const allowance = Number(person.holiday_allowance);
        const used = sumApprovedLeaveDays(
          requests.filter((r) => r.staff_profile_id === person.id),
          `${year}-01-01`,
          `${year + 1}-01-01`,
        );
        return {
          id: person.id,
          name: `${person.first_name} ${person.last_name}`,
          jobTitle: person.job_title,
          allowance: days(allowance),
          used: days(used),
          remaining: days(Math.max(0, allowance - used)),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [staffById, requests]);

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

  const open = filtered.find((entry) => entry.row.id === openRowId) ?? null;
  const ownRequest = open?.request.staff_profile_id === myProfile?.id;

  return (
    <>
      {/* P0-1's dead-letter surface, kept from main: a leave request that can
          never sync has to be visible here, not just in the outbox. */}
      <FailedWritesNotice items={deadLettered} onDiscard={discard} className="mb-6" />

      <LeaveView
        tabs={[
          { value: 'all', label: 'All Requests' },
          {
            value: 'pending',
            label: canApprove ? 'Pending Approval' : 'Pending',
            count: pendingCount || undefined,
          },
          { value: 'approved', label: 'Approved' },
          { value: 'declined', label: 'Declined' },
          { value: 'cancelled', label: 'Cancelled' },
        ]}
        activeTab={tab}
        onTabChange={(next) => {
          setTab(next);
          setPage(1);
        }}
        onExport={handleExport}
        onRequestLeave={() => setRequestOpen(true)}
        periodLabel={periodLabel}
        onPeriodClick={() => setFiltersOpen(true)}
        selects={selects}
        onFilters={() => setFiltersOpen(true)}
        rows={pageRows}
        sort={sort}
        onSortChange={setSort}
        onOpenRow={setOpenRowId}
        onRowMenu={setOpenRowId}
        emptyMessage={
          loading
            ? 'Loading…'
            : canApprove
              ? 'No leave requests match these filters.'
              : 'You have no leave requests yet.'
        }
        page={safePage}
        pageCount={pageCount}
        rangeFrom={total === 0 ? 0 : (safePage - 1) * pageSize + 1}
        rangeTo={Math.min(safePage * pageSize, total)}
        total={total}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        counts={counts}
        overviewRangeLabel={periodLabel}
        onOverviewRangeClick={() => setFiltersOpen(true)}
        balances={balances}
        onViewAllBalances={() => setBalancesOpen(true)}
        approvalQueues={approvalQueues}
        onViewAllApprovals={() => setTab('pending')}
        onOpenQueue={(id) => {
          if (id === 'leave') setTab('pending');
        }}
        quickActions={[
          {
            id: 'calendar',
            icon: CalendarDays,
            label: 'Team Calendar',
            to: '/app/schedule',
          },
          { id: 'report', icon: BarChart3, label: 'Leave Report', to: '/app/reports' },
          {
            id: 'settings',
            icon: Settings,
            label: 'Leave Settings',
            to: '/app/settings',
          },
        ]}
        onViewTeamCalendar={() => {
          void navigate('/app/schedule');
        }}
      />

      <LeaveRequestModal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        onSubmit={(draft) => void handleRequest(draft)}
        submitting={submitting}
        offline={!online}
      />

      <LeaveReviewModal
        row={open?.row ?? null}
        onClose={() => setOpenRowId(null)}
        onApprove={canApprove ? (id) => void handleReview(id, 'approved') : undefined}
        onDecline={canApprove ? (id) => void handleReview(id, 'rejected') : undefined}
        onWithdraw={ownRequest ? (id) => void handleWithdraw(id) : undefined}
        busy={busy}
        reason={open?.request.reason ?? null}
      />

      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filter by period"
      >
        <div className="space-y-4">
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Shows any request that overlaps this window, so leave running across the
            boundary is still listed. Leave a field blank to leave that side open.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="leave-from">From</Label>
              <Input
                id="leave-from"
                type="date"
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => {
                  setFromDate(e.target.value);
                  setPage(1);
                }}
              />
            </div>
            <div>
              <Label htmlFor="leave-to">To</Label>
              <Input
                id="leave-to"
                type="date"
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => {
                  setToDate(e.target.value);
                  setPage(1);
                }}
              />
            </div>
          </div>
          <p className="text-sm text-content dark:text-content-dark">
            Showing <strong>{total}</strong> {total === 1 ? 'request' : 'requests'} for{' '}
            {periodLabel.toLowerCase()}.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setFromDate('');
                setToDate('');
                setPage(1);
              }}
            >
              Clear
            </Button>
            <Button onClick={() => setFiltersOpen(false)}>Done</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={balancesOpen}
        onClose={() => setBalancesOpen(false)}
        title="Annual leave balances"
      >
        {allBalances.length === 0 ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            No holiday allowance has been recorded for anyone yet. Set{' '}
            <strong>Holiday allowance</strong> on a staff member&rsquo;s profile and their
            balance will appear here.
          </p>
        ) : (
          <div className="max-h-96 overflow-y-auto">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface text-left dark:bg-surface-dark">
                <tr className="border-b border-surface-border dark:border-surface-border-dark">
                  <th className="py-2 pr-3 font-semibold text-content dark:text-content-dark">
                    Staff member
                  </th>
                  <th className="py-2 px-3 text-right font-semibold text-content dark:text-content-dark">
                    Allowance
                  </th>
                  <th className="py-2 px-3 text-right font-semibold text-content dark:text-content-dark">
                    Taken
                  </th>
                  <th className="py-2 pl-3 text-right font-semibold text-content dark:text-content-dark">
                    Remaining
                  </th>
                </tr>
              </thead>
              <tbody>
                {allBalances.map((entry) => (
                  <tr
                    key={entry.id}
                    className="border-b border-divider last:border-0 dark:border-divider-dark"
                  >
                    <td className="py-2 pr-3">
                      <span className="block text-content dark:text-content-dark">
                        {entry.name}
                      </span>
                      {entry.jobTitle && (
                        <span className="block text-xs text-content-muted dark:text-content-muted-dark">
                          {entry.jobTitle}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-content-muted dark:text-content-muted-dark">
                      {entry.allowance}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums text-content-muted dark:text-content-muted-dark">
                      {entry.used}
                    </td>
                    <td className="py-2 pl-3 text-right font-semibold tabular-nums text-content dark:text-content-dark">
                      {entry.remaining}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Modal>
    </>
  );
}
