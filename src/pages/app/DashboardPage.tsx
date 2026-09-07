import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useOrg } from '@/hooks/useOrg';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useNavBadgeCounts } from '@/hooks/useNavBadgeCounts';
import { useOperationalDate } from '@/hooks/useOperationalDate';
import { getProfile } from '@/services/profileService';
import { getMyStaffProfile, listStaff } from '@/services/staffService';
import { listMyLeaveRequests } from '@/services/leaveService';
import { listLocations, listDepartments } from '@/services/locationService';
import { listJobTitles } from '@/services/jobTitleService';
import { getOrganisation } from '@/services/orgService';
import { loadAttendanceDay } from '@/services/attendanceService';
import { loadSetupFacts } from '@/services/setupService';
import { buildSetupSteps, summariseSetup } from '@/lib/setupProgress';
import {
  getPendingRequests,
  loadDashboardOverview,
  loadWeeklyRosterSummary,
  loadMyWeekSummary,
  loadMyUpcomingShifts,
  type DashboardOverview,
  type MyWeekSummary,
  type PendingRequest,
  type ShiftGroup,
  type WeeklyRosterSummary,
} from '@/services/dashboardService';
import { listClockEventCorrections, correctClockEvent } from '@/services/clockService';
import { logAuditEvent } from '@/services/auditService';
import { sumApprovedLeaveDays } from '@/lib/leaveEntitlement';
import { resolvePeriod } from '@/lib/schedulePeriod';
import {
  FALLBACK_TIMEZONE,
  nextDay,
  resolveReportingTimezone,
} from '@/lib/operationalDay';
import { buildAttendanceViewRows, type AttendanceViewRow } from '@/lib/attendanceRows';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  OperationsDashboard,
  type OperationsDaySnapshot,
  type StaffingDay,
} from '@/components/dashboard/OperationsDashboard';
import { StaffDashboard } from '@/components/dashboard/StaffDashboard';
import {
  AttendanceDetailModal,
  type AttendanceCorrectionInput,
} from '@/components/attendance/AttendanceDetailModal';
import type { ClockEventCorrection, Location, Organisation } from '@/types';

/** How often to re-read when the live subscription is not carrying changes. */
const FALLBACK_REFRESH_MS = 60_000;

const EMPTY_DAY = (date: string): OperationsDaySnapshot => ({
  date,
  rows: [],
  counts: {
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
  },
  failed: true,
});

/**
 * `/app/dashboard`.
 *
 * ## Two dashboards, chosen by role rather than by mode
 *
 * An owner or manager gets `OperationsDashboard` whichever work mode they are
 * in: the mode adds personal controls, it never takes managerial ones away.
 * Staff get `StaffDashboard`.
 *
 * ## Why every read is guarded by a request token
 *
 * Changing organisation, changing site or crossing midnight all re-issue the
 * queries, and the responses do not necessarily come back in order. Without a
 * token, a slow response for the previous organisation lands after the fast
 * one for the new organisation and paints the previous tenant's staff onto
 * this tenant's screen. The token is compared on arrival and a stale response
 * is dropped; the visible state is cleared **before** the request goes out, so
 * there is never a moment where one organisation's name sits above another's
 * numbers.
 */
