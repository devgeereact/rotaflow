import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Clock3,
  MapPin,
  Timer,
} from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { getMyStaffProfile, listActiveStaff } from '@/services/staffService';
import { listClockEventsForOrg, listClockEventsForStaff } from '@/services/clockService';
import { listDepartments, listLocations } from '@/services/locationService';
import { listShiftsForPeriod } from '@/services/shiftService';
import {
  approveTimesheets,
  listTimesheets,
  type Timesheet,
} from '@/services/timesheetService';
import {
  pairClockEvents,
  totalWorkedMinutes,
  formatHours,
  type WorkedSegment,
} from '@/lib/hours';
import {
  countByStatus,
  decimalHours,
  splitOvertime,
  type TimesheetRow,
} from '@/lib/timesheetRows';
import {
  resolvePeriod,
  stepPeriod,
  todayIso,
  type ScheduleView,
} from '@/lib/schedulePeriod';
import { downloadCsv } from '@/lib/csv';
import { reportError } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { TimesheetStatCard } from '@/components/timesheets/TimesheetStatCard';
import { TimesheetsView } from '@/components/timesheets/TimesheetsView';
import type { TimesheetTab } from '@/components/timesheets/TimesheetTabs';
import type { QuickAction } from '@/components/timesheets/QuickActionsCard';
import type { ClockEvent, Department, Location, Shift, StaffProfile } from '@/types';

const VIEWS: { value: ScheduleView; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'fortnight', label: '2 weeks' },
  { value: 'month', label: 'Month' },
];

const QUICK_ACTIONS: QuickAction[] = [
  {
    id: 'calendar',
    icon: CalendarDays,
    label: 'Team Timesheet Calendar',
    to: '/app/schedule',
  },
  { id: 'report', icon: BarChart3, label: 'Timesheet Report', to: '/app/reports' },
];

/**
 * `/app/timesheets`. Hours from `clock_events`, computed client-side via
 * `pairClockEvents`, laid out to match design/Timesheets-Dashboard.png.
 *
 * Not the `timesheets` table's submit/approve/export workflow: that table has
 * no automation populating it (see lib/hours.ts), and inventing submit/approve
 * state transitions without a specified business rule (weekly? monthly? who
 * submits?) would be guessing at product decisions Phase 5 was never given.
 * This shows real worked hours; the formal timesheet lifecycle is a
 * deliberately separate, later piece.
 *
 * Two tiles from the reference are therefore absent here and present only on
 * the design preview: **Total Cost** (no pay-rate column exists anywhere in the
 * schema) and **Double Time** (no premium-rate rule to compute from). See
 * design/.loop/timesheets-log.md.
 */
