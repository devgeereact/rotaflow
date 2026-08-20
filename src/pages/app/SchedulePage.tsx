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
import { listClockEventsForOrg } from '@/services/clockService';
import { listRotas } from '@/services/rotaService';
import {
  loadWeeklyRosterSummary,
  type WeeklyRosterSummary,
} from '@/services/dashboardService';
import { resolvePeriod, todayIso } from '@/lib/schedulePeriod';
import { downloadIcs } from '@/lib/ics';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ManagerSchedule } from '@/components/schedule/ManagerSchedule';
import { StaffSchedule } from '@/components/schedule/StaffSchedule';
import type {
  ClockEvent,
  LeaveRequest,
  Location,
  Shift,
  ShiftType,
  StaffProfile,
} from '@/types';

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
  const { showError } = useToast();
  const isManager = canBuildRota;

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const [locations, setLocations] = useState<Location[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);

  // Manager
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [todayShifts, setTodayShifts] = useState<Shift[]>([]);
  const [weekly, setWeekly] = useState<WeeklyRosterSummary | null>(null);
  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [clockEvents, setClockEvents] = useState<ClockEvent[]>([]);
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
      const [locs, types] = await Promise.all([
        listLocations(orgId),
        listShiftTypes(orgId),
      ]);
      setLocations(locs);
      setShiftTypes(types);
      const timezone = locs[0]?.timezone ?? DEFAULT_TZ;
      const today = todayIso();
      const week = resolvePeriod('week', today, timezone);

      if (isManager) {
        const day = resolvePeriod('day', today, timezone);
        setTodayLabel(day.label);
        const staffRows = await listActiveStaff(orgId);
        setStaff(staffRows);
        const [shifts, weeklySummary, leaveRows, events] = await Promise.all([
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
          listClockEventsForOrg({
            orgId,
            fromIso: day.fromIso,
            toIso: new Date().toISOString(),
          }),
        ]);
        setTodayShifts(shifts);
        setWeekly(weeklySummary);
        setLeave(leaveRows);
        setClockEvents(events);
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
          setMyWeekPublished(
            overlapping.length > 0 && overlapping.every((r) => r.status === 'published'),
          );
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
  }, [orgId, user, isManager, showError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live updates: refetch when someone else changes this data.
  useRealtimeRefresh({
    tables: ['shifts', 'rotas', 'leave_requests', 'clock_events'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => void load(),
  });

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
        clockEvents={clockEvents}
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
    />
  );
}
