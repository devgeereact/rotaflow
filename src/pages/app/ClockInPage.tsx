import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { addDays, addWeeks, format, isSameDay, startOfWeek, subWeeks } from 'date-fns';
import { LifeBuoy, ScanLine, ShieldQuestion, WifiOff } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useGeolocation } from '@/hooks/useGeolocation';
import { useSyncQueue } from '@/hooks/useSyncQueue';
import { classifyFailure } from '@/services/syncQueue';
import { FailedWritesNotice } from '@/components/FailedWritesNotice';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { getMyStaffProfile } from '@/services/staffService';
import { listDepartments, listLocations } from '@/services/locationService';
import { listShiftTypes } from '@/services/shiftTypeService';
import { listShiftsForPeriod } from '@/services/shiftService';
import {
  getLatestClockEvent,
  listClockEventsForStaff,
  recordClockEvent,
} from '@/services/clockService';
import { checkGeofence } from '@/lib/geo';
import { pairClockEvents } from '@/lib/hours';
import { reportError } from '@/lib/sentry';
import {
  CLOCK_IN_WINDOW_MINUTES,
  buildAttendance,
  buildCurrentShift,
  buildRecentActivity,
  buildTodaySchedule,
  buildWeeklySummary,
  clockStage,
  clockWindow,
  pickCurrentShift,
  segmentsInRange,
} from '@/lib/clockRows';
import { Card } from '@/components/ui/Card';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { ClockInView } from '@/components/clockin/ClockInView';
import type { ClockLookups } from '@/lib/clockRows';
import type { HelpLink } from '@/components/clockin/NeedHelpCard';
import type {
  ClockEvent,
  ClockEventInsert,
  Department,
  Location,
  Shift,
  ShiftType,
  StaffProfile,
} from '@/types';

/**
 * The `clock_events.type` column is `text` + a check constraint, not a
 * Postgres enum, so the generated `ClockEvent['type']` is plain `string`,
 * too wide to index the lookups below safely. This is the app's own narrower
 * view of that same constraint.
 */
type ClockEventType = 'in' | 'break_start' | 'break_end' | 'out';

const ACTION_LABEL: Record<ClockEventType, string> = {
  in: 'Clock in',
  break_start: 'Start break',
  break_end: 'End break',
  out: 'Clock out',
};

type HelpTopic = 'policy' | 'trouble' | 'support';

const HELP_TITLE: Record<HelpTopic, string> = {
  policy: 'Clock In / Out Policy',
  trouble: 'Troubleshooting',
  support: 'Contact Support',
};

interface LoadedData {
  profile: StaffProfile | null;
  locations: Location[];
  departments: Department[];
  shiftTypes: ShiftType[];
  shifts: Shift[];
  events: ClockEvent[];
  latest: ClockEvent | null;
}

const EMPTY: LoadedData = {
  profile: null,
  locations: [],
  departments: [],
  shiftTypes: [],
  shifts: [],
  events: [],
  latest: null,
};

function nameById<T extends { id: string }>(
  rows: T[],
  name: (row: T) => string,
): Record<string, string> {
  return Object.fromEntries(rows.map((row) => [row.id, name(row)]));
}

/**
 * `/app/clock`. The live clock-in screen, matching design/clockin.png.
 *
 * Everything on it is computed from real rows: the shift and its break from
 * `shifts`, the day's schedule from the same, recent activity and both weeks'
 * hours from `clock_events` paired through `@/lib/hours`. The mapping lives in
 * `@/lib/clockRows` so `/clockin-preview` drives the identical component tree
 * from fixtures. The design loop screenshots what actually ships.
 *
 * GPS + manual only; QR and PIN are deferred. See `ClockActionPane`.
 *
 * The offline path is the point of this screen existing in Phase 5: a failed
 * insert. Network genuinely down, not a server rejection, queues via
 * useSyncQueue's 'clock' kind instead of failing the action outright.
 */
