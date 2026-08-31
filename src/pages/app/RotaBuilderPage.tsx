import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { addDays, format } from 'date-fns';
import {
  AlertTriangle,
  CalendarCheck,
  CalendarRange,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ClipboardCopy,
  ClipboardPaste,
  Plus,
  Printer,
  Search,
  Settings2,
  Sparkles,
  Trash2,
} from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useFeatureAccess } from '@/hooks/useFeatureAccess';
import { PermissionDenied } from '@/components/PermissionDenied';
import { useToast } from '@/hooks/useToast';
import { useConfirm } from '@/hooks/useConfirm';
import {
  listLocations,
  listDepartments,
  listMinimumCoverRulesForOrg,
} from '@/services/locationService';
import { listActiveStaff } from '@/services/staffService';
import { listShiftTypes } from '@/services/shiftTypeService';
import { listOrgLeaveRequests } from '@/services/leaveService';
import { listOrgAvailability } from '@/services/availabilityService';
import { listExpiringDocuments } from '@/services/documentService';
import {
  beginRotaRevision,
  discardRotaRevision,
  getOrCreateRotaForPeriod,
  pickRotaToOpen,
  publishRota,
  repeatRotaWeeks,
  rotaRefusalMessage,
  resolveRotasForLocations,
  unpublishRota,
} from '@/services/rotaService';
import {
  createShift,
  deleteShift,
  listShiftsForRotas,
  updateShift,
} from '@/services/shiftService';
import type { AiShiftSuggestion } from '@/services/aiRotaService';
import { RepeatWeekModal } from '@/components/rota/RepeatWeekModal';
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
import { Callout } from '@/components/ui/Callout';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';
import { Label } from '@/components/ui/Label';
import { Modal } from '@/components/ui/Modal';
import { Select } from '@/components/ui/Select';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import { hoursLabel } from '@/components/dashboard/dashboardFormat';
import { WorkspaceHeader } from '@/components/layout/WorkspaceHeader';
import { RotaGrid, type RotaGroup } from '@/components/rota/RotaGrid';
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
  MinimumCoverRule,
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
 * They are removed rather than made to work. The alternative. Loading five
 * weekly rotas behind a "Month" tab. Creates rota rows as a side effect of
 * looking at a calendar, and the publish button then means something different
 * depending on which tab is open. Two honest views beat four where half are
 * decoration.
 *
 * "Day" is safe because it is only a *display scope*: the same week's rota
 * stays loaded and editable, and the grid renders one of its columns.
 */
const VIEW_TABS = ['Week', 'Fortnight'] as const;

