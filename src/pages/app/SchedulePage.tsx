import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';
import { toZonedTime } from 'date-fns-tz';
import { CalendarDays, ChevronLeft, ChevronRight, Download } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useSupabaseAuth } from '@/hooks/useSupabaseAuth';
import { useToast } from '@/hooks/useToast';
import { useRealtimeRefresh } from '@/hooks/useRealtimeRefresh';
import { listDepartments, listLocations } from '@/services/locationService';
import { listActiveStaff, getMyStaffProfile } from '@/services/staffService';
import { listShiftTypes } from '@/services/shiftTypeService';
import { listShiftsForPeriod } from '@/services/shiftService';
import { listRotas } from '@/services/rotaService';
import { listAnnouncements } from '@/services/announcementService';
import { getPendingRequests, type PendingRequest } from '@/services/dashboardService';
import { shiftGroup, totalScheduledMinutes } from '@/lib/rotaGrid';
import {
  averageCoverage,
  buildScheduleGroups,
  computeScheduleTotals,
} from '@/lib/publishedSchedule';
import {
  resolvePeriod,
  stepPeriod,
  todayIso,
  type ScheduleView,
} from '@/lib/schedulePeriod';
import { rotaWorkspaceTabs } from '@/lib/workspaceTabs';
import { downloadIcs } from '@/lib/ics';
import { reportError } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EmptyState } from '@/components/ui/EmptyState';
import { Label } from '@/components/ui/Label';
import { LoadingState } from '@/components/ui/LoadingState';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { ScheduleAgenda } from '@/components/schedule/ScheduleAgenda';
import {
  PublishedScheduleView,
  type ScheduleSummary,
} from '@/components/schedule/PublishedScheduleView';
import type { ScheduleGrouping } from '@/components/schedule/ScheduleViewBar';
import type { ShiftDetails } from '@/components/schedule/ShiftDetailsPanel';
import type { ScheduleRequest } from '@/components/schedule/OpenRequestsCard';
import type { ScheduleAnnouncement } from '@/components/schedule/ScheduleAnnouncementsCard';
import type { PublishEvent } from '@/components/schedule/PublishingHistoryCard';
import type {
  Announcement,
  Department,
  Location,
  Rota,
  Shift,
  ShiftType,
  StaffProfile,
} from '@/types';

const VIEWS: { value: ScheduleView; label: string }[] = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'fortnight', label: '2 weeks' },
  { value: 'month', label: 'Month' },
];

const DEFAULT_TZ = 'Europe/London';

function hoursLabel(minutes: number): string {
  const whole = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return rest === 0 ? `${whole}h` : `${whole}h ${rest}m`;
}

/** "2 hours ago" / "3d ago" — announcements show relative age, as in the reference. */
function timeAgo(iso: string): string {
  const minutes = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 1)} minutes ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? '1 day ago' : `${days} days ago`;
}

/**
 * `/app/schedule` — the published rota, for everyone.
 *
 * Shows only shifts on a *published* rota. Drafts are a manager's working copy;
 * surfacing them here would tell staff they are working a shift that is still
 * being moved around.
 *
 * Managers see the whole organisation grouped by location, matching
 * design/published-schedule.png. Staff see their own shifts as an agenda, which
 * is what someone checking their phone actually wants. Anyone without a staff
 * profile (a manager never added to the directory) gets the org view, since
 * there is no personal schedule to show them.
 */
