import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { getMyStaffProfile, listActiveStaff } from '@/services/staffService';
import { listLocations } from '@/services/locationService';
import { listShiftsForPeriod } from '@/services/shiftService';
import {
  recordClockEvent,
  updateClockEvent,
  listClockEventsForOrg,
} from '@/services/clockService';
import {
  approveTimesheets,
  listTimesheets,
  type Timesheet,
} from '@/services/timesheetService';
import { logAuditEvent } from '@/services/auditService';
import { pairClockEvents, segmentsStartingWithin, type WorkedSegment } from '@/lib/hours';
import {
  buildTimesheetDayRows,
  weekTotalsForStaff,
  payrollCutOffLabel as computePayrollCutOffLabel,
} from '@/lib/timesheetDayRows';
import { hoursLabel } from '@/components/dashboard/dashboardFormat';
import { fromIsoInTimezone, toIsoInTimezone } from '@/lib/rotaGrid';
import { resolvePeriod, todayIso } from '@/lib/schedulePeriod';
import { downloadCsv } from '@/lib/csv';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ManagerTimesheets } from '@/components/timesheets/ManagerTimesheets';
import { StaffTimesheets } from '@/components/timesheets/StaffTimesheets';
import type { AmendClockEventInput } from '@/components/timesheets/AmendClockEventModal';
import type { TimesheetDisplayRow } from '@/components/timesheets/TimesheetRowsTable';
import type { TimesheetDayStatus } from '@/lib/timesheetDayRows';
import type { ClockEvent, Location, Shift, StaffProfile } from '@/types';

const DEFAULT_TZ = 'Europe/London';

function timezoneFor(shift: Shift, locations: Location[]): string {
  return (
    (shift.location_id && locations.find((l) => l.id === shift.location_id)?.timezone) ||
    DEFAULT_TZ
  );
}

/**
 * `/app/timesheets`. Real data wiring; see ManagerTimesheets/StaffTimesheets
 * for the markup (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.timesheets`).
 *
 * The table is day-grain — today's shifts against what was actually clocked
 * — but approval only exists at week grain (`timesheets.period_start`/
 * `period_end`), the only period the schema stores, so "Approve week" and
 * the per-row Approve both approve that person's whole week, not the single
 * visible day.
 */
