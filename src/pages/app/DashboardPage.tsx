import { useCallback, useEffect, useState } from 'react';
import { useOrg } from '@/hooks/useOrg';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { useNavBadges } from '@/hooks/useNavBadges';
import { getProfile } from '@/services/profileService';
import { getOrganisation } from '@/services/orgService';
import { getMyStaffProfile } from '@/services/staffService';
import { listMyLeaveRequests } from '@/services/leaveService';
import {
  getPendingRequests,
  loadDashboardOverview,
  loadWeeklyRosterSummary,
  loadMyWeekSummary,
  loadMyUpcomingShifts,
  loadRosteredHoursTrend,
  type DashboardOverview,
  type MyWeekSummary,
  type PendingRequest,
  type ShiftGroup,
  type WeeklyRosterSummary,
} from '@/services/dashboardService';
import { schedulingPolicies } from '@/lib/orgPreferences';
import { sumApprovedLeaveDays } from '@/lib/leaveEntitlement';
import { resolvePeriod, todayIso } from '@/lib/schedulePeriod';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { ManagerDashboard } from '@/components/dashboard/ManagerDashboard';
import { StaffDashboard } from '@/components/dashboard/StaffDashboard';

const DEFAULT_TZ = 'Europe/London';

/** `/app/dashboard`. Real data wiring; see ManagerDashboard/StaffDashboard for the markup. */
export function DashboardPage(): JSX.Element {
  const { orgId, orgName, role } = useOrg();
  const { user } = useSupabaseAuth();
  const { showError } = useToast();
  const isManager = role === 'owner' || role === 'manager';
  const badges = useNavBadges(orgId);

  const [firstName, setFirstName] = useState<string | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [weekly, setWeekly] = useState<WeeklyRosterSummary | null>(null);
  const [hoursTrend, setHoursTrend] = useState<number[]>([]);
  const [myWeek, setMyWeek] = useState<MyWeekSummary | null>(null);
  const [myUpcoming, setMyUpcoming] = useState<ShiftGroup[]>([]);
  const [leaveRemaining, setLeaveRemaining] = useState<number | null>(null);
  const [holidayAllowance, setHolidayAllowance] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    if (!orgId || !user) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      const [profile, data, org] = await Promise.all([
        getProfile(user.id),
        loadDashboardOverview(orgId, DEFAULT_TZ, todayIso()),
        getOrganisation(orgId),
      ]);
      setFirstName(profile?.full_name?.split(' ')[0] ?? null);
      setOverview(data);

      const week = resolvePeriod('week', todayIso(), DEFAULT_TZ);
      const policies = schedulingPolicies(org.settings);

      if (isManager) {
        const staffById = new Map(data.staff.map((s) => [s.id, s]));
        const [pendingRows, weeklySummary, trend] = await Promise.all([
          getPendingRequests(orgId, staffById),
          loadWeeklyRosterSummary(
            orgId,
            week.dates,
            week.fromIso,
            week.toIso,
            policies.minStaffOnShift,
            data.staff,
          ),
          loadRosteredHoursTrend(orgId, todayIso(), DEFAULT_TZ),
        ]);
        setPending(pendingRows);
        setWeekly(weeklySummary);
        setHoursTrend(trend);
      } else {
        const me = await getMyStaffProfile(orgId, user.id);
        if (me) {
          const sevenDaysFrom = resolvePeriod('day', todayIso(), DEFAULT_TZ).fromIso;
          const sevenDaysTo = resolvePeriod('week', todayIso(), DEFAULT_TZ).toIso;
          const [mine, upcoming, myLeave] = await Promise.all([
            loadMyWeekSummary(orgId, me.id, week.fromIso, week.toIso),
            loadMyUpcomingShifts(
              orgId,
              me.id,
              sevenDaysFrom,
              sevenDaysTo,
              data.shiftTypes,
              data.locations,
            ),
            listMyLeaveRequests(me.id),
          ]);
          setMyWeek(mine);
          setMyUpcoming(upcoming);
          const yearStart = `${new Date().getFullYear()}-01-01`;
          const yearEnd = `${new Date().getFullYear()}-12-31`;
          const used = sumApprovedLeaveDays(myLeave, yearStart, yearEnd);
          const allowance = me.holiday_allowance ?? 0;
          setLeaveRemaining(Math.max(0, allowance - used));
          setHolidayAllowance(allowance);
        }
      }
    } catch (error) {
      reportError(error, { area: 'dashboard:load' });
      setLoadFailed(true);
      showError('Could not load the dashboard. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [orgId, user, showError, isManager]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live updates: refetch when someone else changes this data.
  useRealtimeRefresh({
    tables: ['shifts', 'rotas', 'leave_requests', 'shift_swaps', 'announcements'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => void load(),
  });

  if (loading) {
    return <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>;
  }

  if (loadFailed && !overview) {
    return (
      <Card className="max-w-sm">
        <p className="mb-4 text-sm text-content-muted dark:text-content-muted-dark">
          Something went wrong loading the dashboard.
        </p>
        <Button onClick={() => void load()}>Retry</Button>
      </Card>
    );
  }

  if (isManager) {
    return (
      <ManagerDashboard
        firstName={firstName}
        orgName={orgName ?? ''}
        overview={overview!}
        pending={pending}
        weekly={weekly}
        hoursTrend={hoursTrend}
      />
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