export function ClockInPage(): JSX.Element {
  const { orgId } = useOrg();
  const { user } = useSupabaseAuth();
  const online = useOnlineStatus();
  const geo = useGeolocation();
  const { enqueue, deadLettered, discard } = useSyncQueue();
  const { showError, showSuccess } = useToast();
  const navigate = useNavigate();

  const [data, setData] = useState<LoadedData>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [helpTopic, setHelpTopic] = useState<HelpTopic | null>(null);

  // The hero clock ticks every second, exactly as the reference shows it. Held
  // in state rather than read inline so every derived label. The countdown
  // pill, the time-window caption, "Today". Re-renders with it instead of
  // going stale on a screen someone leaves open across their whole shift.
  const [now, setNow] = useState<Date>(() => new Date());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  // Live updates: a manager correcting a clock event, or this person clocking
  // in on another device, should be reflected here rather than leaving two
  // screens disagreeing about whether they are on shift.
  useRealtimeRefresh({
    tables: ['clock_events'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => setReloadKey((k) => k + 1),
  });

  useEffect(() => {
    if (!orgId || !user) return;
    let active = true;
    void (async () => {
      try {
        // One window covering last week, this week and today, partitioned in
        // memory below, one range query rather than three overlapping ones.
        const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
        const fromIso = subWeeks(weekStart, 1).toISOString();
        const toIso = addWeeks(weekStart, 1).toISOString();

        const [profile, locations, departments, shiftTypes] = await Promise.all([
          getMyStaffProfile(orgId, user.id),
          listLocations(orgId),
          listDepartments(orgId),
          listShiftTypes(orgId),
        ]);
        if (!active) return;

        if (!profile) {
          setData({ ...EMPTY, locations, departments, shiftTypes });
          return;
        }

        const [shifts, events, latest] = await Promise.all([
          listShiftsForPeriod({ orgId, fromIso, toIso, staffProfileId: profile.id }),
          listClockEventsForStaff({ staffProfileId: profile.id, fromIso, toIso }),
          getLatestClockEvent(profile.id),
        ]);
        if (!active) return;

        setData({ profile, locations, departments, shiftTypes, shifts, events, latest });
        setLocationId((current) => current ?? locations[0]?.id ?? null);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'clock:load' });
        setLoadFailed(true);
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, user, reloadKey]);

  const lookups = useMemo<ClockLookups>(
    () => ({
      locationNames: nameById(data.locations, (l) => l.name),
      departmentNames: nameById(data.departments, (d) => d.name),
      shiftTypeNames: nameById(data.shiftTypes, (t) => t.name),
      jobTitle: data.profile?.job_title ?? null,
    }),
    [data.locations, data.departments, data.shiftTypes, data.profile],
  );

  const view = useMemo(() => {
    const weekStart = startOfWeek(now, { weekStartsOn: 1 });
    const nextWeekStart = addWeeks(weekStart, 1);
    const lastWeekStart = subWeeks(weekStart, 1);

    const startedIn = (shift: Shift, from: Date, to: Date): boolean => {
      const at = new Date(shift.starts_at);
      return at >= from && at < to;
    };

    const todayShifts = data.shifts.filter((s) => isSameDay(new Date(s.starts_at), now));
    const thisWeekShifts = data.shifts.filter((s) =>
      startedIn(s, weekStart, nextWeekStart),
    );
    const lastWeekShifts = data.shifts.filter((s) =>
      startedIn(s, lastWeekStart, weekStart),
    );

    const segments = pairClockEvents(data.events, now);
    const thisWeek = buildWeeklySummary(
      thisWeekShifts,
      segmentsInRange(segments, weekStart, nextWeekStart),
    );
    const lastWeek = buildWeeklySummary(
      lastWeekShifts,
      segmentsInRange(segments, lastWeekStart, weekStart),
    );

    const shift = pickCurrentShift(todayShifts, now);

    return {
      shift,
      currentShift: shift ? buildCurrentShift(shift, lookups, now) : null,
      schedule: buildTodaySchedule(todayShifts, lookups, now),
      activity: buildRecentActivity(data.events, now),
      weekly: {
        periodLabel: `${format(weekStart, 'd MMM')}, ${format(addDays(weekStart, 6), 'd MMM yyyy')}`,
        stats: thisWeek.stats,
        completedPercent: thisWeek.completedPercent,
        progressLabel: thisWeek.progressLabel,
      },
      attendance: buildAttendance(thisWeek.attendancePercent, lastWeek.attendancePercent),
      window: clockWindow(shift, now),
    };
  }, [data.shifts, data.events, lookups, now]);

  const stage = clockStage(data.latest);

  /**
   * Which site the event is recorded against: the rostered shift's, else the
   * one picked below. Geofencing is only meaningful against a real location.
   */
  const activeLocation = useMemo<Location | null>(() => {
    const id = view.shift?.location_id ?? locationId;
    return data.locations.find((l) => l.id === id) ?? null;
  }, [view.shift, locationId, data.locations]);

  const submit = useCallback(
    async (type: ClockEventType, method: 'gps' | 'manual'): Promise<void> => {
      if (!orgId || !data.profile) return;
      setSubmitting(true);
      try {
        let position: { latitude: number; longitude: number; accuracy: number } | null =
          null;
        let geofenceNote: string | null = null;

        if (method === 'gps') {
          position = await geo.request();
          if (!position) {
            showError(
              geo.status === 'denied'
                ? 'Location access was denied. Use manual clock-in instead, or allow location access and try again.'
                : 'Could not get your location. Try manual clock-in instead.',
            );
            setSubmitting(false);
            return;
          }
          if (activeLocation) {
            const check = checkGeofence(position, activeLocation);
            if (!check.withinFence) {
              geofenceNote = `${Math.round(check.distanceM)}m from ${activeLocation.name} (outside the ${activeLocation.geofence_radius_m}m geofence)`;
            }
          }
        }

        // Captured now, at the moment of the action — not left for the insert
        // to default server-side. On the offline path the insert doesn't
        // happen until the outbox flushes, sometimes hours later, and a
        // server-assigned timestamp would stamp the sync, not the clock-in.
        // (The server still won't blindly trust this: it's only honoured
        // within a ~72h window of the real time, see 0037's guard trigger.)
        const eventAt = new Date().toISOString();
        const input: ClockEventInsert = {
          org_id: orgId,
          staff_profile_id: data.profile.id,
          type,
          method,
          event_at: eventAt,
          shift_id: view.shift?.id ?? null,
          location_name: activeLocation?.name ?? null,
          latitude: position?.latitude ?? null,
          longitude: position?.longitude ?? null,
          accuracy: position?.accuracy ?? null,
        };

        // Shared by the "known offline" path and the "looked online but
        // wasn't" path below: reflects the action locally so the button and
        // status update immediately. The row does not exist in Postgres
        // until the outbox flushes, so this is a client-only optimistic
        // event, never read back from the server.
        const queueOffline = async (): Promise<void> => {
          await enqueue('clock', input);
          const stamp = new Date().toISOString();
          const optimistic = {
            id: `pending-${stamp}`,
            created_at: stamp,
            updated_at: stamp,
            synced: false,
            ...input,
          } as ClockEvent;
          setData((current) => ({
            ...current,
            latest: optimistic,
            events: [...current.events, optimistic],
          }));
          showSuccess(
            `${ACTION_LABEL[type]} saved offline. It will sync automatically when you're back online.`,
          );
        };

        if (!online) {
          await queueOffline();
          return;
        }

        try {
          const created = await recordClockEvent(input);
          setData((current) => ({
            ...current,
            latest: created,
            events: [...current.events, created],
          }));
          showSuccess(
            geofenceNote
              ? `${ACTION_LABEL[type]} recorded, ${geofenceNote}.`
              : `${ACTION_LABEL[type]} recorded.`,
          );
        } catch (err) {
          // `navigator.onLine` said we had a connection, but the request
          // still failed the way a dropped one does (captive portal,
          // associated-but-dead wifi — routine on a ward). Queue it rather
          // than just showing an error: the header's own documented design
          // is that a genuinely failed network write queues instead of being
          // lost, and until now only the `!online` branch above did that.
          if (classifyFailure(err) === 'transient') {
            await queueOffline();
            return;
          }
          throw err;
        }
      } catch (err) {
        reportError(err, { area: 'clock:submit' });
        showError(`Could not ${ACTION_LABEL[type].toLowerCase()}. Please try again.`);
      } finally {
        setSubmitting(false);
      }
    },
    [
      orgId,
      data.profile,
      view.shift,
      online,
      activeLocation,
      geo,
      enqueue,
      showError,
      showSuccess,
    ],
  );

  // Primary moves the shift forward; secondary is the alternate route to the
  // same place. Manual instead of GPS before the shift, breaks once it is
  // under way. Clocking out is reachable from both 'working' and 'break', so
  // nobody is trapped on a break they forgot to end.
  const onPrimary = useCallback((): void => {
    if (stage === 'working') void submit('out', 'gps');
    else if (stage === 'break') void submit('break_end', 'manual');
    else void submit('in', 'gps');
  }, [stage, submit]);

  const onSecondary = useCallback((): void => {
    if (stage === 'working') void submit('break_start', 'manual');
    else if (stage === 'break') void submit('out', 'gps');
    else void submit('in', 'manual');
  }, [stage, submit]);

  const help = useMemo<HelpLink[]>(
    () => [
      {
        id: 'policy',
        icon: ShieldQuestion,
        label: HELP_TITLE.policy,
        onSelect: () => setHelpTopic('policy'),
      },
      {
        id: 'trouble',
        icon: ScanLine,
        label: HELP_TITLE.trouble,
        onSelect: () => setHelpTopic('trouble'),
      },
      {
        id: 'support',
        icon: LifeBuoy,
        label: HELP_TITLE.support,
        onSelect: () => setHelpTopic('support'),
      },
    ],
    [],
  );

  if (loading) {
    return (
      <Card>
        <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
      </Card>
    );
  }

  if (loadFailed) {
    return (
      <Card>
        <p className="text-content-muted dark:text-content-muted-dark">
          Could not load your clock-in status. Check your connection and reload.
        </p>
      </Card>
    );
  }

  if (!data.profile) {
    return (
      <Card>
        <p className="text-content-muted dark:text-content-muted-dark">
          You don&rsquo;t have a staff profile in this organisation, so there is nothing
          to clock in to. Ask your manager to add you to the staff directory.
        </p>
      </Card>
    );
  }

  const notices = (
    <>
      {!online && (
        <div className="mt-6 flex items-center gap-2 rounded-xl border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <WifiOff size={16} aria-hidden="true" />
          You&rsquo;re offline. Clock actions are saved on this device and will sync
          automatically once you&rsquo;re back online.
        </div>
      )}
      {/* Queued-and-waiting and queued-but-rejected are different states and
          must not look alike. The banner above is reassuring on purpose. Those
          events will send. This one has to correct a belief: the person tapped
          Clock in, saw it succeed, and is not clocked in. */}
      <FailedWritesNotice items={deadLettered} onDiscard={discard} className="mt-6" />
    </>
  );

  // Only needed when no rostered shift names the site. Otherwise the shift's
  // own location is authoritative and a picker would only invite a wrong answer.
  const picker =
    !view.shift && data.locations.length > 1 ? (
      <div className="mt-4 w-full">
        <Select
          aria-label="Location"
          value={locationId ?? ''}
          onChange={(e) => setLocationId(e.target.value || null)}
        >
          {data.locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      </div>
    ) : null;

  return (
    <>
      <ClockInView
        policy={{
          title: 'Important',
          body: `Please clock in within ${CLOCK_IN_WINDOW_MINUTES} minutes of your scheduled start time.`,
        }}
        shift={view.currentShift}
        stage={stage}
        clockTime={format(now, 'HH:mm:ss')}
        clockDateLabel={format(now, 'EEEE, d MMM yyyy')}
        windowLabel={view.window.label}
        onPrimaryAction={onPrimary}
        onSecondaryAction={onSecondary}
        busy={submitting}
        actionExtra={picker}
        schedule={view.schedule}
        onViewFullSchedule={() => void navigate('/app/schedule')}
        activity={view.activity}
        onViewAllActivity={() => void navigate('/app/timesheets')}
        weekly={view.weekly}
        onViewTimesheet={() => void navigate('/app/timesheets')}
        attendance={view.attendance}
        onViewAttendanceReport={() => void navigate('/app/reports')}
        help={help}
        footer={{
          supportLine: 'Having issues clocking in?',
          contactLine: 'Your manager can correct any clock event from Timesheets.',
          onReportIssue: () => setHelpTopic('trouble'),
        }}
        notices={notices}
      />

      <Modal
        open={helpTopic !== null}
        onClose={() => setHelpTopic(null)}
        title={helpTopic ? HELP_TITLE[helpTopic] : ''}
      >
        <div className="space-y-3 text-sm text-content-muted dark:text-content-muted-dark">
          {helpTopic === 'policy' && (
            <>
              <p>
                Clock in from {CLOCK_IN_WINDOW_MINUTES} minutes before your shift starts
                until the moment it ends. A late clock-in is recorded but never blocked,
                an hour you worked must not go unpaid because a screen refused you.
              </p>
              <p>
                {activeLocation?.geofence_radius_m
                  ? `${activeLocation.name} has a ${activeLocation.geofence_radius_m}m geofence. Clocking in from outside it still succeeds; the distance is recorded on the event for your manager to see.`
                  : 'Your position is recorded with each GPS event when you allow it. No site here has a geofence configured, so nothing is checked against one.'}
              </p>
              <p>Breaks are unpaid and are deducted from your worked hours.</p>
            </>
          )}
          {helpTopic === 'trouble' && (
            <>
              <p>
                <span className="font-semibold text-content dark:text-content-dark">
                  Location denied or unavailable?
                </span>{' '}
                Use Clock In Manually. It records the same event without a position, and
                your manager can see which method was used.
              </p>
              <p>
                <span className="font-semibold text-content dark:text-content-dark">
                  No connection?
                </span>{' '}
                Clock in anyway. The event is saved on this device and sent automatically
                the moment you are back online.
              </p>
              <p>
                <span className="font-semibold text-content dark:text-content-dark">
                  Wrong shift showing?
                </span>{' '}
                Only published rotas appear here. If yours is still a draft, ask your
                manager to publish it.
              </p>
            </>
          )}
          {helpTopic === 'support' && (
            <>
              <p>
                Clock events are your organisation&rsquo;s records, so corrections go
                through them rather than RotaFlow: your manager or organisation owner can
                edit any event from Timesheets.
              </p>
              <p>
                Nothing you do here is lost, an event that could not be sent is queued on
                this device and retried, and one that was rejected is shown to you rather
                than silently dropped.
              </p>
            </>
          )}
        </div>
      </Modal>
    </>
  );
}
