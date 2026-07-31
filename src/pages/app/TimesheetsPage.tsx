import { useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { ChevronLeft, ChevronRight, Clock3, MapPin } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { getMyStaffProfile, listActiveStaff } from '@/services/staffService';
import { listClockEventsForOrg, listClockEventsForStaff } from '@/services/clockService';
import {
  pairClockEvents,
  totalWorkedMinutes,
  formatHours,
  type WorkedSegment,
} from '@/lib/hours';
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
import type { ClockEvent, StaffProfile } from '@/types';

const VIEWS: { value: ScheduleView; label: string }[] = [
  { value: 'week', label: 'Week' },
  { value: 'fortnight', label: '2 weeks' },
  { value: 'month', label: 'Month' },
];

/**
 * `/app/timesheets` — hours from `clock_events`, computed client-side via
 * `pairClockEvents`. Not the `timesheets` table's submit/approve/export
 * workflow: that table has no automation populating it (see lib/hours.ts),
 * and inventing submit/approve state transitions without a specified
 * business rule (weekly? monthly? who submits?) would be guessing at product
 * decisions Phase 5 was never given. This shows real worked hours; the formal
 * timesheet lifecycle is a deliberately separate, later piece.
 */
export function TimesheetsPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canApprove } = usePermissions();
  const { user } = useSupabaseAuth();
  const { showError } = useToast();

  const [view, setView] = useState<ScheduleView>('week');
  const [anchor, setAnchor] = useState(todayIso);
  const [teamMode, setTeamMode] = useState(false);

  const [myProfile, setMyProfile] = useState<StaffProfile | null>(null);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [events, setEvents] = useState<ClockEvent[]>([]);
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

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl text-content dark:text-content-dark">
            {teamMode ? 'Team hours' : 'My hours'}
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
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium',
                !teamMode
                  ? 'bg-surface text-primary dark:bg-surface-dark'
                  : 'text-content-muted dark:text-content-muted-dark',
              )}
            >
              My hours
            </button>
            <button
              type="button"
              onClick={() => setTeamMode(true)}
              aria-pressed={teamMode}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium',
                teamMode
                  ? 'bg-surface text-primary dark:bg-surface-dark'
                  : 'text-content-muted dark:text-content-muted-dark',
              )}
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
            Total hours{teamMode ? ' — whole team' : ''}
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
