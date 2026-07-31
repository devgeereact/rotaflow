import { useCallback, useEffect, useMemo, useState } from 'react';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import {
  CalendarDays,
  CalendarClock,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Download,
  Users,
} from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { listLocations } from '@/services/locationService';
import { listActiveStaff, getMyStaffProfile } from '@/services/staffService';
import { listShiftTypes } from '@/services/shiftTypeService';
import { listShiftsForPeriod } from '@/services/shiftService';
import { buildShiftMap, totalScheduledMinutes } from '@/lib/rotaGrid';
import {
  resolvePeriod,
  stepPeriod,
  todayIso,
  type ScheduleView,
} from '@/lib/schedulePeriod';
import { downloadIcs } from '@/lib/ics';
import { reportError } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { ScheduleGrid, type ScheduleGroup } from '@/components/schedule/ScheduleGrid';
import { ScheduleAgenda } from '@/components/schedule/ScheduleAgenda';
import type { Location, Shift, ShiftType, StaffProfile } from '@/types';

const VIEWS: { value: ScheduleView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'fortnight', label: '2 weeks' },
  { value: 'month', label: 'Month' },
];

const DEFAULT_TZ = 'Europe/London';

/**
 * `/app/schedule` — the published rota, for everyone.
 *
 * Shows only shifts on a *published* rota. Drafts are a manager's working copy;
 * surfacing them here would tell staff they are working a shift that is still
 * being moved around.
 *
 * Managers see the whole organisation grouped by location. Staff see their own
 * shifts as an agenda, which is what someone checking their phone actually
 * wants. Anyone without a staff profile (a manager never added to the directory)
 * gets the org view, since there is no personal schedule to show them.
 */
