import { useCallback, useEffect, useMemo, useState } from 'react';
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
  Info,
  Plus,
  Search,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/useToast';
import { useInngestDispatch } from '@/hooks/useInngestDispatch';
import { listLocations, listDepartments } from '@/services/locationService';
import { listActiveStaff } from '@/services/staffService';
import { listShiftTypes } from '@/services/shiftTypeService';
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
  computeWarnings,
  fromIsoInTimezone,
  getMonday,
  getWeekDates,
  shiftCellKey,
} from '@/lib/rotaGrid';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { RotaGrid, type RotaGroup } from '@/components/rota/RotaGrid';
import { ShiftInspectorPanel } from '@/components/rota/ShiftInspectorPanel';
import { RotaActionRail } from '@/components/rota/RotaActionRail';
import {
  AssignShiftModal,
  type AssignShiftFormValues,
} from '@/components/rota/AssignShiftModal';
import { ShiftTypeManagerModal } from '@/components/rota/ShiftTypeManagerModal';
import { RotaAssistantPanel } from '@/components/rota/RotaAssistantPanel';
import { ShiftPatternLegend } from '@/components/rota/ShiftPatternLegend';
import type { Department, Location, Rota, Shift, ShiftType, StaffProfile } from '@/types';

const DEFAULT_TZ = 'Europe/London';
/** "Day" and "Month" would each open a *different* rota (rotas key on exact
 * period_start/period_end — see rotaService.ts), fragmenting one week's
 * shifts across incompatible rota rows. Only "Week" is safe to make
 * editable; the rest stay visible but inert, like every other stub in this
 * page. See rota-log.md. */