export function SchedulePage(): JSX.Element {
  const navigate = useNavigate();
  const { orgId, orgName, role } = useOrg();
  const { canBuildRota } = usePermissions();
  const { user } = useSupabaseAuth();
  const { showError } = useToast();

  const [view, setView] = useState<ScheduleView>('week');
  const [grouping, setGrouping] = useState<ScheduleGrouping>('location');
  const [anchor, setAnchor] = useState(todayIso);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [personalOnly, setPersonalOnly] = useState(false);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);

  const [locations, setLocations] = useState<Location[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [myProfile, setMyProfile] = useState<StaffProfile | null>(null);
  const [allShifts, setAllShifts] = useState<Shift[]>([]);
  const [rotas, setRotas] = useState<Rota[]>([]);
  const [announcements, setAnnouncements] = useState<Announcement[]>([]);
  const [pending, setPending] = useState<PendingRequest[]>([]);

  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  const [departments, setDepartments] = useState<Department[]>([]);
  const [shiftTypeFilter, setShiftTypeFilter] = useState('');
  const [departmentFilter, setDepartmentFilter] = useState('');
  const [openOnly, setOpenOnly] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

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
        const [locs, staffRows, types, mine, depts] = await Promise.all([
          listLocations(orgId),
          listActiveStaff(orgId),
          listShiftTypes(orgId),
          getMyStaffProfile(orgId, user.id),
          listDepartments(orgId),
        ]);
        if (!active) return;
        setLocations(locs);
        setStaff(staffRows);
        setShiftTypes(types);
        setMyProfile(mine);
        setDepartments(depts);
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
        setAllShifts(rows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'schedule:load-shifts' });
        setAllShifts([]);
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

  // Rail context — only the manager view renders it, so it is not fetched for
  // someone looking at their own shifts on a phone.
  useEffect(() => {
    if (!orgId || personalOnly || staff.length === 0) return;
    let active = true;
    void (async () => {
      try {
        const staffById = new Map(staff.map((s) => [s.id, s]));
        const [rotaRows, announcementRows, requestRows] = await Promise.all([
          listRotas(orgId),
          listAnnouncements(orgId),
          getPendingRequests(orgId, staffById),
        ]);
        if (!active) return;
        setRotas(rotaRows);
        setAnnouncements(announcementRows);
        setPending(requestRows);
      } catch (err) {
        if (!active) return;
        // Non-fatal: the grid is the screen, this is context around it.
        reportError(err, { area: 'schedule:load-rail' });
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, personalOnly, staff, reloadKey]);

  /**
   * What the screen actually shows, after the Filters dialog.
   *
   * Deliberately derived once here rather than applied inside each consumer:
   * the grid, the coverage totals, the summary tiles and the ICS export all
   * read `shifts`, and a filter that moved the grid without moving the
   * coverage percentage beside it would be reporting on rows nobody can see.
   */
  const shifts = useMemo(() => {
    let rows = allShifts;
    if (shiftTypeFilter) rows = rows.filter((s) => s.shift_type_id === shiftTypeFilter);
    if (departmentFilter) rows = rows.filter((s) => s.department_id === departmentFilter);
    if (openOnly) rows = rows.filter((s) => s.staff_profile_id === null);
    return rows;
  }, [allShifts, shiftTypeFilter, departmentFilter, openOnly]);

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

  const groups = useMemo(
    () =>
      buildScheduleGroups({
        shifts,
        staff,
        locations,
        shiftTypes,
        fallbackTimezone: timezone,
      }),
    [shifts, staff, locations, shiftTypes, timezone],
  );

  const totals = useMemo(
    () => computeScheduleTotals(shifts, period.dates, timezone),
    [shifts, period.dates, timezone],
  );

  /**
   * Hours scheduled beyond a person's contracted `weekly_hours`. Only the week
   * view can answer this — over a fortnight or a month "weekly hours" is not
   * the right comparison, so the tile reads "—" rather than a wrong number.
   */
  const overtime = useMemo<string | null>(() => {
    if (view !== 'week') return null;
    const byStaff = new Map<string, number>();
    for (const shift of shifts) {
      if (!shift.staff_profile_id) continue;
      byStaff.set(
        shift.staff_profile_id,
        (byStaff.get(shift.staff_profile_id) ?? 0) + totalScheduledMinutes([shift]),
      );
    }
    let extra = 0;
    for (const [staffId, minutes] of byStaff) {
      const contracted = staff.find((s) => s.id === staffId)?.weekly_hours;
      if (contracted === null || contracted === undefined) continue;
      extra += Math.max(0, minutes - contracted * 60);
    }
    return hoursLabel(extra);
  }, [view, shifts, staff]);

  const summary = useMemo<ScheduleSummary>(() => {
    const people = new Set(
      shifts.map((s) => s.staff_profile_id).filter((id): id is string => id !== null),
    );
    const leave = pending.filter((r) => r.kind === 'leave').length;
    const swaps = pending.filter((r) => r.kind === 'swap').length;
    return {
      totalStaff: people.size,
      totalShifts: shifts.length,
      averageCoverage: averageCoverage(totals),
      scheduledHours: hoursLabel(totalScheduledMinutes(shifts)),
      overtime,
      openRequests: pending.length,
      openRequestsBreakdown:
        pending.length === 0 ? 'Nothing waiting' : `${leave} leave • ${swaps} swaps`,
      locationCount: locations.length,
    };
  }, [shifts, totals, overtime, pending, locations.length]);

  /** The clicked shift, expanded into everyone rostered on that same slot. */
  const selectedShift = useMemo<ShiftDetails | null>(() => {
    const shift = shifts.find((s) => s.id === selectedShiftId);
    if (!shift) return null;
    const staffById = new Map(staff.map((s) => [s.id, s]));
    const group = shiftGroup(shifts, shift);
    const assigned = group
      .map((s) => (s.staff_profile_id ? staffById.get(s.staff_profile_id) : undefined))
      .filter((s): s is StaffProfile => s !== undefined);
    const zone = locations.find((l) => l.id === shift.location_id)?.timezone ?? timezone;
    const start = toZonedTime(new Date(shift.starts_at), zone);
    const end = toZonedTime(new Date(shift.ends_at), zone);
    const hours = Math.round(
      (new Date(shift.ends_at).getTime() - new Date(shift.starts_at).getTime()) /
        3_600_000,
    );
    const type = shiftTypes.find((t) => t.id === shift.shift_type_id);

    return {
      id: shift.id,
      typeName: type?.name ?? 'Shift',
      colour: shift.colour ?? type?.colour ?? null,
      locationName:
        locations.find((l) => l.id === shift.location_id)?.name ?? 'No location',
      dateLabel: format(start, 'EEE, d MMM yyyy'),
      timeLabel: `${format(start, 'HH:mm')} – ${format(end, 'HH:mm')} (${hours}h)`,
      published: true,
      slots: group.length,
      assigned: assigned.map((person) => ({
        id: person.id,
        firstName: person.first_name,
        lastName: person.last_name,
        photoUrl: person.photo_url,
        roleCode: person.job_title,
        // `shifts.status` is the slot's own state; 'confirmed' means the person
        // has acknowledged it. Anything else reads as not yet confirmed.
        confirmed:
          group.find((s) => s.staff_profile_id === person.id)?.status === 'confirmed',
      })),
      skills: [...new Set(assigned.flatMap((person) => person.skills))],
      notes: shift.notes,
    };
  }, [selectedShiftId, shifts, staff, locations, shiftTypes, timezone]);

  /** Rotas overlapping this period, newest publish first. */
  const periodRotas = useMemo(
    () =>
      rotas.filter(
        (rota) =>
          rota.period_start <= (period.dates[period.dates.length - 1] ?? '') &&
          rota.period_end >= (period.dates[0] ?? ''),
      ),
    [rotas, period.dates],
  );

  const publishedAtLabel = useMemo<string | null>(() => {
    const stamps = periodRotas
      .map((r) => r.published_at)
      .filter((iso): iso is string => iso !== null)
      .sort();
    const latest = stamps[stamps.length - 1];
    return latest ? format(new Date(latest), 'd MMM yyyy, HH:mm') : null;
  }, [periodRotas]);

  const history = useMemo<PublishEvent[]>(
    () =>
      rotas
        .filter(
          (rota): rota is Rota & { published_at: string } => rota.published_at !== null,
        )
        .sort((a, b) => b.published_at.localeCompare(a.published_at))
        .slice(0, 3)
        .map((rota) => ({
          id: rota.id,
          // `rotas` has no published_by column, so this names the rota, not a
          // person — inventing an author would be worse than omitting one.
          label: `${rota.name} published`,
          timeLabel: format(new Date(rota.published_at), 'd MMM yyyy, HH:mm'),
        })),
    [rotas],
  );

  /** Every publication, for the dialog. `history` is the rail's top three. */
  const fullHistory = useMemo<PublishEvent[]>(
    () =>
      rotas
        .filter(
          (rota): rota is Rota & { published_at: string } => rota.published_at !== null,
        )
        .sort((a, b) => b.published_at.localeCompare(a.published_at))
        .map((rota) => ({
          id: rota.id,
          label: `${rota.name} published`,
          timeLabel: format(new Date(rota.published_at), 'd MMM yyyy, HH:mm'),
        })),
    [rotas],
  );

  const requests = useMemo<ScheduleRequest[]>(
    () =>
      pending.slice(0, 3).map((request) => ({
        id: request.id,
        kind: request.kind === 'leave' ? 'Leave Request' : 'Swap Request',
        name: request.staffName,
        photoUrl: null,
        dateLabel: request.dateLabel,
        status: 'pending' as const,
      })),
    [pending],
  );

  const railAnnouncements = useMemo<ScheduleAnnouncement[]>(
    () =>
      announcements.slice(0, 2).map((item) => ({
        id: item.id,
        title: item.title,
        body: item.body,
        timeLabel: timeAgo(item.created_at),
        tone: 'general' as const,
      })),
    [announcements],
  );

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

  const activeFilterCount =
    (shiftTypeFilter ? 1 : 0) + (departmentFilter ? 1 : 0) + (openOnly ? 1 : 0);

  /** Shared by the grid and the agenda branch — declared once. */
  const dialogs = (
    <>
      <Modal
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filter this schedule"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="sched-type">Shift type</Label>
            <Select
              id="sched-type"
              value={shiftTypeFilter}
              onChange={(e) => setShiftTypeFilter(e.target.value)}
            >
              <option value="">All shift types</option>
              {shiftTypes.map((type) => (
                <option key={type.id} value={type.id}>
                  {type.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="sched-dept">Department</Label>
            <Select
              id="sched-dept"
              value={departmentFilter}
              onChange={(e) => setDepartmentFilter(e.target.value)}
            >
              <option value="">All departments</option>
              {departments.map((dept) => (
                <option key={dept.id} value={dept.id}>
                  {dept.name}
                </option>
              ))}
            </Select>
          </div>
          <label className="flex min-h-11 cursor-pointer items-center gap-2.5 text-sm text-content dark:text-content-dark">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => setOpenOnly(e.target.checked)}
              className="h-4 w-4 rounded border-surface-border text-primary focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
            />
            Only show open shifts (nobody assigned)
          </label>
          <p className="text-sm text-content dark:text-content-dark">
            Showing <strong>{shifts.length}</strong> of {allShifts.length} published
            shifts. Coverage and the summary tiles follow this filter.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={activeFilterCount === 0}
              onClick={() => {
                setShiftTypeFilter('');
                setDepartmentFilter('');
                setOpenOnly(false);
              }}
            >
              Clear
            </Button>
            <Button onClick={() => setFiltersOpen(false)}>Done</Button>
          </div>
        </div>
      </Modal>

      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Publishing history"
      >
        {fullHistory.length === 0 ? (
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Nothing has been published for this organisation yet. Publishing a rota from
            the Rota Builder records an entry here.
          </p>
        ) : (
          <ul className="max-h-96 space-y-2 overflow-y-auto">
            {fullHistory.map((event) => (
              <li
                key={event.id}
                className="rounded-lg border border-surface-border p-3 dark:border-surface-border-dark"
              >
                <p className="text-sm font-semibold text-content dark:text-content-dark">
                  {event.label}
                </p>
                <p className="text-xs text-content-muted dark:text-content-muted-dark">
                  {event.timeLabel}
                </p>
              </li>
            ))}
          </ul>
        )}
        {/* `rotas` has no published_by column. Saying so beats an invented name. */}
        <p className="mt-4 border-t border-surface-border pt-3 text-xs text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
          Rotas record when they were published, but not by whom, so no author is shown.
        </p>
      </Modal>
    </>
  );

  // ---- Manager / whole-organisation view -----------------------------------
  // The month view stays an agenda: 30+ columns cannot be a readable grid.
  if (!personalOnly && view !== 'month') {
    return (
      <>
        <PublishedScheduleView
          periodLabel={period.label}
          view={view}
          onViewChange={setView}
          grouping={grouping}
          onGroupingChange={setGrouping}
          locations={locations.map((l) => ({ id: l.id, name: l.name }))}
          locationId={locationId}
          onLocationChange={setLocationId}
          onPrev={() => setAnchor((a) => stepPeriod(view, a, -1))}
          onNext={() => setAnchor((a) => stepPeriod(view, a, 1))}
          onToday={() => setAnchor(todayIso())}
          onExport={handleExport}
          onPrint={() => window.print()}
          onFilters={() => setFiltersOpen(true)}
          // Display preferences are a person's own settings and already have a
          // screen (§21). A second, screen-local copy of them would be two
          // sources of truth for the same choice.
          onSettings={() => {
            void navigate('/app/account/preferences');
          }}
          summary={summary}
          dates={period.dates}
          today={todayIso()}
          groups={groups}
          totals={totals}
          selectedChipId={selectedShiftId}
          onSelectChip={setSelectedShiftId}
          selectedShift={selectedShift}
          onCloseShift={() => setSelectedShiftId(null)}
          published={shifts.length > 0}
          publishedAtLabel={publishedAtLabel}
          onViewHistory={() => setHistoryOpen(true)}
          tabs={rotaWorkspaceTabs(role)}
          requests={requests}
          announcements={railAnnouncements}
          history={history}
          gridPlaceholder={
            loading
              ? 'Loading…'
              : shifts.length === 0
                ? `No published shifts in this period.${canBuildRota ? ' Build and publish a rota from the Rota Builder.' : ''}`
                : undefined
          }
        />
        {dialogs}
      </>
    );
  }

  // ---- Personal / month agenda ---------------------------------------------
  return (
    <div>
      <div className="mb-6">
        <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
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
            className="rounded-lg border border-surface-border p-1.5 text-content-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-muted-dark"
          >
            <ChevronLeft size={16} aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => setAnchor((a) => stepPeriod(view, a, 1))}
            aria-label="Next period"
            className="rounded-lg border border-surface-border p-1.5 text-content-muted hover:text-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:text-content-muted-dark"
          >
            <ChevronRight size={16} aria-hidden="true" />
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
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
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
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
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
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
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

      {loading ? (
        <Card>
          <LoadingState variant="card" rows={4} label="Loading shifts…" />
        </Card>
      ) : shifts.length === 0 ? (
        <Card>
          <EmptyState
            icon={CalendarDays}
            title="No published shifts in this period"
            description={
              canBuildRota ? 'Build and publish a rota from the Rota Builder.' : undefined
            }
          />
        </Card>
      ) : (
        <Card className="p-0">
          <ScheduleAgenda
            dates={period.dates}
            shiftsByDate={shiftsByDate}
            shiftTypes={shiftTypes}
            locations={locations}
            staff={staff}
            timezone={timezone}
            hideNames={personalOnly}
          />
        </Card>
      )}
    </div>
  );
}