export function DashboardPage(): JSX.Element {
  const { orgId, orgName, role } = useOrg();
  const { user } = useSupabaseAuth();
  const { showError, showSuccess } = useToast();
  const isManager = role === 'owner' || role === 'manager';
  const badges = useNavBadgeCounts(orgId);

  const [firstName, setFirstName] = useState<string | null>(null);
  const [organisation, setOrganisation] = useState<Organisation | null>(null);
  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);

  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [weekly, setWeekly] = useState<WeeklyRosterSummary | null>(null);
  const [today, setToday] = useState<OperationsDaySnapshot | null>(null);
  const [tomorrow, setTomorrow] = useState<OperationsDaySnapshot | null>(null);
  const [fetchedAt, setFetchedAt] = useState<string | null>(null);
  const [setup, setSetup] = useState<{
    requiredDone: number;
    requiredTotal: number;
    nextTitle: string;
  } | null>(null);
  const [staffingDay, setStaffingDay] = useState<StaffingDay>('today');
  const [sort, setSort] = useState('expected');
  const [direction, setDirection] = useState<'asc' | 'desc'>('asc');

  const [myWeek, setMyWeek] = useState<MyWeekSummary | null>(null);
  const [myUpcoming, setMyUpcoming] = useState<ShiftGroup[]>([]);
  const [leaveRemaining, setLeaveRemaining] = useState<number | null>(null);
  const [holidayAllowance, setHolidayAllowance] = useState<number | null>(null);

  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  const [selected, setSelected] = useState<AttendanceViewRow | null>(null);
  const [corrections, setCorrections] = useState<ClockEventCorrection[]>([]);
  const [correctionsLoading, setCorrectionsLoading] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const [correctionError, setCorrectionError] = useState<string | null>(null);

  /** Incremented on every scope change; a response with a stale token is dropped. */
  const requestToken = useRef(0);

  const reporting = useMemo(
    () => resolveReportingTimezone(locations, locationId, organisation?.timezone ?? null),
    [locations, locationId, organisation],
  );
  const timezone = reporting.timezone || FALLBACK_TIMEZONE;
  const operationalToday = useOperationalDate(timezone);

  // Clear the previous tenant's content the instant the organisation changes,
  // not when the replacement arrives. Everything below is org-scoped, so
  // leaving it on screen during a round trip shows one customer another
  // customer's people under their own organisation's name.
  useEffect(() => {
    requestToken.current += 1;
    setOrganisation(null);
    setLocations([]);
    setOverview(null);
    setPending([]);
    setWeekly(null);
    setToday(null);
    setTomorrow(null);
    setFetchedAt(null);
    setSetup(null);
    setLocationId(null);
    setSelected(null);
  }, [orgId, user?.id]);

  const load = useCallback(
    async (options: { quiet?: boolean } = {}): Promise<void> => {
      if (!orgId || !user) return;
      const token = (requestToken.current += 1);
      if (options.quiet) setRefreshing(true);
      else setLoading(true);
      setLoadFailed(false);

      try {
        const [profile, org, locs, depts] = await Promise.all([
          getProfile(user.id),
          getOrganisation(orgId),
          listLocations(orgId),
          listDepartments(orgId),
        ]);
        if (token !== requestToken.current) return;
        setFirstName(profile?.full_name?.split(' ')[0] ?? null);
        setOrganisation(org);
        setLocations(locs);

        const tz =
          resolveReportingTimezone(locs, locationId, org?.timezone ?? null).timezone ||
          FALLBACK_TIMEZONE;
        const overviewData = await loadDashboardOverview(orgId, tz, operationalToday);
        if (token !== requestToken.current) return;
        setOverview(overviewData);

        if (isManager) {
          const week = resolvePeriod('week', operationalToday, tz);
          const [people, titles, todayDay, tomorrowDay, pendingRows, weeklySummary] =
            await Promise.all([
              listStaff(orgId),
              listJobTitles(orgId),
              // Each day is caught separately: one failing must not blank the
              // other, and a failed day shows "—" rather than a zero.
              loadAttendanceDay({
                orgId,
                date: operationalToday,
                timezone: tz,
                locationId,
              }).catch((error: unknown) => {
                reportError(error, { area: 'dashboard:today' });
                return null;
              }),
              loadAttendanceDay({
                orgId,
                date: nextDay(operationalToday),
                timezone: tz,
                locationId,
              }).catch((error: unknown) => {
                reportError(error, { area: 'dashboard:tomorrow' });
                return null;
              }),
              getPendingRequests(
                orgId,
                new Map(overviewData.staff.map((s) => [s.id, s])),
                {
                  fromIso: resolvePeriod('day', operationalToday, tz).fromIso,
                  toIso: resolvePeriod('day', operationalToday, tz).toIso,
                },
              ),
              loadWeeklyRosterSummary(
                orgId,
                week.dates,
                week.fromIso,
                week.toIso,
                overviewData.staff,
                tz,
              ),
            ]);
          if (token !== requestToken.current) return;

          setPending(pendingRows);
          setWeekly(weeklySummary);

          const lookups = {
            staffById: new Map(people.map((s) => [s.id, s])),
            locationById: new Map(locs.map((l) => [l.id, l])),
            departmentById: new Map(depts.map((d) => [d.id, d])),
            jobTitleById: new Map(titles.map((t) => [t.id, t])),
            fallbackTimezone: tz,
          };

          setToday(
            todayDay
              ? {
                  date: operationalToday,
                  rows: buildAttendanceViewRows(todayDay.rows, lookups),
                  counts: todayDay.counts,
                  failed: false,
                }
              : EMPTY_DAY(operationalToday),
          );
          setTomorrow(
            tomorrowDay
              ? {
                  date: nextDay(operationalToday),
                  rows: buildAttendanceViewRows(tomorrowDay.rows, lookups),
                  counts: tomorrowDay.counts,
                  failed: false,
                }
              : EMPTY_DAY(nextDay(operationalToday)),
          );
          setFetchedAt(todayDay?.fetchedAt ?? new Date().toISOString());

          // Caught rather than awaited into the main chain: a checklist that
          // could not be read must not take the operations board down with
          // it, and `null` renders no banner rather than a wrong one.
          void loadSetupFacts(orgId)
            .then((facts) => {
              if (token !== requestToken.current) return;
              const summary = summariseSetup(buildSetupSteps(facts));
              setSetup({
                requiredDone: summary.requiredDone,
                requiredTotal: summary.requiredTotal,
                nextTitle: summary.next?.title ?? '',
              });
            })
            .catch((error: unknown) => {
              reportError(error, { area: 'dashboard:setup' });
            });
        } else {
          const me = await getMyStaffProfile(orgId, user.id);
          if (token !== requestToken.current) return;
          if (me) {
            const week = resolvePeriod('week', operationalToday, tz);
            const [mine, upcoming, myLeave] = await Promise.all([
              loadMyWeekSummary(orgId, me.id, week.fromIso, week.toIso),
              loadMyUpcomingShifts(
                orgId,
                me.id,
                resolvePeriod('day', operationalToday, tz).fromIso,
                week.toIso,
                overviewData.shiftTypes,
                overviewData.locations,
              ),
              listMyLeaveRequests(me.id),
            ]);
            if (token !== requestToken.current) return;
            setMyWeek(mine);
            setMyUpcoming(upcoming);
            const year = new Date().getFullYear();
            const used = sumApprovedLeaveDays(myLeave, `${year}-01-01`, `${year}-12-31`);
            const allowance = me.holiday_allowance ?? 0;
            setLeaveRemaining(Math.max(0, allowance - used));
            setHolidayAllowance(allowance);
          }
          setFetchedAt(new Date().toISOString());
        }
      } catch (error) {
        if (token !== requestToken.current) return;
        reportError(error, { area: 'dashboard:load' });
        setLoadFailed(true);
        showError('Could not load the dashboard. Please try again.');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [orgId, user, isManager, locationId, operationalToday, showError],
  );

  useEffect(() => {
    void load();
  }, [load]);

  // Live updates. `onStatus` drives the "reconnecting" line: a board whose
  // subscription has dropped is showing figures that stopped moving, and
  // saying so is the difference between stale and wrong.
  const { connected } = useRealtimeRefresh({
    tables: [
      'clock_events',
      'shifts',
      'rotas',
      'leave_requests',
      'shift_swaps',
      'announcements',
    ],
    scope: { column: 'org_id', value: orgId },
    onChange: () => void load({ quiet: true }),
  });

  // Bounded fallback. Realtime can be connected and still miss an event
  // (a dropped socket that reconnects silently, a change made by a scheduled
  // job rather than a session), so the board re-reads once a minute
  // regardless. Quiet, so it never flashes a loading state over a working
  // screen.
  useEffect(() => {
    if (!isManager) return;
    const timer = setInterval(() => void load({ quiet: true }), FALLBACK_REFRESH_MS);
    return () => clearInterval(timer);
  }, [isManager, load]);

  const openRow = useCallback((row: AttendanceViewRow): void => {
    setSelected(row);
    setCorrectionError(null);
    const first = row.row.events[0];
    if (!first) {
      setCorrections([]);
      return;
    }
    setCorrectionsLoading(true);
    void listClockEventCorrections(first.id)
      .then(setCorrections)
      .catch((error: unknown) => {
        reportError(error, { area: 'dashboard:corrections' });
        setCorrections([]);
      })
      .finally(() => setCorrectionsLoading(false));
  }, []);

  const handleCorrect = useCallback(
    async (input: AttendanceCorrectionInput): Promise<void> => {
      if (!orgId) return;
      setCorrecting(true);
      setCorrectionError(null);
      try {
        await correctClockEvent(input.clockEventId, {
          reason: input.reason,
          eventAt: input.eventAt,
          expectedUpdatedAt: input.expectedUpdatedAt,
        });
        await logAuditEvent(
          orgId,
          'timesheet.amended',
          'clock_event',
          input.clockEventId,
          { reason: input.reason },
        );
        showSuccess('Attendance corrected. The previous value has been kept.');
        setSelected(null);
        await load({ quiet: true });
      } catch (error) {
        reportError(error, { area: 'dashboard:correct' });
        const message = (error as { message?: string })?.message;
        setCorrectionError(
          typeof message === 'string' && message.length < 200
            ? message
            : 'Could not save that correction. Please try again.',
        );
      } finally {
        setCorrecting(false);
      }
    },
    [orgId, showSuccess, load],
  );

  if (loading) {
    return <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>;
  }

  if (loadFailed && !overview) {
    return (
      <Card className="max-w-sm">
        <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
          Something went wrong loading the dashboard. Nothing is known about today&rsquo;s
          staffing until this succeeds.
        </p>
        <Button onClick={() => void load()}>Retry</Button>
      </Card>
    );
  }

  if (isManager) {
    return (
      <>
        <OperationsDashboard
          orgName={orgName ?? ''}
          locations={locations}
          selectedLocationId={locationId}
          onSelectLocation={setLocationId}
          timezone={timezone}
          mixedTimezones={reporting.mixed}
          today={today ?? EMPTY_DAY(operationalToday)}
          tomorrow={tomorrow ?? EMPTY_DAY(nextDay(operationalToday))}
          staffingDay={staffingDay}
          onStaffingDayChange={setStaffingDay}
          pending={pending}
          weekly={weekly}
          fetchedAt={fetchedAt}
          refreshing={refreshing}
          stale={!connected}
          onRefresh={() => void load({ quiet: true })}
          sort={sort}
          direction={direction}
          onSort={(id, dir) => {
            setSort(id);
            setDirection(dir);
          }}
          onOpenRow={openRow}
          setup={setup}
        />
        <AttendanceDetailModal
          open={selected !== null}
          onClose={() => setSelected(null)}
          row={selected}
          corrections={corrections}
          correctionsLoading={correctionsLoading}
          busy={correcting}
          error={correctionError}
          onCorrect={(input) => void handleCorrect(input)}
        />
      </>
    );
  }

  return (
    <StaffDashboard
      firstName={firstName}
      overview={overview!}
      myWeek={myWeek}
      myUpcoming={myUpcoming}
      leaveRemaining={leaveRemaining}
      holidayAllowance={holidayAllowance}
      openSwaps={badges.swaps}
    />
  );
}