export function SchedulePage(): JSX.Element {
  const { orgId, orgName } = useOrg();
  const { canBuildRota } = usePermissions();
  const { user } = useSupabaseAuth();
  const { showError } = useToast();

  const [view, setView] = useState<ScheduleView>('week');
  const [anchor, setAnchor] = useState(todayIso);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [personalOnly, setPersonalOnly] = useState(false);

  const [locations, setLocations] = useState<Location[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [myProfile, setMyProfile] = useState<StaffProfile | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  // Live updates: refetch when someone else changes this data.
  useRealtimeRefresh({
    tables: ['shifts', 'rotas'],
    scope: { column: 'org_id', value: orgId },
    onChange: () => setReloadKey((k) => k + 1),
  });

  // Every location may have its own zone; the selected one wins, else the org's
  // first. Falls back to London rather than the browser zone (RULES.md §9).
  const timezone =
    locations.find((l) => l.id === locationId)?.timezone ??
    locations[0]?.timezone ??
    DEFAULT_TZ;

  const period = useMemo(
    () => resolvePeriod(view, anchor, timezone),
    [view, anchor, timezone],
  );

  // Org-level reference data.
  useEffect(() => {
    if (!orgId || !user) return;
    let active = true;
    void (async () => {
      try {
        const [locs, staffRows, types, mine] = await Promise.all([
          listLocations(orgId),
          listActiveStaff(orgId),
          listShiftTypes(orgId),
          getMyStaffProfile(orgId, user.id),
        ]);
        if (!active) return;
        setLocations(locs);
        setStaff(staffRows);
        setShiftTypes(types);
        setMyProfile(mine);
        // Staff land on their own schedule; managers on the whole org.
        setPersonalOnly(mine !== null && !canBuildRota);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'schedule:load-org-data' });
        setLoadFailed(true);
        showError('Could not load the schedule. Check your connection and retry.');
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, user, canBuildRota, reloadKey, showError]);

  // Shifts for the visible window.
  useEffect(() => {
    if (!orgId) return;
    let active = true;
    setLoading(true);
    setLoadFailed(false);
    void (async () => {
      try {
        const rows = await listShiftsForPeriod({
          orgId,
          fromIso: period.fromIso,
          toIso: period.toIso,
          locationId,
          staffProfileId: personalOnly ? myProfile?.id : null,
        });
        if (!active) return;
        setShifts(rows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'schedule:load-shifts' });
        setShifts([]);
        setLoadFailed(true);
        showError('Could not load shifts for this period.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [
    orgId,
    period.fromIso,
    period.toIso,
    locationId,
    personalOnly,
    myProfile,
    reloadKey,
    showError,
  ]);

  const shiftMap = useMemo(() => buildShiftMap(shifts, timezone), [shifts, timezone]);

  const shiftsByDate = useMemo(() => {
    const map = new Map<string, Shift[]>();
    for (const shift of shifts) {
      // toZonedTime, not a toLocaleString round-trip: re-parsing a formatted
      // locale string is brittle and silently wrong in some runtimes.
      const date = format(toZonedTime(new Date(shift.starts_at), timezone), 'yyyy-MM-dd');
      map.set(date, [...(map.get(date) ?? []), shift]);
    }
    return map;
  }, [shifts, timezone]);

  /** Staff grouped by where they are actually rostered this period. */
  const groups = useMemo<ScheduleGroup[]>(() => {
    const staffById = new Map(staff.map((s) => [s.id, s]));
    const byLocation = new Map<string | null, Set<string>>();

    for (const shift of shifts) {
      if (!shift.staff_profile_id) continue;
      const key = shift.location_id ?? null;
      const set = byLocation.get(key) ?? new Set<string>();
      set.add(shift.staff_profile_id);
      byLocation.set(key, set);
    }

    return [...byLocation.entries()]
      .map(([locId, ids]) => ({
        location: locId ? (locations.find((l) => l.id === locId) ?? null) : null,
        staff: [...ids]
          .map((id) => staffById.get(id))
          .filter((s): s is StaffProfile => s !== undefined)
          .sort((a, b) => a.last_name.localeCompare(b.last_name)),
      }))
      .sort((a, b) => (a.location?.name ?? '').localeCompare(b.location?.name ?? ''));
  }, [shifts, staff, locations]);

  const stats = useMemo(() => {
    const scheduledMinutes = totalScheduledMinutes(shifts);
    const people = new Set(
      shifts.map((s) => s.staff_profile_id).filter((id): id is string => id !== null),
    );
    const unfilled = shifts.filter((s) => s.staff_profile_id === null).length;
    return {
      people: people.size,
      shifts: shifts.length,
      hours: (scheduledMinutes / 60).toFixed(1),
      unfilled,
    };
  }, [shifts]);

  const handleExport = useCallback((): void => {
    if (shifts.length === 0) {
      showError('There are no published shifts in this period to export.');
      return;
    }
    const scope = personalOnly ? 'my-shifts' : 'schedule';
    downloadIcs(shifts, `rotaflow-${scope}-${period.dates[0] ?? anchor}`, {
      calendarName: personalOnly
        ? 'RotaFlow — my shifts'
        : `RotaFlow — ${orgName ?? 'schedule'}`,
      shiftTypes,
    });
  }, [shifts, personalOnly, period.dates, anchor, orgName, shiftTypes, showError]);

  const useAgenda = view === 'month' || personalOnly;

  if (loadFailed && shifts.length === 0 && !loading) {
    return (
      <Card>
        <p className="mb-4 text-content-muted dark:text-content-muted-dark">
          Could not load the schedule. This is a connection problem, not an empty rota —
          nothing has been lost.
        </p>
        <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </Card>
    );
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-2xl text-content dark:text-content-dark">
          Schedule
        </h1>
        <p className="text-sm text-content-muted dark:text-content-muted-dark">
          {personalOnly
            ? 'Your published shifts.'
            : 'Published rotas across your organisation.'}{' '}
          Draft rotas are not shown here.
        </p>
      </div>

      {/* ---- Period controls ---- */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1">
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
        </div>
        <Button size="sm" variant="ghost" onClick={() => setAnchor(todayIso())}>
          Today
        </Button>
        <p className="font-display text-lg font-semibold text-content dark:text-content-dark">
          {period.label}
        </p>

        <div className="ml-auto flex flex-wrap items-center gap-3">
          {locations.length > 1 && (
            <Select
              value={locationId ?? ''}
              onChange={(e) => setLocationId(e.target.value || null)}
              className="w-auto py-2"
              aria-label="Filter by location"
            >
              <option value="">All locations</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          )}
          <Button size="sm" variant="secondary" onClick={handleExport}>
            <Download size={14} aria-hidden="true" className="mr-1.5" />
            Export .ics
          </Button>
        </div>
      </div>

      {/* ---- View + scope toggles ---- */}
      <div className="mb-4 flex flex-wrap items-center gap-4 border-b border-surface-border pb-4 dark:border-surface-border-dark">
        <div className="flex gap-1" role="group" aria-label="Period length">
          {VIEWS.map((v) => (
            <button
              key={v.value}
              type="button"
              onClick={() => setView(v.value)}
              aria-pressed={view === v.value}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                view === v.value
                  ? 'bg-primary text-white'
                  : 'text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark',
              )}
            >
              {v.label}
            </button>
          ))}
        </div>

        {myProfile && (
          <div className="flex gap-1" role="group" aria-label="Whose shifts">
            <button
              type="button"
              onClick={() => setPersonalOnly(true)}
              aria-pressed={personalOnly}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                personalOnly
                  ? 'bg-surface text-primary dark:bg-surface-dark'
                  : 'text-content-muted hover:text-content dark:text-content-muted-dark',
              )}
            >
              My shifts
            </button>
            <button
              type="button"
              onClick={() => setPersonalOnly(false)}
              aria-pressed={!personalOnly}
              className={cn(
                'rounded-lg px-3 py-1.5 text-sm font-medium transition-colors',
                !personalOnly
                  ? 'bg-surface text-primary dark:bg-surface-dark'
                  : 'text-content-muted hover:text-content dark:text-content-muted-dark',
              )}
            >
              Everyone
            </button>
          </div>
        )}
      </div>

      {/* ---- Stats. Only what the schema can actually answer. ---- */}
      <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            icon: Users,
            label: personalOnly ? 'You' : 'Staff scheduled',
            value: personalOnly ? '1' : String(stats.people),
          },
          { icon: CalendarDays, label: 'Shifts', value: String(stats.shifts) },
          { icon: Clock3, label: 'Scheduled hours', value: `${stats.hours}h` },
          { icon: CalendarClock, label: 'Unfilled', value: String(stats.unfilled) },
        ].map(({ icon: Icon, label, value }) => (
          <Card key={label} className="flex items-center gap-3 p-4">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
              <Icon size={18} aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-xs text-content-muted dark:text-content-muted-dark">
                {label}
              </p>
              <p className="font-display text-xl font-semibold text-content dark:text-content-dark">
                {value}
              </p>
            </div>
          </Card>
        ))}
      </div>

      <Card className="p-0">
        {loading ? (
          <p className="p-6 text-sm text-content-muted dark:text-content-muted-dark">
            Loading…
          </p>
        ) : shifts.length === 0 ? (
          <p className="p-6 text-sm text-content-muted dark:text-content-muted-dark">
            No published shifts in this period.
            {canBuildRota && ' Build and publish a rota from the Rota Builder.'}
          </p>
        ) : useAgenda ? (
          <ScheduleAgenda
            dates={period.dates}
            shiftsByDate={shiftsByDate}
            shiftTypes={shiftTypes}
            locations={locations}
            staff={staff}
            timezone={timezone}
            hideNames={personalOnly}
          />
        ) : (
          <ScheduleGrid
            dates={period.dates}
            groups={groups}
            shiftMap={shiftMap}
            shiftTypes={shiftTypes}
            timezone={timezone}
          />
        )}
      </Card>
    </div>
  );
}
