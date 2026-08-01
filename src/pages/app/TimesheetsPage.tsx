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
import { listLocations } from '@/services/locationService';
import { listShiftsForPeriod } from '@/services/shiftService';
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
import { reportError } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { TimesheetStatCard } from '@/components/timesheets/TimesheetStatCard';
import { TimesheetsView } from '@/components/timesheets/TimesheetsView';
import type { TimesheetTab } from '@/components/timesheets/TimesheetTabs';
import type { QuickAction } from '@/components/timesheets/QuickActionsCard';
import type { ClockEvent, Location, Shift, StaffProfile } from '@/types';

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
 * `/app/timesheets` — hours from `clock_events`, computed client-side via
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
        const [shiftRows, locationRows] = await Promise.all([
          listShiftsForPeriod({
            orgId,
            fromIso: period.fromIso,
            toIso: period.toIso,
          }),
          listLocations(orgId),
        ]);
        if (!active) return;
        setShifts(shiftRows);
        setLocations(locationRows);
      } catch (err) {
        if (!active) return;
        // Non-fatal: the hours are the screen, these only decorate it.
        reportError(err, { area: 'timesheets:load-context' });
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, teamMode, period.fromIso, period.toIso, reloadKey]);

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
          // `timesheets.status` has no automation writing to it, so nothing
          // here is approved or rejected yet — every row is simply worked
          // hours awaiting the (unbuilt) approval workflow.
          status: 'submitted' as const,
        };
      })
      .sort((a, b) => a.lastName.localeCompare(b.lastName));
  }, [segmentsByStaff, staffById, myProfile, teamMode, shifts, period.label]);

  const visibleRows = useMemo(() => {
    let filtered = rows;
    if (staffFilterId) filtered = filtered.filter((row) => row.id === staffFilterId);
    if (statusFilter !== 'all') {
      filtered = filtered.filter((row) => row.status === statusFilter);
    }
    return filtered;
  }, [rows, staffFilterId, statusFilter]);

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

  const handleExport = useCallback((): void => {
    showToast('info', 'Timesheet export lives on the Reports screen.');
  }, [showToast]);

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
          onApproveSelected={() =>
            showToast('info', 'Timesheet approval is not built yet.')
          }
          periodLabel={period.label}
          onPeriodClick={() => setAnchor(todayIso())}
          locations={locations.map((l) => ({ id: l.id, name: l.name }))}
          locationId={locationId}
          onLocationChange={setLocationId}
          departments={[]}
          departmentId={null}
          onDepartmentChange={() => {}}
          staff={rows.map((row) => ({
            id: row.id,
            name: `${row.firstName} ${row.lastName}`,
          }))}
          staffId={staffFilterId}
          onStaffChange={setStaffFilterId}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          onFilters={() => showToast('info', 'More filters are coming soon.')}
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
          onOpenRow={() => showToast('info', 'Timesheet detail is not built yet.')}
          onRowMenu={() => showToast('info', 'Timesheet detail is not built yet.')}
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
          pending={[]}
          pendingMoreCount={0}
          onViewAllPending={() => {}}
          quickActions={QUICK_ACTIONS}
          onViewGuide={() => showToast('info', 'The timesheet guide is coming soon.')}
        />
      </div>
    );
  }

  // ---- Personal hours ------------------------------------------------------
  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-content dark:text-content-dark">
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
                        {format(new Date(segment.clockIn.event_at), 'EEE d MMM, HH:mm')} –{' '}
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
                            knows what actually happened — and this row feeds
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
    </div>
  );
}
