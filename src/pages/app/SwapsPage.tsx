import { useCallback, useEffect, useMemo, useState } from 'react';
import { endOfWeek, format, startOfWeek } from 'date-fns';
import { BarChart3, CalendarDays, Check, Repeat2, X } from 'lucide-react';
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
import { listShiftsForPeriod } from '@/services/shiftService';
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
  type SwapDisplayStatus,
  type SwapRow,
  type SwapTab,
} from '@/lib/swapRows';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { SwapsView } from '@/components/swaps/SwapsView';
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

const STATUS_ORDER: SwapDisplayStatus[] = [
  'pending',
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
 * `/app/swaps` — the shift-swap queue (design/Swap-Request.png): request as
 * staff, respond as the targeted colleague, approve or decline as a manager.
 *
 * Approving here only marks the row `approved` — it does not reassign the
 * shift on the rota. Actually moving the shift is the same write path as any
 * other reassignment in the rota builder, and folding it into an approval
 * click here would bypass that screen's conflict/coverage context. A manager
 * approves the swap here, then reassigns it in the rota builder.
 *
 * The rail's "Swap Rules" card is deliberately absent here even though the
 * reference shows it: no policy table exists yet, and a card of invented
 * thresholds would tell staff a swap is allowed when nothing enforces it.
 * See docs/audit01.md (`Settingspolicy`) and design/.loop/swaps-log.md.
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

  const [activeTab, setActiveTab] = useState<SwapTab>('all');
  const [locationId, setLocationId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [shiftTypeId, setShiftTypeId] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [newestFirst, setNewestFirst] = useState(true);

  const [requestOpen, setRequestOpen] = useState(false);
  const [openSwapId, setOpenSwapId] = useState<string | null>(null);
  const [shiftId, setShiftId] = useState('');
  const [targetId, setTargetId] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // Live updates: refetch when someone else changes this data.
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

        // Managers review the whole org; staff only see swaps they are part of.
        // RLS enforces the same split — this just avoids asking for rows the
        // policy would drop anyway.
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
    () => ({ staffById, locationsById, canApprove, userId: user?.id ?? null }),
    [staffById, locationsById, canApprove, user],
  );

  /** Scope filters apply before the tabs, so every tab count respects them. */
  const scoped = useMemo(
    () =>
      swaps.filter((swap) => {
        if (locationId && swap.shift?.location_id !== locationId) return false;
        if (departmentId && swap.shift?.department_id !== departmentId) return false;
        if (shiftTypeId && swap.shift?.shift_type_id !== shiftTypeId) return false;
        if (statusFilter && toDisplayStatus(swap.status) !== statusFilter) return false;
        return true;
      }),
    [swaps, locationId, departmentId, shiftTypeId, statusFilter],
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
      activeTab === 'all' ? allRows : allRows.filter((row) => row.status === activeTab),
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
      ...STATUS_ORDER.map<SwapTabDef>((status) => ({
        value: status,
        label: SWAP_STATUS_LABEL[status],
        count: counts.find((entry) => entry.status === status)?.count ?? 0,
        tone: TAB_TONE[status],
        // Pending is the only count a manager still has to act on, so it is
        // the only one the reference fills in solid.
        emphasis: status === 'pending' ? 'solid' : 'soft',
      })),
    ],
    [allRows, counts],
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
    const now = new Date();
    const from = startOfWeek(now, { weekStartsOn: 1 });
    const to = endOfWeek(now, { weekStartsOn: 1 });
    return `${format(from, 'd MMM')} – ${format(to, 'd MMM yyyy')}`;
  }, []);

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
      setRequestOpen(false);
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
        setOpenSwapId(null);
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
        setOpenSwapId(null);
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

  const openSwap = openSwapId ? swaps.find((s) => s.id === openSwapId) : undefined;
  const openRow = openSwapId ? allRows.find((r) => r.id === openSwapId) : undefined;

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
        onNewRequest={() => setRequestOpen(true)}
        canRequest={Boolean(myProfile)}
        periodLabel={periodLabel}
        onPeriodClick={() => undefined}
        selects={selects}
        onMoreFilters={() => undefined}
        rows={pageRows}
        onOpenRow={setOpenSwapId}
        onRowMenu={setOpenSwapId}
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
        overviewRangeLabel="All time"
        onOverviewRangeClick={() => undefined}
        activity={activity}
        onViewAllActivity={() => setActiveTab('all')}
        quickActions={QUICK_ACTIONS}
        onViewPolicy={() => undefined}
      />

      <Modal
        open={requestOpen}
        onClose={() => setRequestOpen(false)}
        title="New swap request"
      >
        {myShifts.length === 0 ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            You have no published upcoming shifts to swap.
          </p>
        ) : (
          <div className="space-y-4">
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
            <Button
              size="sm"
              onClick={() => void handleRequest()}
              disabled={submitting || !shiftId}
            >
              <Repeat2 size={14} aria-hidden="true" />
              {submitting ? 'Submitting…' : 'Request swap'}
            </Button>
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(openSwap && openRow)}
        onClose={() => setOpenSwapId(null)}
        title="Swap request"
      >
        {openSwap && openRow && (
          <div className="space-y-3">
            <p className="text-sm font-medium text-content dark:text-content-dark">
              {openRow.from.firstName} {openRow.from.lastName} →{' '}
              {openRow.to ? `${openRow.to.firstName} ${openRow.to.lastName}` : 'anyone'}
            </p>
            {openRow.shift && (
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                {openRow.shift.dateLabel} · {openRow.shift.timeLabel}
                {openRow.shift.locationName ? ` · ${openRow.shift.locationName}` : ''}
              </p>
            )}
            {openSwap.note && (
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                “{openSwap.note}”
              </p>
            )}
            <p className="text-sm text-content-muted dark:text-content-muted-dark">
              {SWAP_STATUS_LABEL[openRow.status]}
              {openRow.statusNote ? ` — ${openRow.statusNote}` : ''}
            </p>

            <div className="flex flex-wrap gap-2 pt-1">
              {canApprove &&
                (openSwap.status === 'accepted' ||
                  (openSwap.status === 'pending' &&
                    !openSwap.target_staff_profile_id)) && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => void handleReview(openSwap.id, 'approved')}
                    >
                      <Check size={14} aria-hidden="true" />
                      Approve
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleReview(openSwap.id, 'rejected')}
                    >
                      <X size={14} aria-hidden="true" />
                      Decline
                    </Button>
                  </>
                )}
              {openSwap.status === 'pending' &&
                openSwap.target_staff_profile_id === myProfile?.id && (
                  <>
                    <Button
                      size="sm"
                      onClick={() => void handleRespond(openSwap.id, 'accepted')}
                    >
                      <Check size={14} aria-hidden="true" />
                      Accept
                    </Button>
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => void handleRespond(openSwap.id, 'rejected')}
                    >
                      <X size={14} aria-hidden="true" />
                      Decline
                    </Button>
                  </>
                )}
              {openSwap.requested_by === myProfile?.id &&
                (openSwap.status === 'pending' || openSwap.status === 'accepted') && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => void handleCancel(openSwap.id)}
                  >
                    Withdraw
                  </Button>
                )}
            </div>
          </div>
        )}
      </Modal>
    </>
  );
}