/**
 * One shift on the clipboard, stored relative to its week rather than on an
 * absolute date. `dayOffset` is 0-6 from that week's Monday, so pasting into
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

function formatWeekStart(dates: string[]): string {
  const first = dates[0];
  if (!first) return '';
  return format(new Date(`${first}T00:00:00`), 'EEEE d MMMM');
}

function formatWeekRange(dates: string[]): string {
  const first = dates[0];
  const last = dates[dates.length - 1];
  if (!first || !last) return '';
  const start = new Date(`${first}T00:00:00`);
  const end = new Date(`${last}T00:00:00`);
  const sameMonth = start.getMonth() === end.getMonth();
  return sameMonth
    ? `${format(start, 'd MMM')}-${format(end, 'd MMM yyyy')}`
    : `${format(start, 'd MMM')}-${format(end, 'd MMM yyyy')}`;
}

export function RotaBuilderPage(): JSX.Element {
  const { orgId, orgName } = useOrg();
  const { canBuildRota } = usePermissions();
  // `plans.features` has listed the assistant as Business-and-above since 0030
  // and nothing read it until now (CAP-038).
  const { has: hasFeature, loading: featuresLoading } = useFeatureAccess();
  const hasAiAssistant = hasFeature('ai_rota_assistant');
  const { showError, showSuccess } = useToast();
  const { confirm } = useConfirm();

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
  // shift against a snapshot taken before the loop started, and let the whole
  // batch through.
  const shiftsRef = useRef<Shift[]>([]);
  useEffect(() => {
    shiftsRef.current = shifts;
  }, [shifts]);

  // Inputs the warning rules need beyond the shifts themselves.
  const [leave, setLeave] = useState<LeaveRequest[]>([]);
  const [availability, setAvailability] = useState<Availability[]>([]);
  const [documents, setDocuments] = useState<StaffDocument[]>([]);
  const [minimumCoverRules, setMinimumCoverRules] = useState<MinimumCoverRule[]>([]);
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
  const [repeatOpen, setRepeatOpen] = useState(false);
  // Bumped when the week's rotas change identity rather than content —
  // starting or discarding an amendment swaps in a different rota whose
  // shifts are copies with their own ids, so the week has to be refetched
  // rather than patched in place.
  const [weekReloadKey, setWeekReloadKey] = useState(0);
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
  const [repeatForwardOpen, setRepeatForwardOpen] = useState(false);
  const [repeatForwardWeeks, setRepeatForwardWeeks] = useState('4');

  const dates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const weekEnd = dates[6] ?? weekStart;

  // Org-level data: locations, departments, staff, shift types.
  useEffect(() => {
    if (!orgId) return;
    setOrgDataLoading(true);
    setOrgDataFailed(false);
    void (async () => {
      try {
        const [locs, deptRows, staffRows, typeRows, coverRules] = await Promise.all([
          listLocations(orgId),
          listDepartments(orgId),
          listActiveStaff(orgId),
          listShiftTypes(orgId),
          listMinimumCoverRulesForOrg(orgId),
        ]);
        setLocations(locs);
        setDepartments(deptRows);
        setStaff(staffRows);
        setShiftTypes(typeRows);
        setMinimumCoverRules(coverRules);
      } catch (err) {
        reportError(err, { area: 'rota:load-org-data' });
        setOrgDataFailed(true);
        showError('Could not load staff and locations. Check your connection and retry.');
      } finally {
        setOrgDataLoading(false);
      }
    })();
  }, [orgId, reloadKey, showError]);

  // Rota + shifts for every location, for the selected week. The builder
  // shows all locations at once (docs/design/Rota-Builder.png), so every
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
        // One query for every location's rota, not one per location
        // (HARDEN-006). Only the locations with no rota yet then need a
        // write, and on a week that has been opened before that is none.
        const existing = await resolveRotasForLocations({
          orgId,
          periodStart: weekStart,
          periodEnd: weekEnd,
          locationIds: locations.map((l) => l.id),
        });

        const rotaByLocation = new Map<string, Rota>();
        const missing: Location[] = [];
        for (const loc of locations) {
          const resolved = existing.get(loc.id);
          const open = resolved ? pickRotaToOpen(resolved) : null;
          if (open) rotaByLocation.set(loc.id, open);
          else missing.push(loc);
        }

        // `getOrCreateRotaForPeriod` rather than a plain insert: it re-reads
        // the winner on a 23505, which is what makes two managers opening the
        // same new week safe.
        const created = await Promise.all(
          missing.map(async (loc) => ({
            locationId: loc.id,
            rota: await getOrCreateRotaForPeriod({
              orgId,
              name: `Week of ${weekStart}`,
              periodStart: weekStart,
              periodEnd: weekEnd,
              locationId: loc.id,
            }),
          })),
        );
        for (const { locationId, rota } of created) rotaByLocation.set(locationId, rota);

        // Every rota, including the ones just created. Excluding those would
        // save nothing — it is one query either way — and would rest on "a new
        // rota has no shifts", which the 23505 path can hand back someone
        // else's rota and quietly break.
        const rows = await listShiftsForRotas(
          [...rotaByLocation.values()].map((r) => r.id),
        );

        if (!active) return;
        setRotasByLocation(rotaByLocation);
        setShifts(rows);
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
  }, [orgId, locations, weekStart, weekEnd, weekReloadKey, showError]);

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
   * The week's real problems. Double-bookings, rest breaches, people rostered
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
        minimumCoverRules,
        coverDates: dates,
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
      minimumCoverRules,
      dates,
      insightsNow,
    ],
  );

  const criticalWarnings = useMemo(
    () => warnings.filter((w) => w.severity === 'critical'),
    [warnings],
  );

  /** Rings a chip red — matches the grid legend's "Conflict" swatch. */
  const conflictedShiftIds = useMemo(
    () =>
      new Set(
        criticalWarnings.map((w) => w.shiftId).filter((id): id is string => Boolean(id)),
      ),
    [criticalWarnings],
  );

  /** Shifts named by at least one warning. Powers the "needs attention" filter. */
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
    // Staff rostered this week surface first (what a name search is usually
    // for — finding someone's shift), everyone else follows. Alphabetical
    // within each group, so a fully idle roster reads as a plain A-Z list.
    const rostered = new Set(
      shiftsInScope
        .map((s) => s.staff_profile_id)
        .filter((id): id is string => Boolean(id)),
    );
    return [...rows].sort((a, b) => {
      const aRostered = rostered.has(a.id);
      const bRostered = rostered.has(b.id);
      if (aRostered !== bRostered) return aRostered ? -1 : 1;
      return `${a.first_name} ${a.last_name}`.localeCompare(
        `${b.first_name} ${b.last_name}`,
      );
    });
  }, [staff, departmentFilter, jobTitleFilter, search, shiftsInScope]);

  /**
   * Grouped by location. A single selected location shows its whole roster
   * (so a manager can schedule someone's first shift there); "All Locations"
   * groups by who is *actually rostered* this week. The same rule
   * ScheduleGrid uses, since staff_profiles has no location column and
   * showing everyone under every location would be fabricated, not derived.
   */
  const groups = useMemo<RotaGroup[]>(() => {
    if (locationFilter !== 'all') {
      const loc = filteredLocations[0];
      if (!loc) return [];
      // Showing the whole roster is deliberate. It is how you give someone
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

  /**
   * Staff (matching the current department/job-title/search filters) with no
   * shift anywhere in the org this week, regardless of the location filter —
   * `shifts` (every location, unlike `shiftsInScope`) is what makes that
   * honest, since staff_profiles carries no location to scope "idle" by.
   * Distinct from `groups`, which is who's already on the grid; this is who
   * isn't, anywhere.
   */
  const idleStaff = useMemo(() => {
    const rostered = new Set(
      shifts.map((s) => s.staff_profile_id).filter((id): id is string => Boolean(id)),
    );
    return staffFiltered.filter((s) => !rostered.has(s.id));
  }, [staffFiltered, shifts]);

  // staff_profiles has no location column (see `groups` above), so with "All
  // locations" selected there's nothing to honestly default to — but
  // AssignShiftModal now lets a new shift pick its own site, so this is only
  // ever a starting guess for that picker, never the final answer.
  const defaultAssignLocation = filteredLocations[0] ?? locations[0] ?? null;

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

  // `shiftsInScope`, not `shiftsForDisplay`: the totals footer states the
  // real cover for the day, independent of the Assignment/Shift-type filters
  // that narrow which CHIPS are drawn. Feeding it the filtered set meant
  // "Open shifts only" read every day as understaffed (assigned staff no
  // longer counted) and "Assigned only" read every day as fully optimal
  // (open shifts no longer counted) — the exact inconsistency `warnings`
  // below was already written to avoid, per the comment there.
  const dailyTotals = useMemo(
    () =>
      computeDailyTotals(
        shiftsInScope,
        dates,
        DEFAULT_TZ,
        minimumCoverRules,
        filteredLocations,
      ),
    [shiftsInScope, dates, minimumCoverRules, filteredLocations],
  );

  const rotasInScope = filteredLocations
    .map((l) => rotasByLocation.get(l.id))
    .filter((r): r is Rota => Boolean(r));
  const draftRotasInScope = rotasInScope.filter((r) => r.status === 'draft');
  const publishedRotasInScope = rotasInScope.filter((r) => r.status === 'published');
  const allPublished = rotasInScope.length > 0 && draftRotasInScope.length === 0;

  /** An amendment of an already-published week, rather than a first draft. */
  const amendmentsInScope = draftRotasInScope.filter((r) => r.supersedes_rota_id);
  const isAmending = amendmentsInScope.length > 0;
  /**
   * The published week is immutable — enforced by the database, not by this
   * screen (0061's `shifts_guard_immutable_rota`). Until someone amends it
   * there is nothing here to edit, and offering edits that the server will
   * refuse is how BUG-028 read to a manager: the builder said edits returned
   * the rota to draft, and instead they went straight to staff.
   */
  const readOnly = allPublished;
  const pendingShiftCount = shifts.filter((s) =>
    draftRotasInScope.some((r) => r.id === s.rota_id),
  ).length;

  /**
   * Refuse a mutation the database is going to refuse anyway, and say why.
   *
   * `shifts_guard_immutable_rota` (0061) rejects any write to a published
   * rota's shifts, including one made by a direct API call. This is the
   * screen agreeing with that rule rather than discovering it through a
   * failed request — and it is the honest version of the sentence this
   * builder used to print, which claimed edits returned the rota to draft
   * while they in fact went straight out to staff.
   */
  const guardEditable = useCallback((): boolean => {
    if (!readOnly) return true;
    showError(
      'This week is published. Choose Amend rota to change it — staff keep seeing the published version until you publish the amendment.',
    );
    return false;
  }, [readOnly, showError]);

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
      if (!guardEditable()) return { ok: false, reason: 'unavailable' };
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
    [orgId, locationById, rotasByLocation, guardEditable],
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
      return `${who} is already rostered ${start}-${end} on ${day}.`;
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
      if (!guardEditable()) return;
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
              showError(`Not added, ${describeClash(result.clash)}`);
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
        let startsAt: string;
        let endsAt: string;
        try {
          // A genuine 24h shift (e.g. a sleep-in/on-call shift) reads back
          // with an identical start and end time, which computeShiftIsoRange
          // rejects as ambiguous (0h vs 24h) — synchronously, so uncaught it
          // would crash the drag handler entirely rather than leave the shift
          // where it was.
          ({ startsAt, endsAt } = computeShiftIsoRange(
            cellDate,
            startTime,
            endTime,
            location.timezone,
          ));
        } catch (err) {
          reportError(err, { area: 'rota:drag-reassign' });
          showError('Could not move that shift. It has been left where it was.');
          return;
        }

        // Dragging a shift onto someone who is already working that window is
        // the same double-booking as creating one there, so it is refused the
        // same way. The shift stays where it was.
        const moveClash = findClashingShift(
          { staffProfileId: cellStaffProfileId ?? null, startsAt, endsAt },
          shiftsRef.current,
          { ignoreShiftId: shiftId },
        );
        if (moveClash) {
          showError(`Not moved, ${describeClash(moveClash)}`);
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
    [
      locationById,
      shiftTypes,
      shifts,
      placeShift,
      showError,
      describeClash,
      guardEditable,
    ],
  );

  const handleModalSave = async (values: AssignShiftFormValues): Promise<void> => {
    if (!guardEditable()) return;
    const locationId =
      assignModal.shift?.location_id ??
      values.locationId ??
      assignModal.context?.locationId;
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
    if (!guardEditable()) return;
    await deleteShift(shiftId);
    setShifts((prev) => prev.filter((s) => s.id !== shiftId));
    if (selectedShiftId === shiftId) setSelectedShiftId(null);
    setLastSavedAt(new Date());
  };

  const handleDeleteSelectedShift = useCallback(
    (shift: Shift): void => {
      if (!guardEditable()) return;
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
    [showError, guardEditable],
  );

  /**
   * Delete straight from the chip's ×.
   *
   * Confirmed, because §1 requires it of every destructive action and because
   * this control now sits *on* the shift rather than behind a panel. The
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
          message: `${startTime}, ${endTime} on ${when} for ${who} will be deleted. This cannot be undone.`,
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
    // somebody in two places at once, or working through approved leave, is
    // the one thing worth stopping outright rather than warning about.
    if (criticalWarnings.length > 0) {
      const [first] = criticalWarnings;
      setPublishError(
        `${criticalWarnings.length} critical ${criticalWarnings.length === 1 ? 'issue' : 'issues'} must be resolved before publishing, ${first?.title ?? ''}. See the Warnings tab.`,
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
      showSuccess(
        isAmending
          ? 'Amendment published. Staff now see the updated week; the version it replaced is kept as history.'
          : 'Rota published. Staff can now see this week.',
      );

      // Nothing dispatched from here any more. `rotas_enqueue_publish_notification`
      // (0069) writes the notification into `notification_outbox` inside the same
      // transaction as the publish, and pg_cron drains it — so closing this tab
      // cannot lose it, which the browser-initiated path could (GAP-026).
      //
      // Both paths firing would notify every affected person twice, so this one
      // goes. The recipient list is computed in SQL from the rota's own shifts,
      // which is the same set this code was deriving from `staffById`.
    } catch (err) {
      // A lifecycle refusal is not a fault: `publish_rota` raises ROTA4-ROTA8
      // with a sentence written for the manager, and minimum cover (0080) is
      // the one that will actually be seen — the button already blocks on the
      // client, so this fires when that view is stale, which is exactly when a
      // vague message is least useful. "Please try again" is also wrong: no
      // amount of retrying fills Saturday.
      const refusal = rotaRefusalMessage(err);
      if (refusal) {
        setPublishError(refusal);
      } else {
        reportError(err, { area: 'rota:publish' });
        setPublishError('Could not publish this rota. Please try again.');
      }
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async (): Promise<void> => {
    const publishedRotas = publishedRotasInScope;
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
      const code = (err as { code?: string } | null)?.code;
      setPublishError(
        code === 'ROTA8'
          ? 'This week has an amendment open. Publish or discard the amendment first, then unpublish.'
          : 'Could not unpublish this rota. Please try again.',
      );
    } finally {
      setPublishing(false);
    }
  };

  /**
   * Start amending a published week.
   *
   * The published rota is left exactly as staff were told and a draft copy is
   * created alongside it, so the week never disappears from anyone's phone
   * mid-edit. The copy's shifts have their own ids, so the grid is refetched
   * rather than patched — carrying the old ids across would send edits at
   * rows the database has already frozen.
   */
  const handleAmend = async (): Promise<void> => {
    if (publishedRotasInScope.length === 0) return;
    setPublishing(true);
    setPublishError(null);
    try {
      await Promise.all(publishedRotasInScope.map((r) => beginRotaRevision(r.id)));
      setWeekReloadKey((k) => k + 1);
      showSuccess(
        'Amendment started. Staff keep seeing the published week until you publish this.',
      );
    } catch (err) {
      reportError(err, { area: 'rota:amend' });
      setPublishError('Could not start an amendment. Please try again.');
    } finally {
      setPublishing(false);
    }
  };

  /**
   * Throw the amendment away and go back to the published week.
   *
   * BUG-029 was a state with no way out: once unpublishing had happened there
   * was no route back that did not involve editing rows by hand. An amendment
   * is only safe to offer if abandoning it is equally easy.
   */
  const handleDiscardAmendment = async (): Promise<void> => {
    if (amendmentsInScope.length === 0) return;
    const amendedShiftCount = shifts.filter((s) =>
      amendmentsInScope.some((r) => r.id === s.rota_id),
    ).length;
    const ok = await confirm({
      title: 'Discard this amendment?',
      message: `The ${amendedShiftCount} ${amendedShiftCount === 1 ? 'shift' : 'shifts'} in this amendment are deleted and ${formatWeekRange(dates)} goes back to the published version staff are already seeing. This cannot be undone.`,
      confirmLabel: 'Discard amendment',
      tone: 'danger',
    });
    if (!ok) return;

    setPublishing(true);
    setPublishError(null);
    try {
      await Promise.all(amendmentsInScope.map((r) => discardRotaRevision(r.id)));
      setWeekReloadKey((k) => k + 1);
      showSuccess('Amendment discarded. The published week is unchanged.');
    } catch (err) {
      reportError(err, { area: 'rota:discard-amendment' });
      setPublishError('Could not discard the amendment. Please try again.');
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
            `${summary} ${skipped} skipped, ${skipped === 1 ? 'that person was' : 'those people were'} already rostered at the same time.`,
          );
        } else {
          showSuccess(summary);
        }
      } catch (err) {
        reportError(err, { area: 'rota:paste-shifts' });
        showError(
          'Could not paste every shift. The ones already added have been kept. Check the grid before retrying.',
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
  /**
   * Repeat this week forward (CAP-006, `0107`).
   *
   * One call per draft rota in scope, and the whole of each is one
   * transaction in the database. Doing it here with the paste machinery
   * would be twelve rota creations and several hundred round trips, any of
   * which can fail on its own and leave a quarter half-built with no record
   * of where it stopped.
   */
  const handleRepeatWeek = useCallback(
    (weeks: number): void => {
      setBusyAction('repeat');
      void (async () => {
        try {
          let created = 0;
          let skipped = 0;
          for (const rota of draftRotasInScope) {
            const result = await repeatRotaWeeks(rota.id, weeks);
            created += result.shiftsCreated;
            skipped += result.weeksSkipped;
          }
          setRepeatOpen(false);
          showSuccess(
            skipped === 0
              ? `${created} ${created === 1 ? 'shift' : 'shifts'} copied into the next ${weeks} ${weeks === 1 ? 'week' : 'weeks'}.`
              : // Named rather than glossed over: a manager told "done" who
                // later finds a gap has been misled by this screen.
                `${created} shifts copied. ${skipped} ${skipped === 1 ? 'week was' : 'weeks were'} left alone — already published, or already being worked on.`,
          );
        } catch (err) {
          reportError(err, { area: 'rota:repeat-week' });
          showError(
            rotaRefusalMessage(err) ??
              'That week could not be repeated. Please try again.',
          );
        } finally {
          setBusyAction(null);
          setReloadKey((k) => k + 1);
        }
      })();
    },
    [draftRotasInScope, showError, showSuccess],
  );

  const handleCopyPreviousWeek = useCallback((): void => {
    if (!orgId) return;
    setBusyAction('previous-week');
    void (async () => {
      try {
        const previousStart = getMonday(addDays(new Date(`${weekStart}T00:00:00`), -7));
        const previousDates = getWeekDates(previousStart);
        const previousEnd = previousDates[6] ?? previousStart;

        // Resolve, never create. This reads a week that has already happened,
        // and `getOrCreateRotaForPeriod` was writing an empty draft rota into
        // any past week a location had not been scheduled for — fabricating
        // history as a side effect of looking at it, and making "was that week
        // ever scheduled?" answer yes. A location with nothing to copy is now
        // simply skipped. (It also cost two serial queries per location;
        // HARDEN-006.)
        const previousRotas = await resolveRotasForLocations({
          orgId,
          periodStart: previousStart,
          periodEnd: previousEnd,
          locationIds: filteredLocations.map((l) => l.id),
        });

        const previousRotaByLocation = new Map<string, string>();
        for (const location of filteredLocations) {
          const resolved = previousRotas.get(location.id);
          const rota = resolved ? pickRotaToOpen(resolved) : null;
          if (rota) previousRotaByLocation.set(location.id, rota.id);
        }

        const previousShifts = await listShiftsForRotas([
          ...previousRotaByLocation.values(),
        ]);
        const shiftsByRota = new Map<string, Shift[]>();
        for (const shift of previousShifts) {
          if (shift.rota_id === null) continue;
          const bucket = shiftsByRota.get(shift.rota_id);
          if (bucket) bucket.push(shift);
          else shiftsByRota.set(shift.rota_id, [shift]);
        }

        const collected: CopiedShift[] = [];
        for (const location of filteredLocations) {
          const rotaId = previousRotaByLocation.get(location.id);
          if (!rotaId) continue;
          for (const shift of shiftsByRota.get(rotaId) ?? []) {
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
   * Repeats the current week's pattern forward as draft rotas for N future
   * weeks, so staff can see and swap shifts further ahead than one week at a
   * time. Unlike `pasteShifts`/`placeShift`, every target week here is one
   * this component has never loaded — there is no `rotasByLocation` entry
   * and no `shifts` state for it — so each week gets its own rota lookup and
   * its own clash-checking list, and none of it touches the page's own
   * `shifts` state (those shifts don't belong to the week on screen).
   */
  const handleRepeatForward = useCallback(
    async (weeksAhead: number): Promise<void> => {
      if (!orgId || weeksAhead < 1) return;
      setBusyAction('repeat-forward');
      try {
        const sourceDates = dates;
        const collected: CopiedShift[] = [];
        for (const location of filteredLocations) {
          const rows = shifts.filter((s) => s.location_id === location.id);
          for (const shift of rows) {
            const { date, time: startTime } = fromIsoInTimezone(
              shift.starts_at,
              location.timezone,
            );
            const { time: endTime } = fromIsoInTimezone(shift.ends_at, location.timezone);
            const dayOffset = sourceDates.indexOf(date);
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
          showError('This week has no shifts to repeat forward.');
          return;
        }

        let created = 0;
        let skipped = 0;
        let weeksAlreadyBuilt = 0;
        for (let week = 1; week <= weeksAhead; week += 1) {
          const targetStart = getMonday(
            addDays(new Date(`${weekStart}T00:00:00`), 7 * week),
          );
          const targetDates = getWeekDates(targetStart);
          const targetEnd = targetDates[6] ?? targetStart;

          // Never write into a week that's already published — staff can see
          // it, and this tool only fills genuinely open weeks, it doesn't
          // amend ones a manager already built and put out.
          const rotaByLocationId = new Map<string, string>();
          for (const location of filteredLocations) {
            const rota = await getOrCreateRotaForPeriod({
              orgId,
              name: `Week of ${targetStart}`,
              periodStart: targetStart,
              periodEnd: targetEnd,
              locationId: location.id,
            });
            if (rota.status === 'published') {
              weeksAlreadyBuilt += 1;
              continue;
            }
            rotaByLocationId.set(location.id, rota.id);
          }
          if (rotaByLocationId.size === 0) continue;

          // Creating above is deliberate — this tool exists to build weeks
          // that do not yet have a rota. Fetching their shifts one at a time
          // was not (HARDEN-006).
          const working: Shift[] = await listShiftsForRotas([
            ...rotaByLocationId.values(),
          ]);

          for (const item of collected) {
            const date = targetDates[item.dayOffset];
            const rotaId = rotaByLocationId.get(item.locationId);
            const location = locationById.get(item.locationId);
            if (!date || !rotaId || !location) continue;
            const { startsAt, endsAt } = computeShiftIsoRange(
              date,
              item.startTime,
              item.endTime,
              location.timezone,
            );
            if (
              findClashingShift(
                { staffProfileId: item.staffProfileId, startsAt, endsAt },
                working,
              )
            ) {
              skipped += 1;
              continue;
            }
            const createdShift = await createShift({
              org_id: orgId,
              rota_id: rotaId,
              location_id: item.locationId,
              staff_profile_id: item.staffProfileId,
              shift_type_id: item.shiftTypeId,
              starts_at: startsAt,
              ends_at: endsAt,
              break_minutes: item.breakMinutes,
              status: 'assigned',
              notes: item.notes,
            });
            working.push(createdShift);
            created += 1;
          }
        }

        let summary = `${created} ${created === 1 ? 'shift' : 'shifts'} added as drafts across the next ${weeksAhead} ${weeksAhead === 1 ? 'week' : 'weeks'}.`;
        if (skipped > 0) {
          summary += ` ${skipped} skipped, ${skipped === 1 ? 'that person was' : 'those people were'} already rostered at the same time.`;
        }
        if (weeksAlreadyBuilt > 0) {
          summary += ` ${weeksAlreadyBuilt} location-week${weeksAlreadyBuilt === 1 ? '' : 's'} already had a published rota and were left untouched.`;
        }
        showSuccess(summary);
      } catch (err) {
        reportError(err, { area: 'rota:repeat-forward' });
        showError(
          'Could not build every week ahead. The ones already created have been kept.',
        );
      } finally {
        setBusyAction(null);
      }
    },
    [
      orgId,
      weekStart,
      dates,
      filteredLocations,
      shifts,
      locationById,
      showError,
      showSuccess,
    ],
  );

  /**
   * Delete every DRAFT shift in scope (§8 "Clear rota").
   *
   * Published shifts are skipped deliberately: staff have already been told
   * they are working them, and a bulk clear must not silently unschedule
   * somebody's Saturday. Unpublish first if that is genuinely the intent.
   */
  const handleClearShifts = useCallback((): void => {
    if (!guardEditable()) return;
    const draftShiftIds = shiftsForDisplay
      .filter((s) => draftRotasInScope.some((r) => r.id === s.rota_id))
      .map((s) => s.id);

    if (draftShiftIds.length === 0) {
      showError(
        'There are no draft shifts in view to clear. Published shifts are left alone. Unpublish the rota first.',
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
  }, [
    shiftsForDisplay,
    draftRotasInScope,
    dates,
    confirm,
    showError,
    showSuccess,
    guardEditable,
  ]);

  /** Fill an open shift from the assistant's ranked suggestions. */
  const handleAssistantAssign = useCallback(
    async (shiftId: string, staffProfileId: string): Promise<void> => {
      if (!guardEditable()) return;
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
            showError(`Not assigned, ${describeClash(clash)}`);
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
    [showError, showSuccess, describeClash, guardEditable],
  );

  const reloadShifts = (): void => {
    // Runs after every create, move and delete, so it is the hottest of the
    // builder's reads (HARDEN-006). One `in` instead of one query per location.
    void listShiftsForRotas([...rotasByLocation.values()].map((r) => r.id))
      .then((rows) => setShifts(rows))
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
    // Courtesy, not enforcement. The refusal that counts is in
    // `ai-rota-assistant` itself, which spends the OpenRouter budget and is
    // reachable with any member's JWT (CAP-038). This exists so a manager on
    // Starter sees an upgrade sentence instead of a 403 from a panel that
    // opened as though it would work.
    if (!hasAiAssistant) {
      showError(
        'The AI assistant is included with the Business and Enterprise plans. Upgrade in Settings → Billing to use it.',
      );
      return;
    }
    if (!autoFillLocation || !autoFillRota) {
      showError('Select a single location above to auto-fill its rota.');
      return;
    }
    setAutoFillOpen(true);
  };

  // Belt and braces behind the route's own `RequireRole` gate. See the
  // equivalent note in ReportsPage.
  if (!canBuildRota) {
    return <PermissionDenied area="the rota builder" allowed={['owner', 'manager']} />;
  }

  if (orgDataFailed && !orgDataLoading) {
    return (
      <Card>
        <p className="mb-4 text-content-muted dark:text-content-muted-dark">
          Could not load this organisation&rsquo;s staff and locations. This is a
          connection problem, not an empty organisation. Nothing has been lost.
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
          Add a location before building a rota. See the Locations page.
        </p>
      </Card>
    );
  }

  return (
    <DndContext sensors={sensors} onDragEnd={handleDragEnd}>
      <div>
        {/* ---- Page header ---- */}
        <WorkspaceHeader
          title="Rota Builder"
          subtitle={`Week commencing ${formatWeekStart(dates)} · ${orgName ?? ''}. Click any cell to assign or clear a shift.`}
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
                setWeekStart((d) => getMonday(addDays(new Date(`${d}T00:00:00`), -7)))
              }
              aria-label="Previous week"
              className="rounded-lg border border-surface-border p-1.5 text-content-muted hover:text-content dark:border-surface-border-dark dark:text-content-muted-dark"
            >
              <ChevronLeft size={16} />
            </button>
            <button
              type="button"
              onClick={() =>
                setWeekStart((d) => getMonday(addDays(new Date(`${d}T00:00:00`), 7)))
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
                  aria-pressed={tab === 'Week'}
                  onClick={() =>
                    tab === 'Fortnight' &&
                    showSuccess(
                      'Fortnight and month views use the same grid at lower density.',
                    )
                  }
                  className={cn(
                    'rounded-lg px-3 py-1.5 text-sm font-medium',
                    tab === 'Week'
                      ? 'bg-primary text-white'
                      : 'text-content-muted hover:text-content dark:text-content-muted-dark dark:hover:text-content-dark',
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
            <Button
              size="sm"
              variant="secondary"
              onClick={handleCopyPreviousWeek}
              disabled={busyAction === 'previous-week'}
            >
              {busyAction === 'previous-week' ? 'Copying…' : 'Copy last week'}
            </Button>
            {/* CAP-006. Beside Copy last week because they are the same
                thought pointed in opposite directions, and a manager who has
                just built a week is standing right here. */}
            <Button
              size="sm"
              variant="secondary"
              onClick={() => setRepeatOpen(true)}
              disabled={busyAction === 'repeat' || draftRotasInScope.length === 0}
              title={
                draftRotasInScope.length === 0
                  ? 'Repeat works from a draft week'
                  : undefined
              }
            >
              {busyAction === 'repeat' ? 'Repeating…' : 'Repeat forward'}
            </Button>
            {/* Shown but disabled rather than hidden while the entitlement is
                unknown or absent: a button that disappears once the features
                load reads as a bug, and one that was never there gives a
                manager nothing to ask their owner about. `title` carries the
                reason for a pointer; the click handler says it out loud. */}
            <Button
              size="sm"
              variant="secondary"
              onClick={handleAutoFillClick}
              disabled={featuresLoading}
              title={
                hasAiAssistant
                  ? undefined
                  : 'Included with the Business and Enterprise plans'
              }
            >
              <Sparkles size={14} aria-hidden="true" />
              AI fill gaps
            </Button>

            <div className="relative flex">
              {readOnly ? (
                <Button
                  size="sm"
                  className="rounded-r-none"
                  onClick={() => void handleAmend()}
                  disabled={publishing}
                >
                  {publishing ? 'Starting…' : 'Amend rota'}
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
                  {publishing
                    ? 'Publishing…'
                    : isAmending
                      ? 'Publish amendment'
                      : `Publish (${pendingShiftCount} changes)`}
                </Button>
              )}
              <button
                type="button"
                aria-label="Publish options"
                onClick={() => setPublishMenuOpen((v) => !v)}
                className="rounded-r-xl border-l border-primary-fg/20 bg-primary px-2 text-primary-fg hover:bg-primary/90"
              >
                <ChevronDown size={14} />
              </button>
              {publishMenuOpen && (
                <div className="absolute right-0 top-full z-10 mt-1 w-64 rounded-xl border border-surface-border bg-surface p-1 shadow-lg dark:border-surface-border-dark dark:bg-surface-dark">
                  <button
                    type="button"
                    onClick={() => {
                      setPublishMenuOpen(false);
                      void handleUnpublish();
                    }}
                    disabled={publishedRotasInScope.length === 0 || isAmending}
                    title={
                      isAmending ? 'Publish or discard the amendment first' : undefined
                    }
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-content hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                  >
                    Unpublish — hide this week from staff
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPublishMenuOpen(false);
                      void handleDiscardAmendment();
                    }}
                    disabled={!isAmending}
                    className="w-full rounded-lg px-3 py-2 text-left text-sm text-content hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                  >
                    Discard amendment
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* ---- Publish status ---- */}
        {publishError ? (
          <Callout tone="danger" title="Can't publish yet" className="mb-4">
            {publishError}
          </Callout>
        ) : readOnly ? (
          <Callout tone="success" title="Published" className="mb-4">
            Staff can see this week, and it is locked while they are working to it. Choose
            Amend rota to change it — staff keep seeing this version until you publish the
            amendment.
          </Callout>
        ) : isAmending && criticalWarnings.length === 0 ? (
          <Callout tone="info" title="Amendment in progress" className="mb-4">
            Staff still see the published version of this week. Publish the amendment to
            replace it, or discard it to leave the published week as it is.
          </Callout>
        ) : criticalWarnings.length > 0 ? (
          <Callout
            tone="danger"
            title={isAmending ? 'Amendment blocked' : 'Draft, not visible to staff'}
            className="mb-4"
          >
            {criticalWarnings.length} critical{' '}
            {criticalWarnings.length === 1 ? 'issue blocks' : 'issues block'} publication.
            See the Warnings tab.
            {isAmending ? ' Staff continue to see the published version meanwhile.' : ''}
          </Callout>
        ) : rotasInScope.length > 0 ? (
          <Callout tone="info" title="Draft, not visible to staff" className="mb-4">
            No blocking issues. Ready to publish.
          </Callout>
        ) : null}

        {/* ---- Filters row ---- */}
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Select
            aria-label="Filter by location"
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
            aria-label="Filter by department"
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
            aria-label="Filter by shift type"
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

          {/* Every other per-shift/per-week action the reference doesn't
              model (it has no shift-type management, no clipboard, no
              printing) collapses behind one "Actions" menu rather than more
              toolbar buttons. */}
          <div className="relative ml-auto">
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
                className="absolute right-0 top-full z-10 mt-1 w-56 rounded-xl border border-surface-border bg-surface p-1 shadow-lg dark:border-surface-border-dark dark:bg-surface-dark"
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
                    handleCopyShifts();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-content hover:bg-surface-subtle dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                >
                  <ClipboardCopy size={14} aria-hidden="true" />
                  Copy shifts
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={(clipboard?.length ?? 0) === 0}
                  onClick={() => {
                    setActionsMenuOpen(false);
                    handlePasteShifts();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-content hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                >
                  <ClipboardPaste size={14} aria-hidden="true" />
                  Paste shifts
                  {(clipboard?.length ?? 0) > 0 && ` (${clipboard?.length})`}
                </button>
                <button
                  type="button"
                  role="menuitem"
                  disabled={busyAction === 'clear'}
                  onClick={() => {
                    setActionsMenuOpen(false);
                    handleClearShifts();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-content hover:bg-surface-subtle disabled:cursor-not-allowed disabled:opacity-50 dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                >
                  <Trash2 size={14} aria-hidden="true" />
                  Clear draft shifts
                </button>
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActionsMenuOpen(false);
                    window.print();
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-content hover:bg-surface-subtle dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                >
                  <Printer size={14} aria-hidden="true" />
                  Print
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
                <button
                  type="button"
                  role="menuitem"
                  onClick={() => {
                    setActionsMenuOpen(false);
                    setRepeatForwardOpen(true);
                  }}
                  className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-content hover:bg-surface-subtle dark:text-content-dark dark:hover:bg-surface-subtle-dark"
                >
                  <CalendarRange size={14} aria-hidden="true" />
                  Build weeks ahead…
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ---- Main: grid ---- */}
        {loading || orgDataLoading ? (
          <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
        ) : (
          <Card className="min-w-0 overflow-hidden p-5">
            {groups.length === 0 ? (
              <p className="text-content-muted dark:text-content-muted-dark">
                No staff rostered for this filter yet. Select a single location above to
                see its full team.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <RotaGrid
                  dates={dates}
                  groups={groups}
                  shiftMapByLocation={shiftMapByLocation}
                  shiftTypes={shiftTypes}
                  previewMap={previewMap}
                  dailyTotals={dailyTotals}
                  selectedShiftId={selectedShiftId}
                  conflictedShiftIds={conflictedShiftIds}
                  shiftTypeFilter={shiftTypeFilter}
                  onShiftTypeFilterChange={setShiftTypeFilter}
                  onAddShift={(staffProfileId, date, locationId) => {
                    if (!guardEditable()) return;
                    setAssignModal({
                      open: true,
                      context: { staffProfileId, date, locationId },
                      shift: null,
                    });
                  }}
                  onSelectShift={(shift) => {
                    setSelectedShiftId(shift.id);
                    setAssignModal({ open: true, context: null, shift });
                  }}
                  // A published week's chips lose their × — the database
                  // refuses the delete, so offering it would be a lie.
                  onDeleteShift={readOnly ? undefined : handleDeleteShiftFromChip}
                />
              </div>
            )}
          </Card>
        )}

        {/* ---- Status bar ---- */}
        <div className="mt-4 flex items-center gap-1.5 text-sm text-content-muted dark:text-content-muted-dark">
          <CalendarCheck size={14} aria-hidden="true" className="text-success" />
          {lastSavedAt
            ? `All changes saved · Last saved ${format(lastSavedAt, 'HH:mm')}`
            : 'All changes saved'}
        </div>

        <div className="mt-4 grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))]">
          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-content dark:text-content-dark">
                Conflicts
              </h2>
              <div className="flex items-center gap-2">
                {criticalWarnings.length > 0 ? (
                  <span className="rounded-full bg-danger/10 px-2.5 py-1 text-xs font-semibold text-danger-ink dark:text-danger-ink-dark">
                    {criticalWarnings.length} blocking
                  </span>
                ) : (
                  <span className="rounded-full bg-success/10 px-2.5 py-1 text-xs font-semibold text-success-ink dark:text-success-ink-dark">
                    None blocking
                  </span>
                )}
                {warnings.length > criticalWarnings.length && (
                  <span className="rounded-full bg-warning/10 px-2.5 py-1 text-xs font-semibold text-warning">
                    {warnings.length - criticalWarnings.length} advisory
                  </span>
                )}
              </div>
            </div>
            {warnings.length === 0 ? (
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                No conflicts. Rest rules, contracted hours and minimum cover all
                satisfied.
              </p>
            ) : (
              <ul className="max-h-80 space-y-2 overflow-y-auto pr-1">
                {warnings.map((insight) => (
                  <li key={insight.id} className="flex items-start gap-2.5">
                    <span
                      className={cn(
                        'mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full',
                        insight.severity === 'critical'
                          ? 'bg-danger/10 text-danger'
                          : 'bg-warning/10 text-warning',
                      )}
                    >
                      <AlertTriangle size={13} aria-hidden="true" />
                    </span>
                    <span>
                      <span className="block text-sm text-content dark:text-content-dark">
                        {insight.title}
                      </span>
                      <span className="block text-xs text-content-muted dark:text-content-muted-dark">
                        {insight.severity === 'critical'
                          ? 'Blocks publication'
                          : 'Advisory. You can publish over this'}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card className="p-5">
            <div className="mb-3 flex items-center justify-between gap-3">
              <h2 className="font-semibold text-content dark:text-content-dark">
                Unassigned staff
              </h2>
              {idleStaff.length > 0 && (
                <span className="rounded-full bg-surface-subtle px-2.5 py-1 text-xs text-content-muted dark:bg-surface-subtle-dark dark:text-content-muted-dark">
                  {idleStaff.length} with no shift anywhere this week
                </span>
              )}
            </div>
            {idleStaff.length === 0 ? (
              <p className="text-sm text-content-muted dark:text-content-muted-dark">
                Everyone has at least one shift this week.
              </p>
            ) : (
              <ul className="divide-y divide-surface-border dark:divide-surface-border-dark">
                {idleStaff.map((person) => (
                  <li
                    key={person.id}
                    className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0"
                  >
                    <StaffAvatar
                      firstName={person.first_name}
                      lastName={person.last_name}
                      photoUrl={person.photo_url}
                      size="sm"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium text-content dark:text-content-dark">
                        {person.first_name} {person.last_name}
                      </p>
                      <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                        {person.job_title ?? 'No job title'}
                      </p>
                    </div>
                    <span className="shrink-0 text-xs text-content-muted dark:text-content-muted-dark">
                      {hoursLabel(person.weekly_hours ?? 0)}/week
                    </span>
                    {defaultAssignLocation && (
                      <Button
                        size="sm"
                        variant="secondary"
                        className="shrink-0"
                        onClick={() =>
                          setAssignModal({
                            open: true,
                            context: {
                              staffProfileId: person.id,
                              date: dates[0] ?? weekStart,
                              locationId: defaultAssignLocation.id,
                            },
                            shift: null,
                          })
                        }
                      >
                        Assign
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>

      <AssignShiftModal
        open={assignModal.open}
        onClose={() => setAssignModal({ open: false, context: null, shift: null })}
        staff={staff}
        shiftTypes={shiftTypes}
        locations={locations}
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
              className="mt-0.5 h-4 w-4 rounded border-surface-border text-primary dark:text-primary-ink-dark focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
            />
            <span>
              Only show shifts that need attention
              <span className="block text-xs text-content-muted dark:text-content-muted-dark">
                Double-bookings, rest breaches, leave clashes and unfilled cover.
                Everything on the Warnings tab.
              </span>
            </span>
          </label>

          <label className="flex min-h-11 cursor-pointer items-start gap-2.5 text-sm text-content dark:text-content-dark">
            <input
              type="checkbox"
              checked={hideEmptyStaff}
              onChange={(e) => setHideEmptyStaff(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-surface-border text-primary dark:text-primary-ink-dark focus-visible:ring-2 focus-visible:ring-primary dark:border-surface-border-dark"
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

      <Modal
        open={repeatForwardOpen}
        onClose={() => setRepeatForwardOpen(false)}
        title="Build weeks ahead"
      >
        <div className="space-y-4">
          <p className="text-sm text-content-muted dark:text-content-muted-dark">
            Repeats this week&rsquo;s pattern forward as draft rotas, so staff can see
            further ahead and swap shifts with each other early. Nothing is published —
            review and publish each week as usual.
          </p>
          <div>
            <Label htmlFor="repeat-weeks">Weeks ahead</Label>
            <Input
              id="repeat-weeks"
              type="number"
              min="1"
              max="26"
              value={repeatForwardWeeks}
              onChange={(e) => setRepeatForwardWeeks(e.target.value)}
            />
            <p className="mt-1 text-xs text-content-muted dark:text-content-muted-dark">
              e.g. 4 for a month ahead, 12 for a quarter.
            </p>
          </div>
          <Button
            className="w-full"
            disabled={busyAction === 'repeat-forward'}
            onClick={() => {
              const weeksAhead = Math.min(
                26,
                Math.max(1, Number(repeatForwardWeeks) || 0),
              );
              setRepeatForwardOpen(false);
              void handleRepeatForward(weeksAhead);
            }}
          >
            {busyAction === 'repeat-forward' ? 'Building…' : 'Build weeks ahead'}
          </Button>
        </div>
      </Modal>

      {/*
        `AutoFillPanel` was replaced by `RotaAssistantPanel` in the demo branch:
        the assistant reviews the rota and ranks candidates for a specific open
        shift, rather than only generating a whole draft.

        Note the gating difference. Auto-fill needed a single location up front,
        because it WRITES a draft into one rota. The assistant's Review and
        Fill-gaps tabs read across every location on screen, so the panel opens
        regardless and `applyTarget` is null until one location is selected, which is what stops a generated draft from silently rostering people at
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
            readOnly || !autoFillLocation || !autoFillRota
              ? null
              : { locationId: autoFillLocation.id, rotaId: autoFillRota.id }
          }
          applyBlockedReason={
            readOnly
              ? 'This week is published, so shifts cannot be written into it. Choose Amend rota first — staff keep seeing the published version until you publish the amendment.'
              : null
          }
          onPreview={setPreviewSuggestions}
          onApplied={reloadShifts}
          onAssign={handleAssistantAssign}
          onSelectShift={setSelectedShiftId}
        />
      )}

      <RepeatWeekModal
        open={repeatOpen}
        onClose={() => setRepeatOpen(false)}
        onConfirm={handleRepeatWeek}
        busy={busyAction === 'repeat'}
      />
    </DndContext>
  );
}