export function TimesheetsPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canApprove } = usePermissions();
  const { user } = useSupabaseAuth();
  const { showError, showToast } = useToast();

  const [view, setView] = useState<ScheduleView>('week');
  const [anchor, setAnchor] = useState(todayIso);
  const [teamMode, setTeamMode] = useState(false);
  const [activeTab, setActiveTab] = useState<TimesheetTab>('all');
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [staffFilterId, setStaffFilterId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState('all');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [myProfile, setMyProfile] = useState<StaffProfile | null>(null);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [locations, setLocations] = useState<Location[]>([]);
  const [events, setEvents] = useState<ClockEvent[]>([]);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [departmentId, setDepartmentId] = useState<string | null>(null);
  /** Manager sign-off rows for the visible period, keyed by staff profile. */
  const [signOffs, setSignOffs] = useState<Map<string, Timesheet>>(new Map());
  const [approving, setApproving] = useState(false);
  const [detailStaffId, setDetailStaffId] = useState<string | null>(null);
  const [guideOpen, setGuideOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  /** Minimum worked hours a row must have to be listed. Blank = no minimum. */
  const [minHours, setMinHours] = useState('');
  const [overtimeOnly, setOvertimeOnly] = useState(false);

  // Live updates: refetch when someone else changes this data.
  useRealtimeRefresh({
    tables: ['clock_events'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => setReloadKey((k) => k + 1),
  });

  const period = useMemo(
    () => resolvePeriod(view, anchor, 'Europe/London'),
    [view, anchor],
  );

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
          ? await listClockEventsForOrg({
              orgId,
              fromIso: period.fromIso,
              toIso: period.toIso,
            })
          : mine
            ? await listClockEventsForStaff({
                staffProfileId: mine.id,
                fromIso: period.fromIso,
                toIso: period.toIso,
              })
            : [];
        if (!active) return;
        setEvents(rows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'timesheets:load' });
        setLoadFailed(true);
        showError('Could not load hours for this period.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, user, teamMode, period.fromIso, period.toIso, reloadKey, showError]);

  // Shift counts and the location filter are only rendered in team mode.
  useEffect(() => {
    if (!orgId || !teamMode) return;
    let active = true;
    void (async () => {
      try {
        const [shiftRows, locationRows, departmentRows, signOffRows] = await Promise.all([
          listShiftsForPeriod({
            orgId,
            fromIso: period.fromIso,
            toIso: period.toIso,
          }),
          listLocations(orgId),
          listDepartments(orgId),
          listTimesheets(
            orgId,
            period.dates[0] ?? todayIso(),
            period.dates[period.dates.length - 1] ?? todayIso(),
          ),
        ]);
        if (!active) return;
        setShifts(shiftRows);
        setLocations(locationRows);
        setDepartments(departmentRows);
        setSignOffs(new Map(signOffRows.map((row) => [row.staff_profile_id, row])));
      } catch (err) {
        if (!active) return;
        // Non-fatal: the hours are the screen, these only decorate it.
        reportError(err, { area: 'timesheets:load-context' });
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, teamMode, period.fromIso, period.toIso, period.dates, reloadKey]);

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  const segmentsByStaff = useMemo(() => {
    const grouped = new Map<string, ClockEvent[]>();
    for (const event of events) {
      grouped.set(event.staff_profile_id, [
        ...(grouped.get(event.staff_profile_id) ?? []),
        event,
      ]);
    }
    const result = new Map<string, WorkedSegment[]>();
    for (const [staffId, staffEvents] of grouped) {
      result.set(staffId, pairClockEvents(staffEvents));
    }
    return result;
  }, [events]);

  const totalMinutes = useMemo(
    () =>
      [...segmentsByStaff.values()].reduce(
        (sum, segs) => sum + totalWorkedMinutes(segs),
        0,
      ),
    [segmentsByStaff],
  );

  /** One row per person for the period, from real clock events. */
  const rows = useMemo<TimesheetRow[]>(() => {
    const shiftsByStaff = new Map<string, number>();
    for (const shift of shifts) {
      if (!shift.staff_profile_id) continue;
      shiftsByStaff.set(
        shift.staff_profile_id,
        (shiftsByStaff.get(shift.staff_profile_id) ?? 0) + 1,
      );
    }

    return [...segmentsByStaff.entries()]
      .map(([staffId, segments]) => {
        const person = teamMode ? staffById.get(staffId) : myProfile;
        const worked = totalWorkedMinutes(segments);
        const { regular, overtime } = splitOvertime(worked, person?.weekly_hours ?? null);
        return {
          id: staffId,
          firstName: person?.first_name ?? 'Unknown',
          lastName: person?.last_name ?? '',
          jobTitle: person?.job_title ?? null,
          photoUrl: person?.photo_url ?? null,
          weekLabel: period.label,
          shifts: shiftsByStaff.get(staffId) ?? 0,
          regularHours: decimalHours(regular),
          overtimeHours: decimalHours(overtime),
          // No premium-rate rule exists in the schema to compute this from.
          doubleTimeHours: null,
          totalHours: decimalHours(worked),
          // No pay-rate column exists anywhere to cost these hours with.
          totalCost: null,
          /*
           * Derived hours are always "submitted" until a manager signs the
           * period off. `signOffs` holds the real decision (see
           * timesheetService.ts). The hours themselves are recomputed from
           * clock events on every render and can never be "approved" on
           * their own.
           */
          status:
            signOffs.get(staffId)?.status === 'approved'
              ? ('approved' as const)
              : ('submitted' as const),
        };
      })
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
  }, [segmentsByStaff, staffById, myProfile, teamMode, shifts, period.label, signOffs]);

  /** Worked minutes per staff id. What an approval snapshots. */
  const workedMinutesByStaff = useMemo(() => {
    const map = new Map<string, number>();
    for (const [staffId, segments] of segmentsByStaff.entries()) {
      map.set(staffId, totalWorkedMinutes(segments));
    }
    return map;
  }, [segmentsByStaff]);

  const handleApproveSelected = useCallback(async (): Promise<void> => {
    if (!orgId || selectedIds.length === 0) {
      showError('Select at least one timesheet to approve.');
      return;
    }
    setApproving(true);
    try {
      const updated = await approveTimesheets(
        orgId,
        period.dates[0] ?? todayIso(),
        period.dates[period.dates.length - 1] ?? todayIso(),
        selectedIds.map((staffProfileId) => ({
          staffProfileId,
          totalMinutes: workedMinutesByStaff.get(staffProfileId) ?? 0,
        })),
      );
      setSignOffs((prev) => {
        const next = new Map(prev);
        for (const row of updated) next.set(row.staff_profile_id, row);
        return next;
      });
      setSelectedIds([]);
      showToast(
        'success',
        `${updated.length} ${updated.length === 1 ? 'timesheet' : 'timesheets'} approved.`,
      );
    } catch (err) {
      reportError(err, { area: 'timesheets:approve' });
      showError('Could not approve those timesheets. Please try again.');
    } finally {
      setApproving(false);
    }
  }, [orgId, selectedIds, period.dates, workedMinutesByStaff, showError, showToast]);

  const visibleRows = useMemo(() => {
    let filtered = rows;
    if (staffFilterId) filtered = filtered.filter((row) => row.id === staffFilterId);
    if (statusFilter !== 'all') {
      filtered = filtered.filter((row) => row.status === statusFilter);
    }
    if (departmentId) {
      filtered = filtered.filter(
        (row) => staffById.get(row.id)?.department_id === departmentId,
      );
    }
    const floor = Number(minHours);
    if (minHours.trim() !== '' && Number.isFinite(floor)) {
      filtered = filtered.filter((row) => Number(row.totalHours) >= floor);
    }
    if (overtimeOnly) filtered = filtered.filter((row) => Number(row.overtimeHours) > 0);
    return filtered;
  }, [
    rows,
    staffFilterId,
    statusFilter,
    departmentId,
    staffById,
    minHours,
    overtimeOnly,
  ]);

  /**
   * The approval queue: every row for the period that has not been signed off.
   * Derived from `rows`, not `visibleRows`. The queue is what still needs a
   * decision, and a department filter applied to the table should not make
   * outstanding work appear to have been dealt with.
   */
  const pendingRows = useMemo(
    () => rows.filter((row) => row.status !== 'approved'),
    [rows],
  );
  const pendingPreview = useMemo(
    () =>
      pendingRows.slice(0, 4).map((row) => ({
        id: row.id,
        firstName: row.firstName,
        lastName: row.lastName,
        photoUrl: row.photoUrl,
        submittedLabel: `Worked ${row.weekLabel}`,
        hoursLabel: `${row.totalHours} hours`,
      })),
    [pendingRows],
  );

  const pageCount = Math.max(1, Math.ceil(visibleRows.length / pageSize));
  const pageRows = useMemo(
    () => visibleRows.slice((page - 1) * pageSize, page * pageSize),
    [visibleRows, page, pageSize],
  );

  const counts = useMemo(() => countByStatus(rows), [rows]);

  const totalRegular = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row.regularHours) * 60, 0),
    [rows],
  );
  const totalOvertime = useMemo(
    () => rows.reduce((sum, row) => sum + Number(row.overtimeHours) * 60, 0),
    [rows],
  );

  /**
   * Payroll CSV for the visible period (§16 "Export payroll data", §47
   * "Exports must use current filters").
   *
   * `visibleRows` rather than `rows`, so the file is what the manager filtered
   * to. Approval state is a column: a payroll run needs to know which of these
   * lines a human has actually signed off, and a file that hides that
   * distinction is how unapproved hours get paid.
   */
  const handleExport = useCallback((): void => {
    if (visibleRows.length === 0) {
      showError('There are no hours in this period to export.');
      return;
    }
    downloadCsv(`rotaflow-timesheets-${period.dates[0] ?? todayIso()}`, visibleRows, [
      { label: 'Staff member', value: (r) => `${r.firstName} ${r.lastName}` },
      { label: 'Job title', value: (r) => r.jobTitle ?? '' },
      { label: 'Period', value: (r) => r.weekLabel },
      { label: 'Shifts', value: (r) => r.shifts },
      { label: 'Regular hours', value: (r) => r.regularHours },
      { label: 'Overtime hours', value: (r) => r.overtimeHours },
      { label: 'Total hours', value: (r) => r.totalHours },
      { label: 'Approval status', value: (r) => r.status },
    ]);
    showToast('success', `Exported ${visibleRows.length} timesheet rows.`);
  }, [visibleRows, period.dates, showError, showToast]);

  if (loadFailed && !loading) {
    return (
      <Card>
        <p className="mb-4 text-content-muted dark:text-content-muted-dark">
          Could not load hours for this period.
        </p>
        <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </Card>
    );
  }

  const detailRow = detailStaffId
    ? (rows.find((row) => row.id === detailStaffId) ?? null)
    : null;
  const detailSegments = detailStaffId ? (segmentsByStaff.get(detailStaffId) ?? []) : [];

  /**
   * Rendered by both the team and the personal branch. Declared once rather
   * than duplicated: three dialogs copy-pasted into two returns is three
   * chances for them to drift apart.
   */
  const dialogs = (
    <>
      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="More filters"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="ts-min-hours">Minimum total hours</Label>
            <Input
              id="ts-min-hours"
              type="number"
              min="0"
              step="0.5"
              inputMode="decimal"
              placeholder="No minimum"
              value={minHours}
              onChange={(e) => {
                setMinHours(e.target.value);
                setPage(1);
              }}
            />
            <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
              Hides anyone below this many worked hours in the period. Useful for spotting
              short weeks before they reach payroll.
            </p>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-content dark:text-content-dark">
            <input
              type="checkbox"
              checked={overtimeOnly}
              onChange={(e) => {
                setOvertimeOnly(e.target.checked);
                setPage(1);
              }}
              className="h-4 w-4 rounded border-surface-border text-primary focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
            />
            Only show rows with overtime
          </label>
          <p className="text-sm text-content dark:text-content-dark">
            Showing <strong>{visibleRows.length}</strong> of {rows.length} rows.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              onClick={() => {
                setMinHours('');
                setOvertimeOnly(false);
                setDepartmentId(null);
                setStatusFilter('all');
                setStaffFilterId(null);
                setPage(1);
              }}
            >
              Clear all
            </Button>
            <Button onClick={() => setFiltersOpen(false)}>Done</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={detailRow !== null}
        onClose={() => setDetailStaffId(null)}
        title={
          detailRow
            ? `${detailRow.firstName} ${detailRow.lastName}, ${detailRow.weekLabel}`
            : ''
        }
      >
        {detailRow && (
          <div className="space-y-4">
            <dl className="grid grid-cols-3 gap-3 text-sm">
              <div>
                <dt className="text-content-muted dark:text-content-muted-dark">
                  Regular
                </dt>
                <dd className="font-semibold tabular-nums text-content dark:text-content-dark">
                  {detailRow.regularHours} h
                </dd>
              </div>
              <div>
                <dt className="text-content-muted dark:text-content-muted-dark">
                  Overtime
                </dt>
                <dd className="font-semibold tabular-nums text-content dark:text-content-dark">
                  {detailRow.overtimeHours} h
                </dd>
              </div>
              <div>
                <dt className="text-content-muted dark:text-content-muted-dark">Total</dt>
                <dd className="font-semibold tabular-nums text-content dark:text-content-dark">
                  {detailRow.totalHours} h
                </dd>
              </div>
            </dl>

            <div>
              <h3 className="mb-2 text-sm font-semibold text-content dark:text-content-dark">
                Worked segments
              </h3>
              {detailSegments.length === 0 ? (
                <p className="text-sm text-content-muted dark:text-content-muted-dark">
                  No paired clock events in this period.
                </p>
              ) : (
                <ul className="max-h-64 space-y-2 overflow-y-auto">
                  {detailSegments.map((segment) => (
                    <li
                      key={segment.clockIn.id}
                      className="rounded-lg border border-surface-border p-3 text-sm dark:border-surface-border-dark"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <span className="text-content dark:text-content-dark">
                          {format(new Date(segment.clockIn.event_at), 'EEE d MMM, HH:mm')}
                          {'. '}
                          {segment.clockOut
                            ? format(new Date(segment.clockOut.event_at), 'HH:mm')
                            : 'still clocked in'}
                        </span>
                        <span className="shrink-0 font-semibold tabular-nums text-content dark:text-content-dark">
                          {formatHours(segment.minutes)} h
                        </span>
                      </div>
                      {/* The honest-ambiguity flag from lib/hours.ts, a
                          forgotten clock-out must be visible, never guessed. */}
                      {segment.reviewReason && (
                        <p className="mt-1.5 flex items-center gap-1.5 text-xs text-warning">
                          <AlertTriangle size={13} aria-hidden="true" />
                          {segment.reviewReason === 'missing_clock_out'
                            ? 'No clock-out recorded. Needs review before pay.'
                            : 'Break not closed. Deducted to clock-out.'}
                        </p>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        )}
      </Modal>

      <Modal
        open={guideOpen}
        onClose={() => setGuideOpen(false)}
        title="How these hours are worked out"
      >
        <div className="space-y-4 text-sm text-content dark:text-content-dark">
          <p>
            Every figure here is recomputed from <strong>clock in and out events</strong>{' '}
            each time the screen loads. Nothing is typed in, and nothing is stored as a
            number that could drift from the events behind it.
          </p>
          <div>
            <h3 className="mb-1 font-semibold">Regular and overtime</h3>
            <p className="text-content-muted dark:text-content-muted-dark">
              Worked minutes up to the person&rsquo;s contracted weekly hours are regular;
              anything beyond is overtime. Someone with no contracted hours recorded has
              all their time counted as regular, because there is no threshold to measure
              against.
            </p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Breaks</h3>
            <p className="text-content-muted dark:text-content-muted-dark">
              Break start and end events are deducted from the segment they fall in. A
              break that was started and never ended is deducted up to the clock-out and
              flagged, rather than paid in full.
            </p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Flagged rows</h3>
            <p className="text-content-muted dark:text-content-muted-dark">
              Where the events are ambiguous. Most often a forgotten clock-out, the
              segment is shown with a warning and zero minutes instead of a guess. Open
              the row to see which segment needs attention. A timesheet feeds
              someone&rsquo;s pay, so an estimate is never presented as a fact.
            </p>
          </div>
          <div>
            <h3 className="mb-1 font-semibold">Approval</h3>
            <p className="text-content-muted dark:text-content-muted-dark">
              Approving a period records a sign-off with a snapshot of the agreed hours.
              If a clock event is corrected afterwards the derived figure moves and the
              snapshot does not. That disagreement is deliberate, and worth investigating.
            </p>
          </div>
        </div>
      </Modal>
    </>
  );

  // ---- Manager / whole-team view -------------------------------------------
  if (teamMode && canApprove) {
    return (
      <div>
        <div className="mb-4 flex flex-wrap items-center justify-end gap-1">
          <span className="mr-auto text-sm text-content-muted dark:text-content-muted-dark">
            Hours are computed from clock in/out events, not a submitted timesheet.
          </span>
          <button
            type="button"
            onClick={() => setTeamMode(false)}
            className="rounded-lg px-3 py-1.5 text-sm font-medium text-content-muted hover:text-content dark:text-content-muted-dark"
          >
            My hours
          </button>
          <button
            type="button"
            onClick={() => setTeamMode(true)}
            aria-pressed
            className="rounded-lg bg-surface px-3 py-1.5 text-sm font-medium text-primary dark:bg-surface-dark"
          >
            Team
          </button>
        </div>

        <TimesheetsView
          statCards={
            <>
              <TimesheetStatCard
                icon={Clock}
                tint="bg-primary/10 text-primary"
                label="Total Hours"
                value={formatHours(totalMinutes)}
                hint={`${rows.length} ${rows.length === 1 ? 'person' : 'people'}`}
              />
              <TimesheetStatCard
                icon={Timer}
                tint="bg-info/10 text-info"
                label="Regular Hours"
                value={decimalHours(totalRegular)}
                hint="Within contracted hours"
              />
              <TimesheetStatCard
                icon={Clock}
                tint="bg-warning/15 text-warning"
                label="Overtime Hours"
                value={decimalHours(totalOvertime)}
                hint="Beyond contracted hours"
              />
              <TimesheetStatCard
                icon={CheckCircle2}
                tint="bg-success/10 text-success"
                label="People Clocked In"
                value={String(rows.length)}
                hint={`of ${staff.length} staff`}
              />
            </>
          }
          tabs={[{ value: 'all', label: 'All Timesheets' }]}
          activeTab={activeTab}
          onTabChange={setActiveTab}
          onExport={handleExport}
          onApproveSelected={() => void handleApproveSelected()}
          approving={approving}
          periodLabel={period.label}
          onPeriodClick={() => setAnchor(todayIso())}
          locations={locations.map((l) => ({ id: l.id, name: l.name }))}
          locationId={locationId}
          onLocationChange={setLocationId}
          departments={departments.map((d) => ({ id: d.id, name: d.name }))}
          departmentId={departmentId}
          onDepartmentChange={setDepartmentId}
          staff={rows.map((row) => ({
            id: row.id,
            name: `${row.firstName} ${row.lastName}`,
          }))}
          staffId={staffFilterId}
          onStaffChange={setStaffFilterId}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          onFilters={() => setFiltersOpen(true)}
          rows={pageRows}
          selectedIds={selectedIds}
          onToggleRow={(id) =>
            setSelectedIds((prev) =>
              prev.includes(id) ? prev.filter((rowId) => rowId !== id) : [...prev, id],
            )
          }
          onToggleAll={() =>
            setSelectedIds((prev) =>
              prev.length === pageRows.length ? [] : pageRows.map((row) => row.id),
            )
          }
          onOpenRow={setDetailStaffId}
          onRowMenu={setDetailStaffId}
          showCost={false}
          showDoubleTime={false}
          emptyMessage={loading ? 'Loading…' : 'No clock events in this period.'}
          page={page}
          pageCount={pageCount}
          rangeFrom={visibleRows.length === 0 ? 0 : (page - 1) * pageSize + 1}
          rangeTo={Math.min(page * pageSize, visibleRows.length)}
          total={visibleRows.length}
          pageSize={pageSize}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          counts={counts}
          summaryRangeLabel={period.label}
          onSummaryRangeClick={() => setAnchor(todayIso())}
          pending={pendingPreview}
          pendingMoreCount={Math.max(0, pendingRows.length - pendingPreview.length)}
          onViewAllPending={() => {
            setStatusFilter('submitted');
            setPage(1);
          }}
          quickActions={QUICK_ACTIONS}
          onViewGuide={() => setGuideOpen(true)}
        />
        {dialogs}
      </div>
    );
  }

  // ---- Personal hours ------------------------------------------------------
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
            My hours
          </h1>
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Computed from clock in/out events for this period.
          </p>
        </div>
        {canApprove && (
          <div className="flex gap-1" role="group" aria-label="Scope">
            <button
              type="button"
              onClick={() => setTeamMode(false)}
              aria-pressed={!teamMode}
              className="rounded-lg bg-surface px-3 py-1.5 text-sm font-medium text-primary dark:bg-surface-dark"
            >
              My hours
            </button>
            <button
              type="button"
              onClick={() => setTeamMode(true)}
              aria-pressed={teamMode}
              className="rounded-lg px-3 py-1.5 text-sm font-medium text-content-muted hover:text-content dark:text-content-muted-dark"
            >
              Team
            </button>
          </div>
        )}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={() => setAnchor((a) => stepPeriod(view, a, -1))}
          aria-label="Previous period"
          className="rounded-lg border border-surface-border p-1.5 text-content-muted hover:text-content dark:border-surface-border-dark dark:text-content-muted-dark"
        >
          <ChevronLeft size={16} />
        </button>
        <button
          type="button"
          onClick={() => setAnchor((a) => stepPeriod(view, a, 1))}
          aria-label="Next period"
          className="rounded-lg border border-surface-border p-1.5 text-content-muted hover:text-content dark:border-surface-border-dark dark:text-content-muted-dark"
        >
          <ChevronRight size={16} />
        </button>
        <Button size="sm" variant="ghost" onClick={() => setAnchor(todayIso())}>
          Today
        </Button>
        <p className="font-display text-lg font-semibold text-content dark:text-content-dark">
          {period.label}
        </p>
        <div className="ml-auto flex gap-1">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => setView(v.value)}
              aria-pressed={view === v.value}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium',
                view === v.value
                  ? 'bg-primary text-white'
                  : 'text-content-muted hover:text-content dark:text-content-muted-dark',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <Card className="mb-4 flex items-center gap-3 p-4">
        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
          <Clock3 size={18} aria-hidden="true" />
        </span>
        <div>
          <p className="text-xs text-content-muted dark:text-content-muted-dark">
            Total hours
          </p>
          <p className="font-display text-xl font-semibold text-content dark:text-content-dark">
            {formatHours(totalMinutes)}h
          </p>
        </div>
      </Card>

      {loading ? (
        <Card>
          <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
        </Card>
      ) : segmentsByStaff.size === 0 ? (
        <Card>
          <p className="text-content-muted dark:text-content-muted-dark">
            No clock events in this period.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {[...segmentsByStaff.entries()].map(([staffId, segments]) => {
            const person = teamMode ? staffById.get(staffId) : myProfile;
            return (
              <Card key={staffId} className="p-0">
                <div className="flex items-center justify-between border-b border-surface-border p-4 dark:border-surface-border-dark">
                  <p className="font-medium text-content dark:text-content-dark">
                    {person
                      ? `${person.first_name} ${person.last_name}`
                      : 'Unknown staff'}
                  </p>
                  <p className="font-mono text-sm text-content dark:text-content-dark">
                    {formatHours(totalWorkedMinutes(segments))}h
                  </p>
                </div>
                <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
                  {segments.map((segment) => (
                    <li
                      key={segment.clockIn.id}
                      className="flex flex-wrap items-center justify-between gap-2 p-3 text-sm"
                    >
                      <span className="text-content dark:text-content-dark">
                        {format(new Date(segment.clockIn.event_at), 'EEE d MMM, HH:mm')},{' '}
                        {segment.clockOut
                          ? format(new Date(segment.clockOut.event_at), 'HH:mm')
                          : 'ongoing'}
                        {segment.breakMinutes > 0 && (
                          <span className="text-content-muted dark:text-content-muted-dark">
                            {' '}
                            ({Math.round(segment.breakMinutes)}m break)
                          </span>
                        )}
                        {/* An ambiguous event stream. `pairClockEvents` produces
                            the reading the evidence supports, but only a human
                            knows what actually happened, and this row feeds
                            someone's pay, so it must not look like a fact. */}
                        {segment.reviewReason && (
                          <span
                            className="ml-2 inline-flex items-center gap-1 rounded-full bg-warning/10 px-2 py-0.5 text-xs font-medium text-warning"
                            title={
                              segment.reviewReason === 'missing_clock_out'
                                ? 'No clock-out was recorded for this shift, so no hours can be counted. Correct the clock events to pay it.'
                                : 'A break was started and never ended, so it has been deducted up to the clock-out. Check this is right.'
                            }
                          >
                            <AlertTriangle size={11} aria-hidden="true" />
                            {segment.reviewReason === 'missing_clock_out'
                              ? 'No clock-out'
                              : 'Unclosed break'}
                          </span>
                        )}
                      </span>
                      <span className="flex items-center gap-3 text-content-muted dark:text-content-muted-dark">
                        {segment.clockIn.location_name && (
                          <span className="flex items-center gap-1">
                            <MapPin size={12} aria-hidden="true" />
                            {segment.clockIn.location_name}
                          </span>
                        )}
                        <span className="font-mono">{formatHours(segment.minutes)}h</span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Card>
            );
          })}
        </div>
      )}
      {dialogs}
    </div>
  );
}
