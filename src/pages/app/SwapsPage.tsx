import { useCallback, useEffect, useMemo, useState } from 'react';
import { endOfWeek, format, startOfWeek } from 'date-fns';
import { BarChart3, CalendarDays } from 'lucide-react';
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
import { listDepartments, listLocations } from '@/services/locationService';
import { listShiftTypes } from '@/services/shiftTypeService';
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
import { downloadCsv } from '@/lib/csv';
import { toSwapActivity, toSwapRow } from '@/lib/swapMapping';
import {
  SWAP_STATUS_LABEL,
  countByStatus,
  toDisplayStatus,
  toSwapTab,
  type SwapDisplayStatus,
  type SwapRow,
  type SwapTab,
} from '@/lib/swapRows';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { SwapsView } from '@/components/swaps/SwapsView';
import type { OfferShiftDraft } from '@/components/swaps/OfferShiftModal';
import type { CsvColumn } from '@/lib/csv';
import type { SwapFilterSelect } from '@/components/swaps/SwapFilterBar';
import type { SwapTabDef } from '@/components/swaps/SwapTabs';
import type { Department, Location, Shift, ShiftType, StaffProfile } from '@/types';

const TAB_TONE: Record<SwapTab, SwapTabDef['tone']> = {
  all: 'primary',
  pending: 'warning',
  approved: 'success',
  declined: 'danger',
  cancelled: 'neutral',
};

const TAB_ORDER: Exclude<SwapTab, 'all'>[] = [
  'pending',
  'approved',
  'declined',
  'cancelled',
];

const STATUS_ORDER: SwapDisplayStatus[] = [
  'open',
  'awaiting_colleague',
  'accepted',
  'approved',
  'declined',
  'cancelled',
];

const QUICK_ACTIONS = [
  { id: 'calendar', icon: CalendarDays, label: 'Team Calendar', to: '/app/schedule' },
  { id: 'report', icon: BarChart3, label: 'Swap Report', to: '/app/reports' },
];

const EXPORT_COLUMNS: CsvColumn<SwapRow>[] = [
  { label: 'Requested', value: (r) => r.requestedLabel },
  { label: 'From', value: (r) => `${r.from.firstName} ${r.from.lastName}` },
  { label: 'To', value: (r) => (r.to ? `${r.to.firstName} ${r.to.lastName}` : 'Anyone') },
  { label: 'Shift', value: (r) => r.shift?.dateLabel ?? '' },
  { label: 'Time', value: (r) => r.shift?.timeLabel ?? '' },
  { label: 'Location', value: (r) => r.shift?.locationName ?? '' },
  { label: 'Status', value: (r) => SWAP_STATUS_LABEL[r.status] },
];