const VIEW_TABS = ['Day', 'Week', '2 Weeks', 'Month'] as const;

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
  const { orgId } = useOrg();
  const { canBuildRota } = usePermissions();
  const { showError, showSuccess } = useToast();
  const { send } = useInngestDispatch();

  const [locations, setLocations] = useState<Location[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [rotasByLocation, setRotasByLocation] = useState<Map<string, Rota>>(new Map());
  const [shifts, setShifts] = useState<Shift[]>([]);
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
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [previewSuggestions, setPreviewSuggestions] = useState<AiShiftSuggestion[]>([]);

  const dates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const weekEnd = dates[6] ?? weekStart;

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
  const shiftsByType = useMemo(
    () =>
      shiftTypeFilter === 'all'
        ? shiftsInScope
        : shiftsInScope.filter((s) => s.shift_type_id === shiftTypeFilter),
    [shiftsInScope, shiftTypeFilter],
  );

  /** How many shifts of each type are on screen — the legend's counts. */
  const countsByType = useMemo(() => {
    const counts = new Map<string, number>();
    for (const shift of shiftsInScope) {
      if (!shift.shift_type_id) continue;
      counts.set(shift.shift_type_id, (counts.get(shift.shift_type_id) ?? 0) + 1);
    }
    return counts;
  }, [shiftsInScope]);

  const query = search.trim().toLowerCase();

  /**
   * The search box promises "staff, skills, shifts", so it has to reach all
   * three. Matching a *shift* — by pattern name, by either end of its time
   * window, or by its note — is what makes "night" and "21:45" both land on
   * the same chips; matching only names left two thirds of the placeholder
   * unimplemented.
   *
   * Two passes, because the two sides feed each other: find the people who
   * match outright, keep every shift that matches on its own terms *or*
   * belongs to one of them, then keep the people who match outright *or* still
   * have a shift on screen. Doing it in one pass would drop a matching
   * person's other shifts, or hide the row a matching shift sits in.
   */
  const { shiftsForDisplay, staffFiltered } = useMemo(() => {
    const byDepartment =
      departmentFilter === 'all'
        ? staff
        : staff.filter((s) => s.department_id === departmentFilter);

    if (!query) return { shiftsForDisplay: shiftsByType, staffFiltered: byDepartment };

    const typeById = new Map(shiftTypes.map((t) => [t.id, t]));
    const directStaff = new Set(
      byDepartment
        .filter(
          (p) =>
            `${p.first_name} ${p.last_name}`.toLowerCase().includes(query) ||
            (p.job_title?.toLowerCase().includes(query) ?? false) ||
            (p.skills ?? []).some((skill) => skill.toLowerCase().includes(query)),
        )
        .map((p) => p.id),
    );

    const keptShifts = shiftsByType.filter((shift) => {
      if (shift.staff_profile_id && directStaff.has(shift.staff_profile_id)) return true;
      const type = shift.shift_type_id ? typeById.get(shift.shift_type_id) : undefined;
      if (type?.name.toLowerCase().includes(query)) return true;
      if (shift.notes?.toLowerCase().includes(query)) return true;
      const { time: startTime } = fromIsoInTimezone(shift.starts_at, DEFAULT_TZ);
      const { time: endTime } = fromIsoInTimezone(shift.ends_at, DEFAULT_TZ);
      return startTime.includes(query) || endTime.includes(query);
    });

    const withKeptShift = new Set(
      keptShifts.map((s) => s.staff_profile_id).filter((id): id is string => Boolean(id)),
    );

    return {
      shiftsForDisplay: keptShifts,
      staffFiltered: byDepartment.filter(
        (p) => directStaff.has(p.id) || withKeptShift.has(p.id),
      ),
    };
  }, [staff, departmentFilter, query, shiftsByType, shiftTypes]);

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
      return [{ location: loc, staff: staffFiltered }];
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
  }, [locationFilter, filteredLocations, staffFiltered, shiftsForDisplay]);

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
  const warnings = useMemo(
    () => computeWarnings(shiftsForDisplay, DEFAULT_TZ),
    [shiftsForDisplay],
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
    async (input: {
      staffProfileId: string | null;
      date: string;
      shiftTypeId: string | null;
      locationId: string;
      startTime: string;
      endTime: string;
      breakMinutes?: number;
      notes?: string | null;
    }): Promise<void> => {
      if (!orgId) return;
      const location = locationById.get(input.locationId);
      const rota = rotasByLocation.get(input.locationId);
      if (!location || !rota) return;
      const { startsAt, endsAt } = computeShiftIsoRange(
        input.date,
        input.startTime,
        input.endTime,
        location.timezone,
      );
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
    },
    [orgId, locationById, rotasByLocation],
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
        }).catch((err) => {
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
    [locationById, shiftTypes, shifts, placeShift, showError],
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
      await placeShift({
        staffProfileId: values.staffProfileId,
        date: values.date,
        shiftTypeId: values.shiftTypeId,
        locationId: location.id,
        startTime: values.startTime,
        endTime: values.endTime,
        breakMinutes: Number(values.breakMinutes) || 0,
        notes: values.notes || null,
      });
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
      void createShift({
        org_id: orgId,
        rota_id: shift.rota_id,
        location_id: shift.location_id,
        department_id: shift.department_id,
        staff_profile_id: shift.staff_profile_id,
        shift_type_id: shift.shift_type_id,
        starts_at: shift.starts_at,
        ends_at: shift.ends_at,
        break_minutes: shift.break_minutes,
        status: shift.status,
        notes: shift.notes,
      })
        .then((created) => {
          setShifts((prev) => [...prev, created]);
          setSelectedShiftId(created.id);
          setLastSavedAt(new Date());
          showSuccess('Shift duplicated.');
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

  const handlePublish = async (): Promise<void> => {
    if (draftRotasInScope.length === 0 || !orgId) return;
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

  /**
   * Where an AI draft would be written. The assistant's Review and Fill-gaps
   * tabs work across every location on screen, so the panel itself is never
   * gated — only writing a generated draft needs one specific rota, because a
   * shift has to belong to a single site.
   */
  const applyTarget = useMemo(() => {
    const location = locationFilter !== 'all' ? locationById.get(locationFilter) : null;
    const rota = location ? rotasByLocation.get(location.id) : null;
    return location && rota ? { locationId: location.id, rotaId: rota.id } : null;
  }, [locationFilter, locationById, rotasByLocation]);

  /** Fill an open shift from the assistant's ranked suggestions. */
  const handleAssignOpenShift = useCallback(
    async (shiftId: string, staffProfileId: string): Promise<void> => {
      try {
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
    [showError, showSuccess],
  );

  if (!canBuildRota) {
    return (
      <Card>
        <p className="text-content-muted dark:text-content-muted-dark">
          Only owners and managers can build the rota.
        </p>
      </Card>
    );
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
        <div className="mb-5 flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-display text-page-title font-semibold text-content dark:text-content-dark">
              Rota Builder
            </h1>
            <p className="flex items-center gap-1.5 text-sm text-content-muted dark:text-content-muted-dark">
              Build fair, balanced rotas in minutes.
              <Info size={14} aria-hidden="true" />
            </p>
          </div>
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
        </div>

        {/* ---- Toolbar: date nav, view tabs, settings, publish ---- */}
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
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
            <span className="flex items-center gap-1 text-sm font-semibold text-content dark:text-content-dark">
              {formatWeekRange(dates)}
              <ChevronDown size={14} aria-hidden="true" className="text-content-muted" />
            </span>
          </div>

          <div className="flex items-center gap-3">
            <div
              role="group"
              aria-label="View"
              className="flex rounded-xl border border-surface-border p-1 dark:border-surface-border-dark"
            >
              {VIEW_TABS.map((tab) => (
                <button
                  key={tab}
                  type="button"
                  title={tab !== 'Week' ? `${tab} view — coming soon` : undefined}
                  onClick={() => {
                    if (tab !== 'Week') showError(`${tab} view is coming soon.`);
                  }}
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
            title="More filters — coming soon"
            onClick={() => showError('More filters are coming soon.')}
            className="flex items-center gap-1 rounded-xl border border-surface-border px-3 py-2 text-sm text-content hover:bg-surface-subtle dark:border-surface-border-dark dark:text-content-dark dark:hover:bg-surface-subtle-dark"
          >
            More filters
            <ChevronDown size={14} aria-hidden="true" />
          </button>

          <Button
            size="sm"
            className="ml-auto bg-success/10 text-success hover:bg-success/15"
            onClick={() => setAssistantOpen(true)}
          >
            <Sparkles size={14} aria-hidden="true" />
            AI assistant
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

        <ShiftPatternLegend
          shiftTypes={shiftTypes}
          activeId={shiftTypeFilter}
          countsByType={countsByType}
          onSelect={setShiftTypeFilter}
        />

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
                    dates={dates}
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
                />
              </div>
            </Card>

            {/* The rail is its own card in the reference, not a third column
              inside the grid card. */}
            <Card className="shrink-0 p-2 xl:w-[5.5rem]">
              <RotaActionRail
                onAutoFill={() => setAssistantOpen(true)}
                onComingSoon={(label) => showError(`${label} is coming soon.`)}
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

      {orgId && (
        <ShiftTypeManagerModal
          open={shiftTypeModalOpen}
          onClose={() => setShiftTypeModalOpen(false)}
          orgId={orgId}
          shiftTypes={shiftTypes}
          onChange={setShiftTypes}
        />
      )}

      {orgId && (
        <RotaAssistantPanel
          open={assistantOpen}
          onClose={() => setAssistantOpen(false)}
          orgId={orgId}
          shifts={shiftsInScope}
          staff={staff}
          shiftTypes={shiftTypes}
          locations={filteredLocations}
          weekStart={weekStart}
          weekEnd={weekEnd}
          timezone={DEFAULT_TZ}
          applyTarget={applyTarget}
          onPreview={setPreviewSuggestions}
          onApplied={reloadShifts}
          onAssign={handleAssignOpenShift}
          onSelectShift={setSelectedShiftId}
        />
      )}
    </DndContext>
  );
}