export function TimesheetsPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canApprove } = usePermissions();
  const { user } = useSupabaseAuth();
  const { showError, showSuccess } = useToast();
  const isManager = canApprove;

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [locations, setLocations] = useState<Location[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [weekShifts, setWeekShifts] = useState<Shift[]>([]);
  const [weekEvents, setWeekEvents] = useState<ClockEvent[]>([]);
  // The window the events were read for. The read is deliberately wider than
  // this (RF-08), so the period's own bounds have to be kept to filter with.
  const [weekWindow, setWeekWindow] = useState<{ fromIso: string; toIso: string } | null>(
    null,
  );
  const [weekTimesheets, setWeekTimesheets] = useState<Timesheet[]>([]);
  const [weekDates, setWeekDates] = useState<string[]>([]);
  const [myProfile, setMyProfile] = useState<StaffProfile | null>(null);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<TimesheetDayStatus | ''>('');
  const [approveWeekBusy, setApproveWeekBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId || !user) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      const locs = await listLocations(orgId);
      setLocations(locs);
      const timezone = locs[0]?.timezone ?? DEFAULT_TZ;
      const week = resolvePeriod('week', todayIso(), timezone);
      setWeekDates(week.dates);
      setWeekWindow({ fromIso: week.fromIso, toIso: week.toIso });

      if (isManager) {
        const staffRows = await listActiveStaff(orgId);
        setStaff(staffRows);
        const [shifts, events, timesheets] = await Promise.all([
          listShiftsForPeriod({
            orgId,
            fromIso: week.fromIso,
            toIso: week.toIso,
            publishedOnly: false,
          }),
          listClockEventsForOrg({
            orgId,
            fromIso: week.fromIso,
            toIso: week.toIso,
            // RF-08. Read either side of the week so a night shift that
            // starts on Sunday and ends on Monday is one complete segment
            // rather than an orphan `out` and an `in` closed against `now`.
            withBoundaryContext: true,
          }),
          listTimesheets(orgId, week.dates[0] ?? todayIso(), week.dates[6] ?? todayIso()),
        ]);
        setWeekShifts(shifts);
        setWeekEvents(events);
        setWeekTimesheets(timesheets);
      } else {
        const me = await getMyStaffProfile(orgId, user.id);
        setMyProfile(me);
        if (me) {
          setStaff([me]);
          const [shifts, events, timesheets] = await Promise.all([
            listShiftsForPeriod({
              orgId,
              fromIso: week.fromIso,
              toIso: week.toIso,
              staffProfileId: me.id,
            }),
            listClockEventsForOrg({
              orgId,
              fromIso: week.fromIso,
              toIso: week.toIso,
              // RF-08. Read either side of the week so a night shift that
              // starts on Sunday and ends on Monday is one complete segment
              // rather than an orphan `out` and an `in` closed against `now`.
              withBoundaryContext: true,
            }),
            listTimesheets(
              orgId,
              week.dates[0] ?? todayIso(),
              week.dates[6] ?? todayIso(),
            ),
          ]);
          setWeekShifts(shifts);
          // Org-wide events filtered to this person: there is no
          // listClockEventsForStaff-across-a-window-with-org-scope helper,
          // and the org fetch is already scoped to the week window.
          setWeekEvents(events.filter((e) => e.staff_profile_id === me.id));
          setWeekTimesheets(timesheets.filter((t) => t.staff_profile_id === me.id));
        } else {
          setStaff([]);
          setWeekShifts([]);
          setWeekEvents([]);
          setWeekTimesheets([]);
        }
      }
    } catch (err) {
      reportError(err, { area: 'timesheets:load' });
      setLoadFailed(true);
      showError('Could not load timesheets. Check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }, [orgId, user, isManager, showError]);

  useEffect(() => {
    void load();
  }, [load]);

  useRealtimeRefresh({
    tables: ['clock_events', 'shifts'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => void load(),
  });

  const timezone = locations[0]?.timezone ?? DEFAULT_TZ;
  // Stable for the component's lifetime, not ticked: unlike the clock-in
  // screen this page has no live-updating display, just a "now" used to
  // pair segments and read "has this shift started yet". A `load()` reload
  // still gets fresh shifts/events; only this timestamp doesn't move within
  // one visit.
  const now = useMemo(() => new Date(), []);
  const today = todayIso();

  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  const segmentsByStaffId = useMemo(() => {
    const byStaff = new Map<string, ClockEvent[]>();
    for (const event of weekEvents) {
      const list = byStaff.get(event.staff_profile_id) ?? [];
      list.push(event);
      byStaff.set(event.staff_profile_id, list);
    }
    const paired = new Map<string, WorkedSegment[]>();
    for (const [staffId, events] of byStaff) {
      const segments = pairClockEvents(events, now);
      // A segment belongs to the period its clock-in falls in — the same rule
      // `listShiftsForPeriod` and the timesheet report apply. Without this the
      // boundary context read above would add the previous night's shift to
      // this week's total as well as last week's.
      paired.set(
        staffId,
        weekWindow
          ? segmentsStartingWithin(segments, weekWindow.fromIso, weekWindow.toIso)
          : segments,
      );
    }
    return paired;
  }, [weekEvents, weekWindow, now]);

  const todaysStartedShifts = useMemo(
    () =>
      weekShifts.filter((s) => {
        if (s.staff_profile_id === null) return false;
        const local = fromIsoInTimezone(s.starts_at, timezoneFor(s, locations));
        return local.date === today && new Date(s.starts_at) <= now;
      }),
    [weekShifts, locations, today, now],
  );

  const dayRows = useMemo(
    () =>
      buildTimesheetDayRows(
        todaysStartedShifts,
        segmentsByStaffId,
        new Map(locations.map((l) => [l.id, l])),
        timezone,
      ),
    [todaysStartedShifts, segmentsByStaffId, locations, timezone],
  );

  const approvedStaffIds = useMemo(() => {
    const weekStart = weekDates[0] ?? today;
    const weekEnd = weekDates[weekDates.length - 1] ?? weekStart;
    return new Set(
      weekTimesheets
        .filter(
          (t) =>
            t.status === 'approved' &&
            t.period_start === weekStart &&
            t.period_end === weekEnd,
        )
        .map((t) => t.staff_profile_id),
    );
  }, [weekTimesheets, weekDates, today]);

  const displayRows = useMemo<TimesheetDisplayRow[]>(() => {
    const rows = dayRows.map((row) => {
      const person = staffById.get(row.staffId);
      return {
        staffId: row.staffId,
        shiftId: row.shiftId,
        firstName: person?.first_name ?? 'Unknown',
        lastName: person?.last_name ?? '',
        jobTitle: person?.job_title ?? null,
        photoUrl: person?.photo_url ?? null,
        dayLabel: format(new Date(`${today}T00:00:00`), 'EEE d MMM'),
        plannedLabel: row.plannedLabel,
        actualLabel: row.actualLabel,
        paidLabel: row.paidMinutes !== null ? hoursLabel(row.paidMinutes / 60) : '-',
        status: row.status,
        flag: row.flag,
        approved: approvedStaffIds.has(row.staffId),
      };
    });
    return rows.sort((a, b) =>
      `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`),
    );
  }, [dayRows, staffById, today, approvedStaffIds]);

  const filteredRows = useMemo(() => {
    let rows = displayRows;
    if (statusFilter) rows = rows.filter((r) => r.status === statusFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter(
        (r) =>
          `${r.firstName} ${r.lastName}`.toLowerCase().includes(q) ||
          r.dayLabel.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [displayRows, statusFilter, search]);

  const rowsForRole = isManager
    ? filteredRows
    : displayRows.filter((r) => r.staffId === myProfile?.id);

  const totals = useMemo(() => {
    let planned = 0;
    let recorded = 0;
    let late = 0;
    let onShift = 0;
    for (const row of dayRows) {
      planned += row.scheduledMinutes;
      if (row.paidMinutes !== null) recorded += row.paidMinutes;
      if (row.status === 'late') late += 1;
      if (row.status === 'on_shift') onShift += 1;
    }
    const varianceMinutes = recorded - planned;
    return { planned, recorded, late, onShift, varianceMinutes };
  }, [dayRows]);

  const weekShiftsByStaff = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const shift of weekShifts) {
      if (!shift.staff_profile_id) continue;
      const list = map.get(shift.staff_profile_id) ?? [];
      list.push(shift);
      map.set(shift.staff_profile_id, list);
    }
    return map;
  }, [weekShifts]);

  const staffWithShiftsThisWeek = useMemo(
    () => new Set(weekShiftsByStaff.keys()),
    [weekShiftsByStaff],
  );

  const awaitingApproval = useMemo(
    () => [...staffWithShiftsThisWeek].filter((id) => !approvedStaffIds.has(id)).length,
    [staffWithShiftsThisWeek, approvedStaffIds],
  );

  const handleExportCsv = useCallback((): void => {
    if (filteredRows.length === 0) {
      showError('There is nothing to export for these filters.');
      return;
    }
    downloadCsv(`rotaflow-timesheets-${today}`, filteredRows, [
      { label: 'Staff', value: (r) => `${r.firstName} ${r.lastName}` },
      { label: 'Job title', value: (r) => r.jobTitle ?? '' },
      { label: 'Day', value: (r) => r.dayLabel },
      { label: 'Planned', value: (r) => r.plannedLabel },
      { label: 'Actual', value: (r) => r.actualLabel },
      { label: 'Paid', value: (r) => r.paidLabel },
      { label: 'Status', value: (r) => r.status },
    ]);
    if (orgId) void logAuditEvent(orgId, 'timesheet.exported', 'timesheet', undefined);
    showSuccess(`Timesheets exported, ${filteredRows.length} rows.`);
  }, [filteredRows, today, orgId, showSuccess, showError]);

  const approveForStaff = useCallback(
    async (staffIds: string[]): Promise<void> => {
      if (!orgId) return;
      const weekStart = weekDates[0] ?? today;
      const weekEnd = weekDates[weekDates.length - 1] ?? weekStart;
      const approvals = staffIds
        .filter((id) => staffWithShiftsThisWeek.has(id))
        .map((id) => {
          const totals2 = weekTotalsForStaff(
            weekShiftsByStaff.get(id) ?? [],
            segmentsByStaffId.get(id) ?? [],
          );
          return { staffProfileId: id, totalMinutes: Math.round(totals2.workedMinutes) };
        });
      if (approvals.length === 0) return;
      const updated = await approveTimesheets(orgId, weekStart, weekEnd, approvals);
      setWeekTimesheets((prev) => {
        const byId = new Map(prev.map((t) => [t.id, t]));
        for (const t of updated) byId.set(t.id, t);
        return [...byId.values()];
      });
    },
    [
      orgId,
      weekDates,
      today,
      staffWithShiftsThisWeek,
      weekShiftsByStaff,
      segmentsByStaffId,
    ],
  );

  const handleApproveWeek = useCallback((): void => {
    setApproveWeekBusy(true);
    void approveForStaff([...staffWithShiftsThisWeek])
      .then(() =>
        showSuccess(`${staffWithShiftsThisWeek.size} timesheets approved for payroll.`),
      )
      .catch((err) => {
        reportError(err, { area: 'timesheets:approve-week' });
        showError('Could not approve this week. Please try again.');
      })
      .finally(() => setApproveWeekBusy(false));
  }, [approveForStaff, staffWithShiftsThisWeek, showSuccess, showError]);

  const handleApprovePerson = useCallback(
    (row: TimesheetDisplayRow): void => {
      void approveForStaff([row.staffId])
        .then(() =>
          showSuccess(`${row.firstName} ${row.lastName}'s week approved for payroll.`),
        )
        .catch((err) => {
          reportError(err, { area: 'timesheets:approve-person' });
          showError('Could not approve that timesheet. Please try again.');
        });
    },
    [approveForStaff, showSuccess, showError],
  );

  const clockEventsForRow = useCallback(
    (
      row: TimesheetDisplayRow,
    ): { clockIn: ClockEvent | null; clockOut: ClockEvent | null } => {
      const shift = weekShifts.find((s) => s.id === row.shiftId);
      if (!shift) return { clockIn: null, clockOut: null };
      const segments = segmentsByStaffId.get(row.staffId) ?? [];
      const segment = segments.find((s) => {
        const start = new Date(s.clockIn.event_at).getTime();
        const shiftStart = new Date(shift.starts_at).getTime();
        const shiftEnd = new Date(shift.ends_at).getTime();
        return start >= shiftStart - 3 * 3_600_000 && start <= shiftEnd;
      });
      return { clockIn: segment?.clockIn ?? null, clockOut: segment?.clockOut ?? null };
    },
    [weekShifts, segmentsByStaffId],
  );

  const timezoneForRow = useCallback(
    (row: TimesheetDisplayRow): string => {
      const shift = weekShifts.find((s) => s.id === row.shiftId);
      return shift ? timezoneFor(shift, locations) : timezone;
    },
    [weekShifts, locations, timezone],
  );

  const handleAmend = useCallback(
    async (row: TimesheetDisplayRow, input: AmendClockEventInput): Promise<void> => {
      const shift = weekShifts.find((s) => s.id === row.shiftId);
      if (!orgId || !shift) return;
      const tz = timezoneFor(shift, locations);
      const { clockIn, clockOut } = clockEventsForRow(row);

      try {
        if (input.clockInTime) {
          const date = clockIn
            ? fromIsoInTimezone(clockIn.event_at, tz).date
            : fromIsoInTimezone(shift.starts_at, tz).date;
          const eventAt = toIsoInTimezone(date, input.clockInTime, tz);
          if (clockIn) {
            await updateClockEvent(clockIn.id, { event_at: eventAt });
          } else {
            await recordClockEvent({
              org_id: orgId,
              staff_profile_id: row.staffId,
              shift_id: shift.id,
              type: 'in',
              method: 'manual',
              event_at: eventAt,
            });
          }
        }
        if (input.clockOutTime) {
          const date = clockOut
            ? fromIsoInTimezone(clockOut.event_at, tz).date
            : fromIsoInTimezone(shift.ends_at, tz).date;
          const eventAt = toIsoInTimezone(date, input.clockOutTime, tz);
          if (clockOut) {
            await updateClockEvent(clockOut.id, { event_at: eventAt });
          } else {
            await recordClockEvent({
              org_id: orgId,
              staff_profile_id: row.staffId,
              shift_id: shift.id,
              type: 'out',
              method: 'manual',
              event_at: eventAt,
            });
          }
        }
        await logAuditEvent(orgId, 'timesheet.amended', 'clock_event', shift.id, {
          staffProfileId: row.staffId,
          day: row.dayLabel,
          reason: input.reason,
          clockInTime: input.clockInTime,
          clockOutTime: input.clockOutTime,
        });
        showSuccess(
          `${row.firstName} ${row.lastName}'s hours amended and flagged for payroll.`,
        );
        await load();
      } catch (err) {
        reportError(err, { area: 'timesheets:amend' });
        showError('Could not amend that entry. Please try again.');
      }
    },
    [orgId, weekShifts, locations, clockEventsForRow, showSuccess, showError, load],
  );

  if (loading) {
    return <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>;
  }

  if (loadFailed) {
    return (
      <Card className="max-w-sm">
        <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
          Could not load timesheets.
        </p>
        <Button onClick={() => void load()}>Retry</Button>
      </Card>
    );
  }

  if (isManager) {
    return (
      <ManagerTimesheets
        rows={rowsForRole}
        totalRowCount={displayRows.length}
        search={search}
        onSearchChange={setSearch}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        tiles={{
          hoursRecordedLabel: hoursLabel(totals.recorded / 60),
          plannedLabel: hoursLabel(totals.planned / 60),
          varianceLabel: `${totals.varianceMinutes >= 0 ? '+' : ''}${hoursLabel(totals.varianceMinutes / 60)}`,
          varianceIsShort: totals.varianceMinutes < 0,
          lateStarts: totals.late,
          stillClockedIn: totals.onShift,
          awaitingApproval,
          payrollCutOff: computePayrollCutOffLabel(now),
        }}
        onExportCsv={handleExportCsv}
        onApproveWeek={handleApproveWeek}
        approveWeekBusy={approveWeekBusy}
        onAmend={handleAmend}
        onApprovePerson={handleApprovePerson}
        timezoneForRow={timezoneForRow}
        clockEventsForRow={clockEventsForRow}
      />
    );
  }

  const myWeekTotals = myProfile
    ? weekTotalsForStaff(
        weekShiftsByStaff.get(myProfile.id) ?? [],
        segmentsByStaffId.get(myProfile.id) ?? [],
      )
    : { scheduledMinutes: 0, workedMinutes: 0 };
  const contractedMinutes = (myProfile?.weekly_hours ?? 0) * 60;
  const overtimeMinutes = Math.max(0, myWeekTotals.workedMinutes - contractedMinutes);

  return (
    <StaffTimesheets
      rows={rowsForRole}
      hoursThisWeekLabel={hoursLabel(myWeekTotals.workedMinutes / 60)}
      contractedLabel={myProfile?.weekly_hours ? hoursLabel(myProfile.weekly_hours) : '-'}
      overtimeLabel={hoursLabel(overtimeMinutes / 60)}
      payrollCutOff={computePayrollCutOffLabel(now)}
    />
  );
}
