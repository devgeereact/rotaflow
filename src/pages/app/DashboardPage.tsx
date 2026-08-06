import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { useOrg } from '@/hooks/useOrg';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { getProfile } from '@/services/profileService';
import { listShiftsForPeriod } from '@/services/shiftService';
import {
  getPendingRequests,
  groupShifts,
  loadDashboardOverview,
  type DashboardOverview,
  type PendingRequest,
  type ShiftGroup,
} from '@/services/dashboardService';
import { resolvePeriod, stepPeriod, todayIso } from '@/lib/schedulePeriod';
import { reportError } from '@/lib/sentry';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { DashboardView } from '@/components/dashboard/DashboardView';

const DEFAULT_TZ = 'Europe/London';

/** `/app/dashboard`. Real data wiring; see DashboardView for the markup. */
export function DashboardPage(): JSX.Element {
  const { orgId } = useOrg();
  const { user } = useSupabaseAuth();
  const { showError } = useToast();

  const [firstName, setFirstName] = useState<string | null>(null);
  const [overview, setOverview] = useState<DashboardOverview | null>(null);
  const [pending, setPending] = useState<PendingRequest[]>([]);
  const [dayAnchor, setDayAnchor] = useState(todayIso);
  const [dayGroups, setDayGroups] = useState<ShiftGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [dayLoading, setDayLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  const timezone = overview?.locations[0]?.timezone ?? DEFAULT_TZ;

  const load = useCallback(async (): Promise<void> => {
    if (!orgId || !user) return;
    setLoading(true);
    setLoadFailed(false);
    try {
      const [profile, data] = await Promise.all([
        getProfile(user.id),
        loadDashboardOverview(orgId, DEFAULT_TZ, todayIso()),
      ]);
      setFirstName(profile?.full_name?.split(' ')[0] ?? null);
      setOverview(data);

      const staffById = new Map(data.staff.map((s) => [s.id, s]));
      setPending(await getPendingRequests(orgId, staffById));
    } catch (error) {
      reportError(error, { area: 'dashboard:load' });
      setLoadFailed(true);
      showError('Could not load the dashboard. Please try again.');
    } finally {
      setLoading(false);
    }
  }, [orgId, user, showError]);

  useEffect(() => {
    void load();
  }, [load]);

  // Live updates: refetch when someone else changes this data.
  useRealtimeRefresh({
    tables: ['shifts', 'leave_requests', 'shift_swaps', 'announcements'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => void load(),
  });

  // Re-fetched separately so stepping through days doesn't reload the whole page.
  useEffect(() => {
    if (!orgId || !overview) return;
    let cancelled = false;
    setDayLoading(true);
    const period = resolvePeriod('day', dayAnchor, timezone);
    listShiftsForPeriod({ orgId, fromIso: period.fromIso, toIso: period.toIso })
      .then((shifts) => {
        if (cancelled) return;
        setDayGroups(groupShifts(shifts, overview.shiftTypes, overview.locations));
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        reportError(error, { area: 'dashboard:day-shifts' });
        showError('Could not load the schedule for that day.');
      })
      .finally(() => {
        if (!cancelled) setDayLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, overview, dayAnchor, timezone, showError]);

  const dayLabel = useMemo(
    () => format(new Date(`${dayAnchor}T00:00:00`), 'EEEE, d MMMM yyyy'),
    [dayAnchor],
  );

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

  return (
    <DashboardView
      firstName={firstName}
      overview={overview!}
      pending={pending}
      dayGroups={dayGroups}
      dayLoading={dayLoading}
      dayLabel={dayLabel}
      timezone={timezone}
      now={now}
      onPrevDay={() => setDayAnchor((d) => stepPeriod('day', d, -1))}
      onNextDay={() => setDayAnchor((d) => stepPeriod('day', d, 1))}
      onToday={() => setDayAnchor(todayIso())}
      onSelectDate={setDayAnchor}
    />
  );
}
