import { useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { listLocations } from '@/services/locationService';
import { listActiveStaff, getMyStaffProfile } from '@/services/staffService';
import { listShiftTypes } from '@/services/shiftTypeService';
import { listShiftsForPeriod } from '@/services/shiftService';
import { listOrgLeaveRequests } from '@/services/leaveService';
import { loadAttendanceDay } from '@/services/attendanceService';
import { getOrganisation } from '@/services/orgService';
import { listRotas } from '@/services/rotaService';
import {
  loadWeeklyRosterSummary,
  type WeeklyRosterSummary,
} from '@/services/dashboardService';
import { resolvePeriod, todayIso } from '@/lib/schedulePeriod';
import { FALLBACK_TIMEZONE, resolveReportingTimezone } from '@/lib/operationalDay';
import { useOperationalDate } from '@/hooks/useOperationalDate';
import type { AttendanceCounts } from '@/lib/attendance';
import { isWeekPublished } from '@/lib/rotaRollup';
import { downloadIcs } from '@/lib/ics';
import {
  calendarFeedUrl,
  getMyCalendarFeedToken,
  issueMyCalendarFeedToken,
} from '@/services/calendarFeedService';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ManagerSchedule } from '@/components/schedule/ManagerSchedule';
import { StaffSchedule } from '@/components/schedule/StaffSchedule';
import type { LeaveRequest, Location, Shift, ShiftType, StaffProfile } from '@/types';

const DEFAULT_TZ = 'Europe/London';

/**
 * `/app/schedule`. Real data wiring; see ManagerSchedule/StaffSchedule for
 * the markup (`docs/ORGANISATION_WORKSPACE.html`'s `SCREENS.schedule`).
 *
 * A manager sees today, operationally, grouped by site, draft shifts
 * included, since that is who is actually working regardless of whether the
 * rota has been published yet. Staff see their own published week only, a
 * draft is the manager's working copy and is not theirs to see.
 */
