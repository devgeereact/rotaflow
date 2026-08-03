import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { format } from 'date-fns';
import {
  CalendarCheck,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { PermissionDenied } from '@/components/PermissionDenied';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import { useInngestDispatch } from '@/hooks/useInngestDispatch';
import { listLocations, listDepartments } from '@/services/locationService';
import { listActiveStaff } from '@/services/staffService';
import { listShiftTypes } from '@/services/shiftTypeService';
import { listOrgLeaveRequests } from '@/services/leaveService';
import { listOrgAvailability } from '@/services/availabilityService';
import { listExpiringDocuments } from '@/services/documentService';
import {
  getOrCreateRotaForPeriod,
  publishRota,
  unpublishRota,
} from '@/services/rotaService';
import {
  createShift,
  deleteShift,
  listShiftsForRota,
  updateShift,
} from '@/services/shiftService';
import type { AiShiftSuggestion } from '@/services/aiRotaService';
import { reportError } from '@/lib/sentry';
import { cn } from '@/lib/utils';
import {
  buildShiftMap,
  computeDailyTotals,
  computeShiftIsoRange,
  fromIsoInTimezone,
  getMonday,
  getWeekDates,
  shiftCellKey,
} from '@/lib/rotaGrid';
import { findClashingShift, ShiftClashError } from '@/lib/shiftConflicts';
import { computeRotaInsights } from '@/lib/rotaInsights';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { rotaWorkspaceTabs } from '@/lib/workspaceTabs';
import { RotaGrid, type RotaGroup } from '@/components/rota/RotaGrid';
import { ShiftInspectorPanel } from '@/components/rota/ShiftInspectorPanel';
import { RotaActionRail } from '@/components/rota/RotaActionRail';
import {
  AssignShiftModal,
  type AssignShiftFormValues,
} from '@/components/rota/AssignShiftModal';
import { ShiftTypeManagerModal } from '@/components/rota/ShiftTypeManagerModal';
import { RotaAssistantPanel } from '@/components/rota/RotaAssistantPanel';
import type {
  Availability,
  Department,
  LeaveRequest,
  Location,
  Rota,
  Shift,
  ShiftType,
  StaffDocument,
  StaffProfile,
} from '@/types';

const DEFAULT_TZ = 'Europe/London';

/**
 * The two views §8 of the build prompt actually asks for: "Weekly view" and
 * "Daily view".
 *
 * There used to be four. "2 Weeks" and "Month" were rendered but inert, and
 * for a real reason: rotas key on an exact `period_start`/`period_end` pair
 * (rotaService.ts), so a fortnight or a month is a *different rota row* from
 * the week inside it, and editing across one would fragment a week's shifts
 * over incompatible rotas.
 *
 * They are removed rather than made to work. The alternative — loading five
 * weekly rotas behind a "Month" tab — creates rota rows as a side effect of
 * looking at a calendar, and the publish button then means something different
 * depending on which tab is open. Two honest views beat four where half are
 * decoration.
 *
 * "Day" is safe because it is only a *display scope*: the same week's rota
 * stays loaded and editable, and the grid renders one of its columns.
 */
const VIEW_TABS = ['Day', 'Week'] as const;
type RotaViewMode = (typeof VIEW_TABS)[number];

/**
 * One shift on the clipboard, stored relative to its week rather than on an
 * absolute date. `dayOffset` is 0–6 from that week's Monday, so pasting into
 * a different week keeps Tuesday on Tuesday.
 */
interface CopiedShift {
  dayOffset: number;
  staffProfileId: string | null;
  shiftTypeId: string | null;
  locationId: string;
  startTime: string;
  endTime: string;
  breakMinutes: number;
  notes: string | null;
}

/**
 * Outcome of trying to write one shift. `clash` is the shift already in the
 * diary that the new one would have overlapped; `unavailable` means the org,
 * location or rota context was not ready and nothing was attempted.
 */
type PlaceResult =
  | { ok: true; shift: Shift }
  | { ok: false; reason: 'clash'; clash: Shift }
  | { ok: false; reason: 'unavailable' };

interface AssignModalState {
  open: boolean;
  context: { staffProfileId: string | null; date: string; locationId: string } | null;
  shift: Shift | null;
}

function formatWeekRange(dates: string[]): string {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return '';
  const start = new Date(`${first}T00:00:00`);
  const end = new Date(`${last}T00:00:00`);
  const sameMonth = start.getMonth() === end.getMonth();
  return sameMonth
    ? `${format(start, 'd MMM')} – ${format(end, 'd MMM yyyy')}`
    : `${format(start, 'd MMM')} – ${format(end, 'd MMM yyyy')}`;
}

export function RotaBuilderPage(): JSX.Element {
  const { orgId, role } = useOrg();
  const { canBuildRota } = usePermissions();
  const { showError, showSuccess } = useToast();
  const { confirm } = useConfirm();
  const { send } = useInngestDispatch();

  const [locations, setLocations] = useState<Location[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [rotasByLocation, setRotasByLocation] = useState<Map<string, Rota>>(new Map());
  const [shifts, setShifts] = useState<Shift[]>([]);
  // The clash guard has to see every shift already written this tick. A bulk
  // paste awaits one insert at a time and React will not have re-rendered
  // between them, so reading `shifts` from the closure would check each new
  // shift against a snapshot taken before the loop started — and let the whole
  // batch through.
  const shiftsRef = useRef<Shift[]>([]);
  useEffect(() => {
    shiftsRef.current = shifts;
  }, [shifts]);

  // Inputs the warning rules need beyond the shifts themselves.
  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [documents, setDocuments] = useState<StaffDocument[]>([]);
  // One clock for every rule, ticked once a minute. Reading Date.now() inside
  // the memo would make "is this shift in the past" depend on render timing.
  const [insightsNow, setInsightsNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setInsightsNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const [orgDataLoading, setOrgDataLoading] = useState(true);
  const [orgDataFailed, setOrgDataFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);
  const [publishMenuOpen, setPublishMenuOpen] = useState(false);
  const [actionsMenuOpen, setActionsMenuOpen] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);

  const [locationFilter, setLocationFilter] = useState<string>('all');
  const [departmentFilter, setDepartmentFilter] = useState<string>('all');
  const [shiftTypeFilter, setShiftTypeFilter] = useState<string>('all');
  const [search, setSearch] = useState('');

  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [assignModal, setAssignModal] = useState<AssignModalState>({
    open: false,
    context: null,
    shift: null,
  });
  const [shiftTypeModalOpen, setShiftTypeModalOpen] = useState(false);
  const [autoFillOpen, setAutoFillOpen] = useState(false);
  const [previewSuggestions, setPreviewSuggestions] = useState<AiShiftSuggestion[]>([]);

  const [viewMode, setViewMode] = useState<RotaViewMode>('Week');
  const [focusedDate, setFocusedDate] = useState<string | null>(null);
  const [moreFiltersOpen, setMoreFiltersOpen] = useState(false);
  /** All / only unfilled / only filled. Replaces the old open-shifts checkbox. */
  const [assignmentFilter, setAssignmentFilter] = useState<'all' | 'open' | 'assigned'>(
    'all',
  );
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [problemsOnly, setProblemsOnly] = useState(false);
  /** Drops roster rows with nothing on them this week, to shorten the grid. */
  const [hideEmptyStaff, setHideEmptyStaff] = useState(false);
  const [jobTitleFilter, setJobTitleFilter] = useState('');
  /**
   * Shifts held by "Copy Shifts", as day offsets from the copied week's
   * Monday. Storing offsets rather than absolute dates is what lets the same
   * clipboard paste into any week.
   */
  const [clipboard, setClipboard] = useState<CopiedShift[] | null>(null);
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const dates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const weekEnd = dates[6] ?? weekStart;

  /**
   * The columns the grid draws. Day view narrows the *display* only — the
   * week's rota stays loaded, so publishing and the coverage totals continue
   * to mean "this week".
   */
  const visibleDates = useMemo(() => {
    if (viewMode !== 'Day') return dates;
    const chosen = focusedDate && dates.includes(focusedDate) ? focusedDate : null;
    const today = format(new Date(), 'yyyy-MM-dd');
    return [chosen ?? (dates.includes(today) ? today : (dates[0] ?? weekStart))];
  }, [viewMode, focusedDate, dates, weekStart]);

  // Org-level data: locations, departments, staff, shift types.
  useEffect(() => {
    if (!orgId) return;
    setOrgDataLoading(true);
    setOrgDataFailed(false);
    void (async () => {
      try {
        const [locs, deptRows, staffRows, typeRows] = await Promise.all([
          listLocations(orgId),
          listDepartments(orgId),
          listActiveStaff(orgId),
          listShiftTypes(orgId),
        ]);
        setLocations(locs);
        setDepartments(deptRows);
        setStaff(staffRows);
        setShiftTypes(typeRows);
      } catch (err) {
        reportError(err, { area: 'rota:load-org-data' });
        setOrgDataFailed(true);
        showError('Could not load staff and locations. Check your connection and retry.');
      } finally {
        setOrgDataLoading(false);
      }
    })();
  }, [orgId, reloadKey, showError]);

  // Rota + shifts for every location, for the selected week — the builder
  // shows all locations at once (design/Rota-Builder.png), so every
  // location needs its own rota/shift fetch, not just the filtered one.
  useEffect(() => {
    if (!orgId || locations.length === 0) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const results = await Promise.all(
          locations.map(async (loc) => {
            const rota = await getOrCreateRotaForPeriod({
              orgId,
              name: `Week of ${weekStart}`,
              periodStart: weekStart,
              periodEnd: weekEnd,
              locationId: loc.id,
            });
            const rows = await listShiftsForRota(rota.id);
            return { locationId: loc.id, rota, shifts: rows };
          }),
        );
        if (!active) return;
        setRotasByLocation(new Map(results.map((r) => [r.locationId, r.rota])));
        setShifts(results.flatMap((r) => r.shifts));
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'rota:load-week' });
        setRotasByLocation(new Map());
        setShifts([]);
        showError('Could not load this week. Check your connection and retry.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, locations, weekStart, weekEnd, showError]);

  /**
   * Leave, availability and documents for the warning rules.
   *
   * Deliberately non-fatal: if this fails the grid still loads and the
   * shift-only rules (double-booked, rest, open shifts) still fire. Losing the
   * whole builder because a document lookup timed out would be the worse
   * trade.
   */
  useEffect(() => {
    if (!orgId) return;
    let active = true;
    void (async () => {
      try {
        const horizon = format(new Date(Date.now() + 90 * 86_400_000), 'yyyy-MM-dd');
        const [leaveRows, availabilityRows, documentRows] = await Promise.all([
          listOrgLeaveRequests(orgId),
          listOrgAvailability(orgId),
          listExpiringDocuments(orgId, horizon),
        ]);
        if (!active) return;
        setLeave(leaveRows);
        setAvailability(availabilityRows);
        setDocuments(documentRows);
      } catch (err) {
        reportError(err, { area: 'rota:load-warning-inputs' });
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, reloadKey]);

  const locationById = useMemo(
    () => new Map(locations.map((l) => [l.id, l])),
    [locations],
  );
  const staffById = useMemo(() => new Map(staff.map((s) => [s.id, s])), [staff]);

  const filteredLocations = useMemo(
    () =>
      locationFilter === 'all'
        ? locations
        : locations.filter((l) => l.id === locationFilter),
    [locations, locationFilter],
  );

  const shiftsInScope = useMemo(
    () => shifts.filter((s) => filteredLocations.some((l) => l.id === s.location_id)),
    [shifts, filteredLocations],
  );
  /**
   * The week's real problems — double-bookings, rest breaches, people rostered
   * on approved leave or against their availability, contract overruns and
   * unfilled shifts.
   *
   * Before this the Warnings tab ran `computeWarnings`, which counted unfilled
   * shifts and nothing else, so a rota with someone booked twice in one day
   * reported no warnings at all. This is the same engine the assistant uses,
   * so the tab, the assistant and the publish gate can no longer disagree.
   *
   * Computed from the shifts in *location* scope rather than the filtered view,
   * so it matches exactly what Publish would send out.
   */
  const warnings = useMemo(
    () =>
      computeRotaInsights({
        shifts: shiftsInScope,
        staff,
        shiftTypes,
        locations: filteredLocations,
        leave,
        availability,
        documents,
        timezone: DEFAULT_TZ,
        now: insightsNow,
      }),
    [
      shiftsInScope,
      staff,
      shiftTypes,
      filteredLocations,
      leave,
      availability,
      documents,
      insightsNow,
    ],
  );

  const criticalWarnings = useMemo(
    () => warnings.filter((w) => w.severity === 'critical'),
    [warnings],
  );

  /** Shifts named by at least one warning — powers the "needs attention" filter. */
  const problemShiftIds = useMemo(
    () =>
      new Set(warnings.map((w) => w.shiftId).filter((id): id is string => id !== null)),
    [warnings],
  );

  /**
   * Shifts the grid draws, after the view filters.
   *
   * Note this is downstream of the warnings, not upstream: filtering the view
   * must not silence a problem. Hiding a double-booking by ticking "open
   * shifts only" and then being allowed to publish is exactly the failure this
   * screen is meant to prevent.
   */
  const shiftsForDisplay = useMemo(() => {
    let rows =
      shiftTypeFilter === 'all'
        ? shiftsInScope
        : shiftsInScope.filter((s) => s.shift_type_id === shiftTypeFilter);
    if (assignmentFilter === 'open') rows = rows.filter((s) => !s.staff_profile_id);
    if (assignmentFilter === 'assigned') rows = rows.filter((s) => s.staff_profile_id);
    if (statusFilter !== 'all') rows = rows.filter((s) => s.status === statusFilter);
    if (problemsOnly) rows = rows.filter((s) => problemShiftIds.has(s.id));
    return rows;
  }, [
    shiftsInScope,
    shiftTypeFilter,
    assignmentFilter,
    statusFilter,
    problemsOnly,
    problemShiftIds,
  ]);

  /** Distinct job titles present in the roster, for the More filters dialog. */
  const jobTitles = useMemo(
    () =>
      [
        ...new Set(staff.map((s) => s.job_title).filter((t): t is string => Boolean(t))),
      ].sort((a, b) => a.localeCompare(b)),
    [staff],
  );

  const extraFilterCount =
    (assignmentFilter !== 'all' ? 1 : 0) +
    (statusFilter !== 'all' ? 1 : 0) +
    (problemsOnly ? 1 : 0) +
    (hideEmptyStaff ? 1 : 0) +
    (jobTitleFilter ? 1 : 0);

  const clearExtraFilters = (): void => {
    setJobTitleFilter('');
    setAssignmentFilter('all');
    setStatusFilter('all');
    setProblemsOnly(false);
    setHideEmptyStaff(false);
  };

  const staffFiltered = useMemo(() => {
    let rows = staff;
    if (departmentFilter !== 'all')
      rows = rows.filter((s) => s.department_id === departmentFilter);
    if (jobTitleFilter) rows = rows.filter((s) => s.job_title === jobTitleFilter);
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      rows = rows.filter((s) =>
        `${s.first_name} ${s.last_name}`.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [staff, departmentFilter, jobTitleFilter, search]);

  /**
   * Grouped by location. A single selected location shows its whole roster
   * (so a manager can schedule someone's first shift there); "All Locations"
   * groups by who is *actually rostered* this week — the same rule
   * ScheduleGrid uses, since staff_profiles has no location column and
   * showing everyone under every location would be fabricated, not derived.
   */
  const groups = useMemo<RotaGroup[]>(() => {
    if (locationFilter !== 'all') {
      const loc = filteredLocations[0];
      if (!loc) return [];
      // Showing the whole roster is deliberate — it is how you give someone
      // their first shift at a site. On a 30-person org that is a lot of empty
      // rows, so "Hide staff with no shifts this week" trims it back.
      if (!hideEmptyStaff) return [{ location: loc, staff: staffFiltered }];
      const rostered = new Set(
        shiftsForDisplay
          .map((s) => s.staff_profile_id)
          .filter((id): id is string => Boolean(id)),
      );
      return [{ location: loc, staff: staffFiltered.filter((p) => rostered.has(p.id)) }];
    }
    const rosteredByLocation = new Map<string, Set<string>>();
    for (const shift of shiftsForDisplay) {
      if (!shift.staff_profile_id || !shift.location_id) continue;
      const set = rosteredByLocation.get(shift.location_id) ?? new Set<string>();
      set.add(shift.staff_profile_id);
      rosteredByLocation.set(shift.location_id, set);
    }
    return filteredLocations
      .map((loc) => ({
        location: loc,
        staff: staffFiltered.filter((s) => rosteredByLocation.get(loc.id)?.has(s.id)),
      }))
      .filter((g) => g.staff.length > 0);
  }, [
    locationFilter,
    filteredLocations,
    staffFiltered,
    shiftsForDisplay,
    hideEmptyStaff,
  ]);

  const shiftMapByLocation = useMemo(() => {
    const map = new Map<string, Map<string, Shift[]>>();
    for (const loc of filteredLocations) {
      map.set(
        loc.id,
        buildShiftMap(
          shiftsForDisplay.filter((s) => s.location_id === loc.id),
          loc.timezone,
        ),
      );
    }
    return map;
  }, [filteredLocations, shiftsForDisplay]);

  const previewMap = useMemo(() => {
    const map = new Map<string, AiShiftSuggestion[]>();
    for (const s of previewSuggestions) {
      const key = shiftCellKey(s.staffProfileId, s.date);
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  }, [previewSuggestions]);

  const dailyTotals = useMemo(
    () => computeDailyTotals(shiftsForDisplay, dates, DEFAULT_TZ),
    [shiftsForDisplay, dates],
  );

  const totalStaff = useMemo(
    () => new Set(shiftsInScope.map((s) => s.staff_profile_id).filter(Boolean)).size,
    [shiftsInScope],
  );

  const selectedShift = shifts.find((s) => s.id === selectedShiftId) ?? null;

  const rotasInScope = filteredLocations
    .map((l) => rotasByLocation.get(l.id))
    .filter((r): r is Rota => Boolean(r));
  const draftRotasInScope = rotasInScope.filter((r) => r.status !== 'published');
  const allPublished = rotasInScope.length > 0 && draftRotasInScope.length === 0;
  const pendingShiftCount = shifts.filter((s) =>
    draftRotasInScope.some((r) => r.id === s.rota_id),
  ).length;

  const placeShift = useCallback(
    async (
      input: {
        staffProfileId: string | null;
        date: string;
        shiftTypeId: string | null;
        locationId: string;
        startTime: string;
        endTime: string;
        breakMinutes?: number;
        notes?: string | null;
      },
      /**
       * Shifts to check the new one against. Bulk callers pass their own
       * running list so shifts created earlier in the same loop still count.
       */
      against?: readonly Shift[],
    ): Promise<PlaceResult> => {
      if (!orgId) return { ok: false, reason: 'unavailable' };
      const location = locationById.get(input.locationId);
      const rota = rotasByLocation.get(input.locationId);
      if (!location || !rota) return { ok: false, reason: 'unavailable' };
      const { startsAt, endsAt } = computeShiftIsoRange(
        input.date,
        input.startTime,
        input.endTime,
        location.timezone,
      );

      // NEW_STRUCTURE §41: never silently allow an invalid assignment. One
      // person cannot be in two places at once, so an overlapping shift is
      // refused outright rather than written and warned about afterwards.
      const clash = findClashingShift(
        { staffProfileId: input.staffProfileId, startsAt, endsAt },
        against ?? shiftsRef.current,
      );
      if (clash) return { ok: false, reason: 'clash', clash };

      const created = await createShift({
        org_id: orgId,
        rota_id: rota.id,
        location_id: location.id,
        staff_profile_id: input.staffProfileId,
        shift_type_id: input.shiftTypeId,
        starts_at: startsAt,
        ends_at: endsAt,
        break_minutes: input.breakMinutes ?? 0,
        status: 'assigned',
        notes: input.notes ?? null,
      });
      setShifts((prev) => [...prev, created]);
      setLastSavedAt(new Date());
      return { ok: true, shift: created };
    },
    [orgId, locationById, rotasByLocation],
  );

  /** Plain-English "who is already on what", for the refusal toast. */
  const describeClash = useCallback(
    (clash: Shift): string => {
      const location = clash.location_id ? locationById.get(clash.location_id) : null;
      const timezone = location?.timezone ?? DEFAULT_TZ;
      const { date, time: start } = fromIsoInTimezone(clash.starts_at, timezone);
      const { time: end } = fromIsoInTimezone(clash.ends_at, timezone);
      const person = clash.staff_profile_id
        ? staffById.get(clash.staff_profile_id)
        : null;
      const who = person ? `${person.first_name} ${person.last_name}` : 'That person';
      const day = new Date(`${date}T00:00:00`).toLocaleDateString('en-GB', {
        weekday: 'short',
        day: 'numeric',
        month: 'short',
      });
      return `${who} is already rostered ${start}–${end} on ${day}.`;
    },
    [locationById, staffById],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const { active, over } = event;
      if (!over) return;
      const cellLocationId = (over.data.current as { locationId?: string } | undefined)
        ?.locationId;
      const cellDate = (over.data.current as { date?: string } | undefined)?.date;
      const cellStaffProfileId = (
        over.data.current as { staffProfileId?: string | null } | undefined
      )?.staffProfileId;
      if (!cellLocationId || !cellDate) return;
      const location = locationById.get(cellLocationId);
      if (!location) return;
      const activeId = String(active.id);

      if (activeId.startsWith('palette:')) {
        const shiftTypeId = activeId.slice('palette:'.length);
        const type = shiftTypes.find((t) => t.id === shiftTypeId);
        void placeShift({
          staffProfileId: cellStaffProfileId ?? null,
          date: cellDate,
          shiftTypeId,
          locationId: cellLocationId,
          startTime: type?.default_start?.slice(0, 5) ?? '09:00',
          endTime: type?.default_end?.slice(0, 5) ?? '17:00',
        })
          .then((result) => {
            if (!result.ok && result.reason === 'clash') {
              showError(`Not added — ${describeClash(result.clash)}`);
            }
          })
          .catch((err) => {
            reportError(err, { area: 'rota:drag-create' });
            showError('Could not add that shift. Please try again.');
          });
        return;
      }

      if (activeId.startsWith('shift:')) {
        const shiftId = activeId.slice('shift:'.length);
        const shift = shifts.find((s) => s.id === shiftId);
        if (!shift) return;
        const { time: startTime } = fromIsoInTimezone(shift.starts_at, location.timezone);
        const { time: endTime } = fromIsoInTimezone(shift.ends_at, location.timezone);
        const { startsAt, endsAt } = computeShiftIsoRange(
          cellDate,
          startTime,
          endTime,
          location.timezone,
        );

        // Dragging a shift onto someone who is already working that window is
        // the same double-booking as creating one there, so it is refused the
        // same way — the shift stays where it was.
        const moveClash = findClashingShift(
          { staffProfileId: cellStaffProfileId ?? null, startsAt, endsAt },
          shiftsRef.current,
          { ignoreShiftId: shiftId },
        );
        if (moveClash) {
          showError(`Not moved — ${describeClash(moveClash)}`);
          return;
        }

        void updateShift(shiftId, {
          staff_profile_id: cellStaffProfileId ?? null,
          starts_at: startsAt,
          ends_at: endsAt,
        })
          .then((updated) => {
            setShifts((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
            setLastSavedAt(new Date());
          })
          .catch((err) => {
            reportError(err, { area: 'rota:drag-reassign' });
            showError('Could not move that shift. It has been left where it was.');
          });
      }
    },
    [locationById, shiftTypes, shifts, placeShift, showError, describeClash],
  );

  const handleModalSave = async (values: AssignShiftFormValues): Promise<void> => {
    const locationId = assignModal.shift?.location_id ?? assignModal.context?.locationId;
    const location = locationId ? locationById.get(locationId) : null;
    if (!location) return;
    const { startsAt, endsAt } = computeShiftIsoRange(
      values.date,
      values.startTime,
      values.endTime,
      location.timezone,
    );
    if (assignModal.shift) {
      const editClash = findClashingShift(
        { staffProfileId: values.staffProfileId, startsAt, endsAt },
        shiftsRef.current,
        { ignoreShiftId: assignModal.shift.id },
      );
      if (editClash) {
        throw new ShiftClashError(describeClash(editClash), editClash);
      }
      const updated = await updateShift(assignModal.shift.id, {
        staff_profile_id: values.staffProfileId,
        shift_type_id: values.shiftTypeId,
        starts_at: startsAt,
        ends_at: endsAt,
        break_minutes: Number(values.breakMinutes) || 0,
        notes: values.notes || null,
      });
      setShifts((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } else {
      const result = await placeShift({
        staffProfileId: values.staffProfileId,
        date: values.date,
        shiftTypeId: values.shiftTypeId,
        locationId: location.id,
        startTime: values.startTime,
        endTime: values.endTime,
        breakMinutes: Number(values.breakMinutes) || 0,
        notes: values.notes || null,
      });
      if (!result.ok && result.reason === 'clash') {
        throw new ShiftClashError(describeClash(result.clash), result.clash);
      }
    }
    setLastSavedAt(new Date());
  };

  const handleModalDelete = async (shiftId: string): Promise<void> => {
    await deleteShift(shiftId);
    setShifts((prev) => prev.filter((s) => s.id !== shiftId));
    if (selectedShiftId === shiftId) setSelectedShiftId(null);
    setLastSavedAt(new Date());
  };

  const handleDuplicateShift = useCallback(
    (shift: Shift): void => {
      if (!orgId) return;
      // A copy of an assigned shift is the same person in the same hours —
      // always a double-booking. Duplicating is still useful, though: it is
      // how a manager adds a second slot on a busy shift. So the copy is made
      // open, and the toast says so rather than quietly changing the meaning.
      const assigned = shift.staff_profile_id !== null;
      void createShift({
        org_id: orgId,
        rota_id: shift.rota_id,
        location_id: shift.location_id,
        department_id: shift.department_id,
        staff_profile_id: null,
        shift_type_id: shift.shift_type_id,
        starts_at: shift.starts_at,
        ends_at: shift.ends_at,
        break_minutes: shift.break_minutes,
        status: 'open',
        notes: shift.notes,
      })
        .then((created) => {
          setShifts((prev) => [...prev, created]);
          setSelectedShiftId(created.id);
          setLastSavedAt(new Date());
          showSuccess(
            assigned
              ? 'Duplicated as an open shift — one person cannot work the same hours twice. Assign someone to cover it.'
              : 'Shift duplicated.',
          );
        })
        .catch((err) => {
          reportError(err, { area: 'rota:duplicate-shift' });
          showError('Could not duplicate that shift.');
        });
    },
    [orgId, showError, showSuccess],
  );

  const handleDeleteSelectedShift = useCallback(
    (shift: Shift): void => {
      void deleteShift(shift.id)
        .then(() => {
          setShifts((prev) => prev.filter((s) => s.id !== shift.id));
          setSelectedShiftId(null);
          setLastSavedAt(new Date());
        })
        .catch((err) => {
          reportError(err, { area: 'rota:delete-shift' });
          showError('Could not delete that shift.');
        });
    },
    [showError],
  );

  /**
   * Delete straight from the chip's ×.
   *
   * Confirmed, because §1 requires it of every destructive action and because
   * this control now sits *on* the shift rather than behind a panel — the
   * distance that used to make an accidental delete unlikely is gone by design,
   * so the guard has to replace it.
   *
   * The prompt names the person and the time, since on a full grid the × you
   * pressed and the shift you meant are one row apart.
   */
  const handleDeleteShiftFromChip = useCallback(
    (shift: Shift): void => {
      const person = shift.staff_profile_id
        ? staffById.get(shift.staff_profile_id)
        : null;
      const location = shift.location_id ? locationById.get(shift.location_id) : null;
      const { date, time: startTime } = fromIsoInTimezone(
        shift.starts_at,
        location?.timezone ?? DEFAULT_TZ,
      );
      const { time: endTime } = fromIsoInTimezone(
        shift.ends_at,
        location?.timezone ?? DEFAULT_TZ,
      );
      const who = person ? `${person.first_name} ${person.last_name}` : 'the open slot';
      const when = format(new Date(`${date}T00:00:00`), 'EEEE d MMM');

      void (async () => {
        const ok = await confirm({
          title: 'Remove this shift?',
          message: `${startTime}–${endTime} on ${when} for ${who} will be deleted. This cannot be undone.`,
          confirmLabel: 'Remove shift',
          tone: 'danger',
        });
        if (!ok) return;
        handleDeleteSelectedShift(shift);
      })();
    },
    [staffById, locationById, confirm, handleDeleteSelectedShift],
  );

  const handlePublish = async (): Promise<void> => {
    if (draftRotasInScope.length === 0 || !orgId) return;

    // §41: a critical issue "cannot publish without resolution". Publishing is
    // what tells staff the week is real, so sending out a rota that has
    // somebody in two places at once — or working through approved leave — is
    // the one thing worth stopping outright rather than warning about.
    if (criticalWarnings.length > 0) {
      const [first] = criticalWarnings;
      setPublishError(
        `${criticalWarnings.length} critical ${criticalWarnings.length === 1 ? 'issue' : 'issues'} must be resolved before publishing — ${first?.title ?? ''}. See the Warnings tab.`,
      );
      return;
    }

    setPublishing(true);
    setPublishError(null);
    try {
      const updated = await Promise.all(draftRotasInScope.map((r) => publishRota(r.id)));
      setRotasByLocation((prev) => {
        const next = new Map(prev);
        for (const rota of updated) next.set(rota.location_id ?? '', rota);
        return next;
      });
      showSuccess('Rota published. Staff can now see this week.');

      const recipientUserIds = [
        ...new Set(
          shifts
            .map((s) =>
              s.staff_profile_id ? staffById.get(s.staff_profile_id)?.user_id : null,
            )
            .filter((id): id is string => Boolean(id)),
        ),
      ];
      if (recipientUserIds.length > 0) {
        void send('rota/published', {
          orgId,
          userIds: recipientUserIds,
          type: 'rota',
          title: `${formatWeekRange(dates)} published`,
        });
      }
    } catch (err) {
      reportError(err, { area: 'rota:publish' });
      setPublishError('Could not publish this rota. Please try again.');
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async (): Promise<void> => {
    const publishedRotas = rotasInScope.filter((r) => r.status === 'published');
    if (publishedRotas.length === 0) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const updated = await Promise.all(publishedRotas.map((r) => unpublishRota(r.id)));
      setRotasByLocation((prev) => {
        const next = new Map(prev);
        for (const rota of updated) next.set(rota.location_id ?? '', rota);
        return next;
      });
      showSuccess('Rota returned to draft. Re-publish when your changes are ready.');
    } catch (err) {
      reportError(err, { area: 'rota:unpublish' });
      const conflict = (err as { code?: string } | null)?.code === '23505';
      setPublishError(
        conflict
          ? 'A separate draft already exists for this week, so this rota cannot be unpublished. Contact support to merge them.'
          : 'Could not unpublish this rota. Please try again.',
      );
    } finally {
      setPublishing(false);
    }
  };

  /**
   * Copy every shift currently in scope onto the clipboard.
   *
   * Reads `shiftsForDisplay`, so the location, department and shift-type
   * filters above the grid decide what is copied. Copying rows the manager
   * has filtered out would paste work they cannot see.
   */
  const handleCopyShifts = useCallback((): void => {
    if (shiftsForDisplay.length === 0) {
      showError('There are no shifts in view to copy.');
      return;
    }
    const copied: CopiedShift[] = [];
    for (const shift of shiftsForDisplay) {
      const location = shift.location_id ? locationById.get(shift.location_id) : null;
      if (!location) continue;
      const { date, time: startTime } = fromIsoInTimezone(
        shift.starts_at,
        location.timezone,
      );
      const { time: endTime } = fromIsoInTimezone(shift.ends_at, location.timezone);
      const dayOffset = dates.indexOf(date);
      if (dayOffset < 0) continue;
      copied.push({
        dayOffset,
        staffProfileId: shift.staff_profile_id,
        shiftTypeId: shift.shift_type_id,
        locationId: location.id,
        startTime,
        endTime,
        breakMinutes: shift.break_minutes,
        notes: shift.notes,
      });
    }
    setClipboard(copied);
    showSuccess(
      `${copied.length} ${copied.length === 1 ? 'shift' : 'shifts'} copied. Move to another week and choose Paste Shifts.`,
    );
  }, [shiftsForDisplay, locationById, dates, showError, showSuccess]);

  const pasteShifts = useCallback(
    async (source: CopiedShift[], label: string): Promise<void> => {
      setBusyAction(label);
      try {
        // Sequential on purpose. Each createShift is a separate round trip and
        // a whole week can be 50+ rows; firing them all at once is how you
        // trip Supabase's rate limiter halfway through and leave a rota
        // half-pasted with no record of where it stopped.
        let created = 0;
        let skipped = 0;
        // Running list, so a shift written on one pass is visible to the next.
        // Without it a paste can only see the week as it was before the loop
        // began, and duplicates inside the same batch slip through.
        const working: Shift[] = [...shiftsRef.current];
        for (const item of source) {
          const date = dates[item.dayOffset];
          if (!date) continue;
          const result = await placeShift(
            {
              staffProfileId: item.staffProfileId,
              date,
              shiftTypeId: item.shiftTypeId,
              locationId: item.locationId,
              startTime: item.startTime,
              endTime: item.endTime,
              breakMinutes: item.breakMinutes,
              notes: item.notes,
            },
            working,
          );
          if (result.ok) {
            working.push(result.shift);
            created += 1;
          } else if (result.reason === 'clash') {
            skipped += 1;
          }
        }
        // Saying what was skipped matters more than the success count: a paste
        // that silently dropped half its rows looks identical to one that
        // worked, and that is how the rota quietly drifts from what a manager
        // thinks they built.
        const summary = `${created} ${created === 1 ? 'shift' : 'shifts'} added to ${formatWeekRange(dates)}.`;
        if (skipped > 0) {
          showSuccess(
            `${summary} ${skipped} skipped — ${skipped === 1 ? 'that person was' : 'those people were'} already rostered at the same time.`,
          );
        } else {
          showSuccess(summary);
        }
      } catch (err) {
        reportError(err, { area: 'rota:paste-shifts' });
        showError(
          'Could not paste every shift. The ones already added have been kept — check the grid before retrying.',
        );
      } finally {
        setBusyAction(null);
      }
    },
    [dates, placeShift, showError, showSuccess],
  );

  const handlePasteShifts = useCallback((): void => {
    if (!clipboard || clipboard.length === 0) {
      showError('Nothing is copied yet. Use Copy Shifts on a week first.');
      return;
    }
    void pasteShifts(clipboard, 'paste');
  }, [clipboard, pasteShifts, showError]);

  /**
   * Copy the previous week's shifts into this one (§8 "Copy previous week").
   *
   * Fetches that week's rotas rather than reusing whatever is in state, since
   * only the visible week is ever loaded.
   */
  const handleCopyPreviousWeek = useCallback((): void => {
    if (!orgId) return;
    setBusyAction('previous-week');
    void (async () => {
      try {
        const previousStart = getMonday(
          new Date(new Date(weekStart).setDate(new Date(weekStart).getDate() - 7)),
        );
        const previousDates = getWeekDates(previousStart);
        const previousEnd = previousDates[6] ?? previousStart;

        const collected: CopiedShift[] = [];
        for (const location of filteredLocations) {
          const rota = await getOrCreateRotaForPeriod({
            orgId,
            name: `Week of ${previousStart}`,
            periodStart: previousStart,
            periodEnd: previousEnd,
            locationId: location.id,
          });
          const rows = await listShiftsForRota(rota.id);
          for (const shift of rows) {
            const { date, time: startTime } = fromIsoInTimezone(
              shift.starts_at,
              location.timezone,
            );
            const { time: endTime } = fromIsoInTimezone(shift.ends_at, location.timezone);
            const dayOffset = previousDates.indexOf(date);
            if (dayOffset < 0) continue;
            collected.push({
              dayOffset,
              staffProfileId: shift.staff_profile_id,
              shiftTypeId: shift.shift_type_id,
              locationId: location.id,
              startTime,
              endTime,
              breakMinutes: shift.break_minutes,
              notes: shift.notes,
            });
          }
        }

        if (collected.length === 0) {
          showError('The previous week has no shifts to copy.');
          setBusyAction(null);
          return;
        }
        await pasteShifts(collected, 'previous-week');
      } catch (err) {
        reportError(err, { area: 'rota:copy-previous-week' });
        showError('Could not read the previous week. Please try again.');
        setBusyAction(null);
      }
    })();
  }, [orgId, weekStart, filteredLocations, pasteShifts, showError]);

  /**
   * Delete every DRAFT shift in scope (§8 "Clear rota").
   *
   * Published shifts are skipped deliberately: staff have already been told
   * they are working them, and a bulk clear must not silently unschedule
   * somebody's Saturday. Unpublish first if that is genuinely the intent.
   */
  const handleClearShifts = useCallback((): void => {
    const draftShiftIds = shiftsForDisplay
      .filter((s) => draftRotasInScope.some((r) => r.id === s.rota_id))
      .map((s) => s.id);

    if (draftShiftIds.length === 0) {
      showError(
        'There are no draft shifts in view to clear. Published shifts are left alone — unpublish the rota first.',
      );
      return;
    }

    void (async () => {
      const ok = await confirm({
        title: 'Clear these shifts?',
        message: `This permanently deletes ${draftShiftIds.length} draft ${
          draftShiftIds.length === 1 ? 'shift' : 'shifts'
        } from ${formatWeekRange(dates)}. Published shifts are not touched. This cannot be undone.`,
        confirmLabel: 'Delete shifts',
        tone: 'danger',
      });
      if (!ok) return;

      setBusyAction('clear');
      try {
        for (const id of draftShiftIds) await deleteShift(id);
        setShifts((prev) => prev.filter((s) => !draftShiftIds.includes(s.id)));
        setSelectedShiftId(null);
        setLastSavedAt(new Date());
        showSuccess(`${draftShiftIds.length} draft shifts deleted.`);
      } catch (err) {
        reportError(err, { area: 'rota:clear-shifts' });
        showError('Could not delete every shift. Reload to see what remains.');
      } finally {
        setBusyAction(null);
      }
    })();
  }, [shiftsForDisplay, draftRotasInScope, dates, confirm, showError, showSuccess]);

  /** Fill an open shift from the assistant's ranked suggestions. */
  const handleAssistantAssign = useCallback(
    async (shiftId: string, staffProfileId: string): Promise<void> => {
      try {
        const target = shiftsRef.current.find((s) => s.id === shiftId);
        if (target) {
          const clash = findClashingShift(
            {
              staffProfileId,
              startsAt: target.starts_at,
              endsAt: target.ends_at,
            },
            shiftsRef.current,
            { ignoreShiftId: shiftId },
          );
          if (clash) {
            showError(`Not assigned — ${describeClash(clash)}`);
            return;
          }
        }
        const updated = await updateShift(shiftId, {
          staff_profile_id: staffProfileId,
          status: 'assigned',
        });
        setShifts((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
        setLastSavedAt(new Date());
        showSuccess('Shift assigned.');
      } catch (err) {
        reportError(err, { area: 'rota:assistant-assign' });
        showError('Could not assign that shift. Please try again.');
      }
    },
    [showError, showSuccess, describeClash],
  );

  const reloadShifts = (): void => {
    void Promise.all([...rotasByLocation.values()].map((r) => listShiftsForRota(r.id)))
      .then((rows) => setShifts(rows.flat()))
      .catch((err) => {
        reportError(err, { area: 'rota:reload-shifts' });
        showError(
          'Could not refresh the grid. Reload the page to see the latest shifts.',
        );
      });
  };

  const autoFillLocation =
    locationFilter !== 'all' ? (locationById.get(locationFilter) ?? null) : null;
  const autoFillRota = autoFillLocation ? rotasByLocation.get(autoFillLocation.id) : null;

  const handleAutoFillClick = (): void => {
    if (!autoFillLocation || !autoFillRota) {
      showError('Select a single location above to auto-fill its rota.');
      return;
    }
    setAutoFillOpen(true);
  };

  // Belt and braces behind the route's own `RequireRole` gate — see the
  // equivalent note in ReportsPage.
  if (!canBuildRota) {
    return <PermissionDenied area="the rota builder" allowed={['owner', 'manager']} />;
  }

  if (orgDataFailed && !orgDataLoading) {
    return (
      <Card>
        <p className="mb-4 text-content-muted dark:text-content-muted-dark">
          Could not load this organisation&rsquo;s staff and locations. This is a
          connection problem, not an empty organisation — nothing has been lost.
        </p>
        <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
          Retry
        </Button>
      </Card>
    );
  }

  if (locations.length === 0 && !orgDataLoading) {
    return (
      <Card>
        <p className="text-content-muted dark:text-content-muted-dark">
          Add a location before building a rota — see the Locations page.
        </p>
      </Card>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div>
        {/* ---- Page header ---- */}
        <WorkspaceHeader
          title="Rota"
          subtitle="Build fair, balanced rotas in minutes, then publish them to your team."
          tabs={rotaWorkspaceTabs(role)}
          actions={
            <div className="relative">
              <Search
                size={16}
                aria-hidden="true"
                className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-content-muted"
              />
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search staff, skills, shifts…"
                className="w-80 rounded-xl border border-surface-border bg-surface py-2.5 pl-10 pr-16 text-sm text-content outline-none focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark dark:bg-surface-dark dark:text-content-dark"
              />
              <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded-md border border-surface-border px-1.5 py-0.5 font-sans text-[0.65rem] font-medium text-content-muted dark:border-surface-border-dark dark:text-content-muted-dark">
                ⌘ K
              </kbd>
            </div>
          }
        />

        {/* ---- Toolbar: date nav, view tabs, settings, publish ---- */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <button
              type="button"
              onClick={() =>
                setWeekStart((d) =>
                  getMonday(new Date(new Date(d).setDate(new Date(d).getDate() - 7))),
                )
              }
              aria-label="Previous week"
              className="rounded-lg border border-surface-border p-1.5 text-content-muted hover:text-content dark:border-surface-border-dark dark:text-content-muted-dark"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() =>
                setWeekStart((d) =>
                  getMonday(new Date(new Date(d).setDate(new Date(d).getDate() + 7))),
                )
              }
              aria-label="Next week"
              className="rounded-lg border border-surface-border p-1.5 text-content-muted hover:text-content dark:border-surface-border-dark dark:text-content-muted-dark"
            >
              <ChevronRight size={16} />
            </button>
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setWeekStart(getMonday(new Date()))}
            >
              Today
            </Button>
            <span className="text-sm font-semibold text-content dark:text-content-dark">
              {formatWeekRange(dates)}
            </span>
            {/* Day view needs a way to say *which* day. In week view the grid
                shows all seven, so the control would have nothing to do. */}
            {viewMode === 'Day' && (
              <Select
                className="w-auto py-1.5"
                aria-label="Day to show"
                value={visibleDates[0] ?? ''}
                onChange={(e) => setFocusedDate(e.target.value)}
              >
                {dates.map((date) => (
                  <option key={date} value={date}>
                    {format(new Date(`${date}T00:00:00`), 'EEEE d MMM')}
                  </option>
                ))}
              </Select>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <div
              role="group"
              aria-label="View"
              className="flex rounded-xl border border-surface-border p-1 dark:border-surface-border-dark"
            >
              {VIEW_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  aria-pressed={viewMode === tab}
                  onClick={() => setViewMode(tab)}
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm font-medium',
                    viewMode === tab
                      ? 'bg-primary text-white'
                      : 'text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark',
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={() => setShiftTypeModalOpen(true)}
              aria-label="Manage shift types"
              className="rounded-xl border border-surface-border p-2 text-content-muted hover:text-content dark:border-surface-border-dark dark:text-content-muted-dark"
            >
              <Settings2 size={16} />
            </button>

            <div className="relative flex">
              {allPublished ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => void handleUnpublish()}
                  disabled={publishing || rotasInScope.length === 0}
                >
                  {publishing ? 'Updating…' : 'Unpublish'}
                </Button>
              ) : (
                <Button
                  size="sm"
                  className="rounded-r-none"
                  onClick={() => void handlePublish()}
                  disabled={publishing || pendingShiftCount === 0}
                  title={
                    pendingShiftCount === 0
                      ? 'Add at least one shift before publishing'
                      : undefined
                  }
                >
                  {publishing ? 'Publishing…' : `Publish (${pendingShiftCount} changes)`}
                </Button>
              )}
              {!allPublished && (
                <button
                  type="button"
                  aria-label="Publish options"
                  onClick={() => setPublishMenuOpen((v) => !v)}
                  className="rounded-r-xl border-l border-primary-fg/20 bg-primary px-2 text-primary-fg hover:bg-primary/90"
                >
                  <ChevronDown size={14} />
                </button>
              )}
              {publishMenuOpen && (
                <div className="absolute right-0 top-full z-10 mt-1 w-56 rounded-xl border border-surface-border bg-surface p-1 shadow-lg dark:border-surface-border-dark dark:bg-surface-dark">
                  <button
                    type="button"
                    onClick={() => {
                      setPublishMenuOpen(false);
                      void handleUnpublish();
                    }}
                    disabled={rotasInScope.every((r) => r.status !== 'published')}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-content hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                  >
                    Unpublish current rota
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {publishError && (
          <p className="mb-4 text-sm text-danger" role="alert">
            {publishError}
          </p>
        )}

        {/* ---- Filters row ---- */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Select
            className="w-auto py-2"
            value={locationFilter}
            onChange={(e) => setLocationFilter(e.target.value)}
          >
            <option value="all">All Locations</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </Select>
          <Select
            className="w-auto py-2"
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
          >
            <option value="all">All Departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
          <Select
            className="w-auto py-2"
            value={shiftTypeFilter}
            onChange={(e) => setShiftTypeFilter(e.target.value)}
          >
            <option value="all">All Shift Types</option>
            {shiftTypes.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </Select>
          <button
            type="button"
            onClick={() => setMoreFiltersOpen(true)}
            className="flex items-center gap-1 rounded-xl border border-surface-border px-3 py-2 text-sm text-content hover:bg-surface-subtle dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
          >
            More filters
            {extraFilterCount > 0 && (
              <span className="ml-0.5 rounded-full bg-primary px-1.5 text-xs font-semibold text-primary-fg">
                {extraFilterCount}
              </span>
            )}
            <ChevronDown size={14} aria-hidden="true" />
          </button>

          <Button
            size="sm"
            className="ml-auto bg-success/10 text-success hover:bg-success/15"
            onClick={handleAutoFillClick}
          >
            <Sparkles size={14} aria-hidden="true" />
            Auto-assign
          </Button>

          {/* The reference collapses the per-shift actions behind one
              "Actions" menu; Add Shift and shift-type management live here
              rather than as separate toolbar buttons. */}
          <div className="relative">
            <Button
              size="sm"
              variant="secondary"
              aria-haspopup="menu"
              aria-expanded={actionsMenuOpen}
              onClick={() => setActionsMenuOpen((v) => !v)}
            >
              Actions
              <ChevronDown size={14} aria-hidden="true" />
            </Button>
            {actionsMenuOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full z-10 mt-1 w-52 rounded-xl border border-surface-border bg-surface p-1 shadow-lg dark:border-surface-border-dark dark:bg-surface-dark"
              >
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActionsMenuOpen(false);
                    const loc = filteredLocations[0] ?? locations[0];
                    if (!loc) return;
                    setAssignModal({
                      open: true,
                      context: {
                        staffProfileId: null,
                        date: dates[0] ?? weekStart,
                        locationId: loc.id,
                      },
                      shift: null,
                    });
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-content hover:bg-surface-subtle dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                >
                  <Plus size={14} aria-hidden="true" />
                  Add shift
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActionsMenuOpen(false);
                    setShiftTypeModalOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-content hover:bg-surface-subtle dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                >
                  <Settings2 size={14} aria-hidden="true" />
                  Manage shift types
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ---- Main: grid | inspector | action rail ---- */}
        {loading || orgDataLoading ? (
          <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
        ) : (
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start">
            <Card className="grid min-w-0 flex-1 grid-cols-1 gap-0 overflow-hidden p-0 xl:grid-cols-[minmax(0,1fr)_19rem]">
              <div className="overflow-x-auto border-b border-surface-border p-5 xl:border-b-0 xl:border-r dark:border-surface-border-dark">
                {groups.length === 0 ? (
                  <p className="text-content-muted dark:text-content-muted-dark">
                    No staff rostered for this filter yet. Select a single location above
                    to see its full team.
                  </p>
                ) : (
                  <RotaGrid
                    dates={visibleDates}
                    groups={groups}
                    totalStaff={totalStaff}
                    totalShifts={shiftsInScope.length}
                    shiftMapByLocation={shiftMapByLocation}
                    shiftTypes={shiftTypes}
                    previewMap={previewMap}
                    dailyTotals={dailyTotals}
                    selectedShiftId={selectedShiftId}
                    onAddShift={(staffProfileId, date, locationId) =>
                      setAssignModal({
                        open: true,
                        context: { staffProfileId, date, locationId },
                        shift: null,
                      })
                    }
                    onSelectShift={(shift) => setSelectedShiftId(shift.id)}
                    onDeleteShift={handleDeleteShiftFromChip}
                  />
                )}
              </div>

              <div className="p-4">
                <ShiftInspectorPanel
                  selectedShift={selectedShift}
                  shifts={shifts}
                  staff={staff}
                  shiftTypes={shiftTypes}
                  locations={locations}
                  dailyTotals={dailyTotals}
                  warnings={warnings}
                  timezone={DEFAULT_TZ}
                  rotaStatusForLocation={(locationId) =>
                    (locationId ? rotasByLocation.get(locationId)?.status : null) as
                      'draft' | 'published' | null
                  }
                  onEdit={(shift) => setAssignModal({ open: true, context: null, shift })}
                  onDuplicate={handleDuplicateShift}
                  onDelete={handleDeleteSelectedShift}
                  onSelectShiftId={setSelectedShiftId}
                />
              </div>
            </Card>

            {/* The rail is its own card in the reference, not a third column
              inside the grid card. */}
            <Card className="shrink-0 p-2 xl:w-[5.5rem]">
              <RotaActionRail
                onTemplates={() => setShiftTypeModalOpen(true)}
                onCopyShifts={handleCopyShifts}
                onPasteShifts={handlePasteShifts}
                onCopyPreviousWeek={handleCopyPreviousWeek}
                onAutoFill={handleAutoFillClick}
                onClearShifts={handleClearShifts}
                onPrint={() => window.print()}
                clipboardCount={clipboard?.length ?? 0}
                busyAction={busyAction}
              />
            </Card>
          </div>
        )}

        {/* ---- Status bar ---- */}
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
          <span className="flex items-center gap-1.5 text-content-muted dark:text-content-muted-dark">
            <CalendarCheck size={14} aria-hidden="true" className="text-success" />
            {lastSavedAt
              ? `All changes saved · Last saved ${format(lastSavedAt, 'HH:mm')}`
              : 'All changes saved'}
          </span>
          {/* Only the three states the grid can actually render. The
              reference also lists "Overstaffed", but no required-headcount
              column exists to compute it — see design/.loop/rota-log.md. */}
          <div className="flex flex-wrap items-center gap-5 text-xs text-content-muted dark:text-content-muted-dark">
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-success" /> Optimal
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-danger" /> Understaffed
            </span>
            <span className="flex items-center gap-1.5">
              <span className="h-2 w-2 rounded-full bg-warning" /> Unpublished
            </span>
          </div>
        </div>
      </div>

      <AssignShiftModal
        open={assignModal.open}
        onClose={() => setAssignModal({ open: false, context: null, shift: null })}
        staff={staff}
        shiftTypes={shiftTypes}
        dates={dates}
        timezone={
          (assignModal.shift?.location_id
            ? locationById.get(assignModal.shift.location_id)?.timezone
            : assignModal.context
              ? locationById.get(assignModal.context.locationId)?.timezone
              : undefined) ?? DEFAULT_TZ
        }
        context={assignModal.context}
        shift={assignModal.shift}
        onSave={handleModalSave}
        onDelete={handleModalDelete}
      />

      <Modal
        open={moreFiltersOpen}
        onClose={() => setMoreFiltersOpen(false)}
        title="More filters"
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="rota-job-title">Job title</Label>
            <Select
              id="rota-job-title"
              value={jobTitleFilter}
              onChange={(e) => setJobTitleFilter(e.target.value)}
            >
              <option value="">All job titles</option>
              {jobTitles.map((title) => (
                <option key={title} value={title}>
                  {title}
                </option>
              ))}
            </Select>
            <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
              Narrows the staff rows, so you can build one role&rsquo;s cover without the
              rest of the roster in the way.
            </p>
          </div>
          <div>
            <Label htmlFor="rota-assignment">Assignment</Label>
            <Select
              id="rota-assignment"
              value={assignmentFilter}
              onChange={(e) =>
                setAssignmentFilter(e.target.value as 'all' | 'open' | 'assigned')
              }
            >
              <option value="all">All shifts</option>
              <option value="open">Only open shifts (nobody assigned)</option>
              <option value="assigned">Only shifts with someone on them</option>
            </Select>
            <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
              Open shifts are the ones still needing cover.
            </p>
          </div>

          <div>
            <Label htmlFor="rota-status">Shift status</Label>
            <Select
              id="rota-status"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
            >
              <option value="all">Any status</option>
              <option value="open">Open</option>
              <option value="assigned">Assigned</option>
              <option value="confirmed">Confirmed</option>
              <option value="cancelled">Cancelled</option>
            </Select>
          </div>

          <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm text-content dark:text-content-dark">
            <input
              type="checkbox"
              checked={problemsOnly}
              onChange={(e) => setProblemsOnly(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-surface-border text-primary focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
            />
            <span>
              Only show shifts that need attention
              <span className="block text-xs text-content-muted dark:text-content-muted-dark">
                Double-bookings, rest breaches, leave clashes and unfilled cover —
                everything on the Warnings tab.
              </span>
            </span>
          </label>

          <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm text-content dark:text-content-dark">
            <input
              type="checkbox"
              checked={hideEmptyStaff}
              onChange={(e) => setHideEmptyStaff(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-surface-border text-primary focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
            />
            <span>
              Hide staff with no shifts this week
              <span className="block text-xs text-content-muted dark:text-content-muted-dark">
                Shortens the grid to the people actually working.
              </span>
            </span>
          </label>

          <div className="flex justify-end gap-2">
            <Button
              variant="secondary"
              disabled={extraFilterCount === 0}
              onClick={clearExtraFilters}
            >
              Clear
            </Button>
            <Button onClick={() => setMoreFiltersOpen(false)}>Done</Button>
          </div>
        </div>
      </Modal>

      {orgId && (
        <ShiftTypeManagerModal
          open={shiftTypeModalOpen}
          onClose={() => setShiftTypeModalOpen(false)}
          orgId={orgId}
          shiftTypes={shiftTypes}
          onChange={setShiftTypes}
        />
      )}

      {/*
        `AutoFillPanel` was replaced by `RotaAssistantPanel` in the demo branch:
        the assistant reviews the rota and ranks candidates for a specific open
        shift, rather than only generating a whole draft.

        Note the gating difference. Auto-fill needed a single location up front,
        because it WRITES a draft into one rota. The assistant's Review and
        Fill-gaps tabs read across every location on screen, so the panel opens
        regardless and `applyTarget` is null until one location is selected —
        which is what stops a generated draft from silently rostering people at
        the wrong site.
      */}
      {orgId && (
        <RotaAssistantPanel
          open={autoFillOpen}
          onClose={() => setAutoFillOpen(false)}
          orgId={orgId}
          shifts={shiftsForDisplay}
          staff={staff}
          shiftTypes={shiftTypes}
          locations={locations}
          weekStart={weekStart}
          weekEnd={weekEnd}
          timezone={autoFillLocation?.timezone ?? DEFAULT_TZ}
          applyTarget={
            autoFillLocation && autoFillRota
              ? { locationId: autoFillLocation.id, rotaId: autoFillRota.id }
              : null
          }
          onPreview={setPreviewSuggestions}
          onApplied={reloadShifts}
          onAssign={handleAssistantAssign}
          onSelectShift={setSelectedShiftId}
        />
      )}
    </DndContext>
  );
}