/**
 * `/app/swaps` (`design/Swap-Request.png`): request as staff, respond as
 * the targeted colleague, then either that colleague's requester or a
 * manager gives the final word.
 *
 * Approving moves the shift (see `handleFinalize`): reassignment used to
 * only happen when a manager approved, leaving the rota to disagree with
 * whatever the requester and colleague had just settled between themselves
 * (`0043_swap_requester_finalize.sql`), so it now runs the same way
 * regardless of who gave the final approval.
 *
 * The rail's "Swap Rules" card is deliberately absent: no policy table
 * exists yet, and a card of invented thresholds would tell staff a swap is
 * allowed when nothing enforces it.
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
  const [departments, setDepartments] = useState<Department[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [myShifts, setMyShifts] = useState<Shift[]>([]);
  const [swaps, setSwaps] = useState<ShiftSwapWithShift[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [activeTab, setActiveTab] = useState<SwapTab>('pending');
  const [locationId, setLocationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [shiftTypeId, setShiftTypeId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [newestFirst, setNewestFirst] = useState(true);

  const [openSwapId, setOpenSwapId] = useState<string | null>(null);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [policyOpen, setPolicyOpen] = useState(false);
  const [fromDate, setFromDate] = useState('');
  const [toDate, setToDate] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [awaitingMe, setAwaitingMe] = useState(false);

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
        const [mine, staffRows, locationRows, departmentRows, typeRows] =
          await Promise.all([
            getMyStaffProfile(orgId, user.id),
            listActiveStaff(orgId),
            listLocations(orgId),
            listDepartments(orgId),
            listShiftTypes(orgId),
          ]);
        if (!active) return;
        setMyProfile(mine);
        setStaff(staffRows);
        setLocations(locationRows);
        setDepartments(departmentRows);
        setShiftTypes(typeRows);

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
    () => ({
      staffById,
      locationsById,
      canApprove,
      userId: user?.id ?? null,
      viewerStaffId: myProfile?.id ?? null,
    }),
    [staffById, locationsById, canApprove, user, myProfile],
  );

  const scoped = useMemo(
    () =>
      swaps.filter((swap) => {
        if (locationId && swap.shift?.location_id !== locationId) return false;
        if (departmentId && swap.shift?.department_id !== departmentId) return false;
        if (shiftTypeId && swap.shift?.shift_type_id !== shiftTypeId) return false;
        if (
          statusFilter &&
          toDisplayStatus(swap.status, Boolean(swap.target_staff_profile_id)) !==
            statusFilter
        ) {
          return false;
        }
        if (mineOnly) {
          const mine =
            swap.requested_by === myProfile?.id ||
            swap.target_staff_profile_id === myProfile?.id;
          if (!mine) return false;
        }
        if (awaitingMe) {
          const status = toDisplayStatus(
            swap.status,
            Boolean(swap.target_staff_profile_id),
          );
          if (toSwapTab(status) !== 'pending') return false;
        }
        if (fromDate || toDate) {
          // Dated by the SHIFT it concerns, not by when it was raised.
          const basis = swap.shift?.starts_at ?? swap.created_at;
          const day = basis.slice(0, 10);
          if (fromDate && day < fromDate) return false;
          if (toDate && day > toDate) return false;
        }
        return true;
      }),
    [
      swaps,
      locationId,
      departmentId,
      shiftTypeId,
      statusFilter,
      mineOnly,
      awaitingMe,
      myProfile,
      fromDate,
      toDate,
    ],
  );

  const allRows = useMemo(
    () =>
      [...scoped]
        .sort((a, b) => {
          const delta =
            new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
          return newestFirst ? delta : -delta;
        })
        .map((swap) => toSwapRow(swap, context)),
    [scoped, context, newestFirst],
  );

  const counts = useMemo(() => countByStatus(allRows), [allRows]);
  const activity = useMemo(() => toSwapActivity(scoped, context), [scoped, context]);

  const tabRows = useMemo(
    () =>
      activeTab === 'all'
        ? allRows
        : allRows.filter((row) => toSwapTab(row.status) === activeTab),
    [allRows, activeTab],
  );

  const pageCount = Math.max(1, Math.ceil(tabRows.length / pageSize));
  const currentPage = Math.min(page, pageCount);
  const pageRows = tabRows.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  const tabs: SwapTabDef[] = useMemo(
    () => [
      {
        value: 'all',
        label: 'All Requests',
        count: allRows.length,
        tone: TAB_TONE.all,
        emphasis: 'soft',
      },
      ...TAB_ORDER.map<SwapTabDef>((tab) => ({
        value: tab,
        label:
          tab === 'pending' ? 'Pending Approval' : tab[0]!.toUpperCase() + tab.slice(1),
        count: allRows.filter((row) => toSwapTab(row.status) === tab).length,
        tone: TAB_TONE[tab],
        emphasis: tab === 'pending' ? 'solid' : 'soft',
      })),
    ],
    [allRows],
  );

  const selects: SwapFilterSelect[] = [
    {
      id: 'locations',
      allLabel: 'All Locations',
      value: locationId,
      onChange: setLocationId,
      options: locations.map((l) => ({ id: l.id, name: l.name })),
    },
    {
      id: 'departments',
      allLabel: 'All Departments',
      value: departmentId,
      onChange: setDepartmentId,
      options: departments.map((d) => ({ id: d.id, name: d.name })),
    },
    {
      id: 'shift-types',
      allLabel: 'All Shift Types',
      value: shiftTypeId,
      onChange: setShiftTypeId,
      options: shiftTypes.map((t) => ({ id: t.id, name: t.name })),
    },
    {
      id: 'statuses',
      allLabel: 'All Statuses',
      value: statusFilter,
      onChange: setStatusFilter,
      options: STATUS_ORDER.map((status) => ({
        id: status,
        name: SWAP_STATUS_LABEL[status],
      })),
    },
  ];

  const periodLabel = useMemo(() => {
    if (!fromDate && !toDate) return 'All dates';
    const pretty = (iso: string): string =>
      format(new Date(`${iso}T00:00:00`), 'd MMM yyyy');
    if (fromDate && toDate) return `${pretty(fromDate)}, ${pretty(toDate)}`;
    return fromDate ? `From ${pretty(fromDate)}` : `Until ${pretty(toDate)}`;
  }, [fromDate, toDate]);

  const applyThisWeek = useCallback((): void => {
    const now = new Date();
    setFromDate(format(startOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
    setToDate(format(endOfWeek(now, { weekStartsOn: 1 }), 'yyyy-MM-dd'));
    setPage(1);
  }, []);

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
        setOpenSwapId(null);
        showSuccess(
          status === 'accepted'
            ? 'Swap accepted. The requester gives the final word next.'
            : 'Swap declined.',
        );
      } catch (err) {
        reportError(err, { area: 'swaps:respond' });
        showError('Could not respond to that swap.');
      }
    },
    [showError, showSuccess],
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
        setOpenSwapId(null);
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
        setOpenSwapId(null);
      } catch (err) {
        reportError(err, { area: 'swaps:cancel' });
        showError('Could not withdraw that request.');
      }
    },
    [showError],
  );

  const handleExport = useCallback((): void => {
    downloadCsv('shift-swaps.csv', allRows, EXPORT_COLUMNS);
  }, [allRows]);

  const openRow = openSwapId ? (allRows.find((r) => r.id === openSwapId) ?? null) : null;

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
        title="Swaps"
        subtitle="Manage shift swap requests between team members."
        tabs={tabs}
        activeTab={activeTab}
        onTabChange={(tab) => {
          setActiveTab(tab);
          setPage(1);
        }}
        onExport={handleExport}
        canRequest={Boolean(myProfile)}
        periodLabel={periodLabel}
        onPeriodClick={() => setPeriodOpen(true)}
        selects={selects}
        onMoreFilters={() => setFiltersOpen(true)}
        rows={pageRows}
        onOpenRow={(row) => setOpenSwapId(row.id)}
        onRowMenu={(row) => setOpenSwapId(row.id)}
        onSortByRequested={() => setNewestFirst((value) => !value)}
        emptyMessage={loading ? 'Loading…' : 'No swap requests match these filters yet.'}
        page={currentPage}
        pageCount={pageCount}
        rangeFrom={tabRows.length === 0 ? 0 : (currentPage - 1) * pageSize + 1}
        rangeTo={Math.min(currentPage * pageSize, tabRows.length)}
        total={tabRows.length}
        pageSize={pageSize}
        onPageChange={setPage}
        onPageSizeChange={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        counts={counts}
        overviewRangeLabel={periodLabel}
        onOverviewRangeClick={() => setPeriodOpen(true)}
        activity={activity}
        onViewAllActivity={() => setActiveTab('all')}
        quickActions={QUICK_ACTIONS}
        onViewPolicy={() => setPolicyOpen(true)}
        myShifts={myShifts}
        colleagues={colleagues}
        onOfferShift={handleOfferShift}
        offline={!online}
        canApprove={canApprove}
        viewerStaffId={myProfile?.id ?? null}
        openRow={openRow}
        onCloseDetail={() => setOpenSwapId(null)}
        onManagerDecision={handleFinalize}
        onColleagueDecision={handleColleagueDecision}
        onRequesterFinalize={handleFinalize}
        onWithdraw={handleWithdraw}
      />

      <Modal
        open={periodOpen}
        onClose={() => setPeriodOpen(false)}
        title="Filter by period"
      >
        <div className="space-y-4">
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Swaps are dated by the shift they concern, not by when the request was raised.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="swap-from">From</Label>
              <Input
                id="swap-from"
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
              <Label htmlFor="swap-to">To</Label>
              <Input
                id="swap-to"
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
            Showing <strong>{tabRows.length}</strong> of {swaps.length} swap requests.
          </p>
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="secondary" onClick={applyThisWeek}>
              This week
            </Button>
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
            <Button onClick={() => setPeriodOpen(false)}>Done</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="More filters"
      >
        <div className="space-y-4">
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-content dark:text-content-dark">
            <input
              type="checkbox"
              checked={mineOnly}
              disabled={!myProfile}
              onChange={(e) => {
                setMineOnly(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-surface-border text-primary focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-40 dark:border-surface-border-dark"
            />
            Only swaps I am part of
          </label>
          {!myProfile && (
            <p className="-mt-2 text-xs text-content-muted dark:text-content-muted-dark">
              You have no staff profile in this organisation, so no swap can name you.
            </p>
          )}
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-content dark:text-content-dark">
            <input
              type="checkbox"
              checked={awaitingMe}
              onChange={(e) => {
                setAwaitingMe(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-surface-border text-primary focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
            />
            Only requests still awaiting a decision
          </label>
          <p className="text-sm text-content dark:text-content-dark">
            Showing <strong>{tabRows.length}</strong> of {swaps.length} swap requests.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setMineOnly(false);
                setAwaitingMe(false);
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
        open={policyOpen}
        onClose={() => setPolicyOpen(false)}
        title="How shift swaps work"
      >
        <div className="space-y-4 text-sm text-content dark:text-content-dark">
          <div>
            <h3 className="mb-1 font-semibold">The sequence</h3>
            <p className="text-content-muted dark:text-content-muted-dark">
              You offer one of your own published shifts, optionally naming a colleague.
              They accept or decline. If you named someone, once they accept you give the
              final word yourself — no manager step needed, since the two people actually
              swapping something have already agreed. An "anyone" offer still needs a
              manager to pick it up, since nobody else has consented on the taker's
              behalf.
            </p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">What to check before approving</h3>
            <p className="text-content-muted dark:text-content-muted-dark">
              That the new person is qualified for the role, that the swap does not break
              their rest period or push them over their contracted hours, and that the
              shift they are giving up is still covered.
            </p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">What the system does not check for you</h3>
            <p className="text-content-muted dark:text-content-muted-dark">
              Those checks are not automated yet, so approving is a human judgement. The
              screen will not stop a swap that breaks a rest period — read the shift
              details before approving.
            </p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">After approval</h3>
            <p className="text-content-muted dark:text-content-muted-dark">
              The shift changes hands on the rota immediately and both people are
              notified. Approving offline queues the change and applies it when the
              connection returns.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );
}