export function SchedulePage(): JSX.Element {
  const { orgId } = useOrg();
  const { canBuildRota } = usePermissions();
  const { user } = useSupabaseAuth();
  const { showError, showSuccess } = useToast();
  const isManager = canBuildRota;

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reportingTimezone, setReportingTimezone] = useState(FALLBACK_TIMEZONE);
  // Rolls over at local midnight, so a screen left open overnight is not
  // still showing yesterday's roster in the morning.
  const operationalToday = useOperationalDate(reportingTimezone);

  const [locations, setLocations] = useState<Location[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);

  // Manager
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [todayShifts, setTodayShifts] = useState<Shift[]>([]);
  const [weekly, setWeekly] = useState<WeeklyRosterSummary | null>(null);
  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [attendance, setAttendance] = useState<AttendanceCounts | null>(null);
  const [todayLabel, setTodayLabel] = useState('');

  // Staff
  const [myShifts, setMyShifts] = useState<Shift[]>([]);
  const [myWeekPublished, setMyWeekPublished] = useState(false);
  const [weekStartLabel, setWeekStartLabel] = useState('');
  const [weekDates, setWeekDates] = useState<string[]>([]);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId || !user) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      const [locs, types, org] = await Promise.all([
        listLocations(orgId),
        listShiftTypes(orgId),
        getOrganisation(orgId),
      ]);
      setLocations(locs);
      setShiftTypes(types);
      // The organisation's own clock for an all-sites view, not the first
      // site's — `locations[0]?.timezone` silently stood in for every other
      // site, which is wrong the moment an organisation spans two zones.
      const reporting = resolveReportingTimezone(locs, null, org?.timezone ?? null);
      const timezone = reporting.timezone || DEFAULT_TZ;
      setReportingTimezone(timezone);
      const today = operationalToday;
      const week = resolvePeriod('week', today, timezone);

      if (isManager) {
        const day = resolvePeriod('day', today, timezone);
        setTodayLabel(day.label);
        const staffRows = await listActiveStaff(orgId);
        setStaff(staffRows);
        const [shifts, weeklySummary, leaveRows, attendanceDay] = await Promise.all([
          listShiftsForPeriod({
            orgId,
            fromIso: day.fromIso,
            toIso: day.toIso,
            publishedOnly: false,
          }),
          loadWeeklyRosterSummary(
            orgId,
            week.dates,
            week.fromIso,
            week.toIso,
            staffRows,
            timezone,
          ),
          listOrgLeaveRequests(orgId),
          // Published-only and boundary-aware, the same read the dashboard
          // and the attendance workspace make. The previous query bounded the
          // events at `now` with no earlier context, so a night shift's
          // clock-in fell outside the window and its worker read as never
          // having arrived.
          loadAttendanceDay({ orgId, date: today, timezone }),
        ]);
        setTodayShifts(shifts);
        setWeekly(weeklySummary);
        setLeave(leaveRows);
        setAttendance(attendanceDay.counts);
      } else {
        setWeekStartLabel(
          new Date(`${week.dates[0]}T00:00:00`).toLocaleDateString('en-GB', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          }),
        );
        setWeekDates(week.dates);
        const me = await getMyStaffProfile(orgId, user.id);
        if (me) {
          const [shifts, rotas] = await Promise.all([
            listShiftsForPeriod({
              orgId,
              fromIso: week.fromIso,
              toIso: week.toIso,
              staffProfileId: me.id,
            }),
            listRotas(orgId),
          ]);
          setMyShifts(shifts);
          const weekStart = week.dates[0] ?? today;
          const weekEnd = week.dates[week.dates.length - 1] ?? weekStart;
          const overlapping = rotas.filter(
            (r) => r.period_start <= weekEnd && r.period_end >= weekStart,
          );
          setMyWeekPublished(isWeekPublished(overlapping));
        } else {
          setMyShifts([]);
          setMyWeekPublished(false);
        }
      }
    } catch (err) {
      reportError(err, { area: 'schedule:load' });
      setLoadFailed(true);
      showError('Could not load the schedule. Check your connection and retry.');
    } finally {
      setLoading(false);
    }
  }, [orgId, user, isManager, operationalToday, showError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live updates: refetch when someone else changes this data.
  useRealtimeRefresh({
    tables: ['shifts', 'rotas', 'leave_requests', 'clock_events'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => void load(),
  });

  /**
   * Hand over the subscription URL (CAP-063).
   *
   * Issuing is idempotent from the person's point of view — `0099` revokes
   * any live token and creates a new one in the same transaction — so this
   * reads first and only issues when there is nothing. Pressing it twice
   * should not silently break the subscription already on their phone.
   */
  const handleSubscribe = useCallback(async (): Promise<void> => {
    if (!orgId) return;
    try {
      const existing = await getMyCalendarFeedToken(orgId);
      const token = existing ?? (await issueMyCalendarFeedToken(orgId));
      const url = calendarFeedUrl(token);
      await navigator.clipboard.writeText(url);
      showSuccess(
        'Calendar link copied. Add it in your calendar app as a subscription — it updates itself when the rota changes.',
      );
    } catch (err) {
      reportError(err, { area: 'schedule:subscribe' });
      showError('Could not create a calendar link. Please try again.');
    }
  }, [orgId, showSuccess, showError]);

  const handleAddToCalendar = useCallback((): void => {
    if (myShifts.length === 0) {
      showError('There are no published shifts this week to add.');
      return;
    }
    downloadIcs(myShifts, `rotaflow-my-shifts-${weekDates[0] ?? todayIso()}`, {
      calendarName: 'RotaFlow. My shifts',
      shiftTypes,
    });
  }, [myShifts, weekDates, shiftTypes, showError]);

  if (loading) {
    return <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>;
  }

  if (loadFailed) {
    return (
      <Card className="max-w-sm">
        <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
          Something went wrong loading the schedule.
        </p>
        <Button onClick={() => void load()}>Retry</Button>
      </Card>
    );
  }

  if (isManager) {
    return (
      <ManagerSchedule
        todayLabel={todayLabel}
        weekly={weekly}
        shifts={todayShifts}
        staff={staff}
        locations={locations}
        shiftTypes={shiftTypes}
        leave={leave}
        attendance={
          attendance ?? {
            scheduledPeople: 0,
            scheduledShifts: 0,
            workingNow: 0,
            onBreak: 0,
            completed: 0,
            late: 0,
            notRecorded: 0,
            missingClockOut: 0,
            unscheduled: 0,
            openShifts: 0,
          }
        }
        operationalDate={operationalToday}
        timezone={reportingTimezone}
      />
    );
  }

  return (
    <StaffSchedule
      weekStartLabel={weekStartLabel}
      weekDates={weekDates}
      published={myWeekPublished}
      shifts={myShifts}
      locations={locations}
      shiftTypes={shiftTypes}
      fallbackTimezone={locations[0]?.timezone ?? DEFAULT_TZ}
      onAddToCalendar={handleAddToCalendar}
      onSubscribe={() => void handleSubscribe()}
    />
  );
}
