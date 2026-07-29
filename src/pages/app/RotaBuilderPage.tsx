import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import { ChevronLeft, ChevronRight, Plus, Sparkles } from 'lucide-react';
import { useOrg } from '@/hooks/useOrg';
import { usePermissions } from '@/hooks/usePermissions';
import { useToast } from '@/hooks/useToast';
import { listLocations } from '@/services/locationService';
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
  computeShiftIsoRange,
  formatWeekLabel,
  fromIsoInTimezone,
  getMonday,
  getWeekDates,
  parseCellId,
  shiftCellKey,
  totalScheduledMinutes,
  unfilledShiftCount,
} from '@/lib/rotaGrid';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Select } from '@/components/ui/Select';
import { RotaGrid } from '@/components/rota/RotaGrid';
import { ShiftTypePalette } from '@/components/rota/ShiftTypePalette';
import { AssignShiftModal, type AssignShiftFormValues } from '@/components/rota/AssignShiftModal';
import { ShiftTypeManagerModal } from '@/components/rota/ShiftTypeManagerModal';
import { AutoFillPanel } from '@/components/rota/AutoFillPanel';
import type { Location, Rota, Shift, ShiftType, StaffProfile } from '@/types';

const STUB_TABS = ['Grid', 'Coverage', 'Staff', 'Stats'];
const STUB_TOOLBAR = ['Copy', 'Rules', 'View', 'Filters'];

interface AssignModalState {
  open: boolean;
  context: { staffProfileId: string | null; date: string } | null;
  shift: Shift | null;
}

export function RotaBuilderPage(): JSX.Element {
  const { orgId } = useOrg();
  const { canBuildRota } = usePermissions();
  const { showError, showSuccess } = useToast();

  const [locations, setLocations] = useState<Location[]>([]);
  const [locationId, setLocationId] = useState<string | null>(null);
  const [staff, setStaff] = useState<StaffProfile[]>([]);
  const [shiftTypes, setShiftTypes] = useState<ShiftType[]>([]);
  const [weekStart, setWeekStart] = useState(() => getMonday(new Date()));
  const [rota, setRota] = useState<Rota | null>(null);
  const [shifts, setShifts] = useState<Shift[]>([]);
  const [orgDataLoading, setOrgDataLoading] = useState(true);
  // Distinct from "no locations exist" — a failed fetch must not be rendered
  // as an empty org, or we tell an owner to re-add locations they already have.
  const [orgDataFailed, setOrgDataFailed] = useState(false);
  // Bumped by the retry button to re-run the org-data effect.
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const [publishError, setPublishError] = useState<string | null>(null);

  const [assignModal, setAssignModal] = useState<AssignModalState>({
    open: false,
    context: null,
    shift: null,
  });
  const [shiftTypeModalOpen, setShiftTypeModalOpen] = useState(false);
  const [autoFillOpen, setAutoFillOpen] = useState(false);
  const [previewSuggestions, setPreviewSuggestions] = useState<AiShiftSuggestion[]>([]);

  const selectedLocation = locations.find((l) => l.id === locationId) ?? null;
  const dates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const weekEnd = dates[6] ?? weekStart;

  // Org-level data: locations, staff, shift types — independent of week/location.
  useEffect(() => {
    if (!orgId) return;
    setOrgDataLoading(true);
    setOrgDataFailed(false);
    void (async () => {
      try {
        const [locs, staffRows, typeRows] = await Promise.all([
          listLocations(orgId),
          listActiveStaff(orgId),
          listShiftTypes(orgId),
        ]);
        setLocations(locs);
        setStaff(staffRows);
        setShiftTypes(typeRows);
        setLocationId((current) => current ?? locs[0]?.id ?? null);
      } catch (err) {
        reportError(err, { area: 'rota:load-org-data' });
        setOrgDataFailed(true);
        showError('Could not load staff and locations. Check your connection and retry.');
      } finally {
        setOrgDataLoading(false);
      }
    })();
  }, [orgId, reloadKey, showError]);

  // Rota + shifts for the selected week/location.
  useEffect(() => {
    if (!orgId || !locationId) {
      setLoading(false);
      return;
    }
    let active = true;
    setLoading(true);
    void (async () => {
      try {
        const weekRota = await getOrCreateRotaForPeriod({
          orgId,
          name: `Week of ${weekStart}`,
          periodStart: weekStart,
          periodEnd: weekEnd,
          locationId,
        });
        const shiftRows = await listShiftsForRota(weekRota.id);
        if (!active) return;
        setRota(weekRota);
        setShifts(shiftRows);
      } catch (err) {
        if (!active) return;
        reportError(err, { area: 'rota:load-week' });
        setRota(null);
        setShifts([]);
        showError('Could not load this week. Check your connection and retry.');
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [orgId, locationId, weekStart, weekEnd, showError]);

  const shiftMap = useMemo(
    () => buildShiftMap(shifts, selectedLocation?.timezone ?? 'Europe/London'),
    [shifts, selectedLocation],
  );

  const previewMap = useMemo(() => {
    const map = new Map<string, AiShiftSuggestion[]>();
    for (const s of previewSuggestions) {
      const key = shiftCellKey(s.staffProfileId, s.date);
      map.set(key, [...(map.get(key) ?? []), s]);
    }
    return map;
  }, [previewSuggestions]);

  const placeShift = useCallback(
    async (input: {
      staffProfileId: string | null;
      date: string;
      shiftTypeId: string | null;
      startTime: string;
      endTime: string;
      breakMinutes?: number;
      notes?: string | null;
    }): Promise<void> => {
      if (!orgId || !rota || !selectedLocation) return;
      const { startsAt, endsAt } = computeShiftIsoRange(
        input.date,
        input.startTime,
        input.endTime,
        selectedLocation.timezone,
      );
      const created = await createShift({
        org_id: orgId,
        rota_id: rota.id,
        location_id: selectedLocation.id,
        staff_profile_id: input.staffProfileId,
        shift_type_id: input.shiftTypeId,
        starts_at: startsAt,
        ends_at: endsAt,
        break_minutes: input.breakMinutes ?? 0,
        status: 'assigned',
        notes: input.notes ?? null,
      });
      setShifts((prev) => [...prev, created]);
    },
    [orgId, rota, selectedLocation],
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent): void => {
      const { active, over } = event;
      if (!over || !selectedLocation) return;
      const cell = parseCellId(String(over.id));
      if (!cell) return;
      const activeId = String(active.id);

      if (activeId.startsWith('palette:')) {
        const shiftTypeId = activeId.slice('palette:'.length);
        const type = shiftTypes.find((t) => t.id === shiftTypeId);
        void placeShift({
          staffProfileId: cell.staffProfileId,
          date: cell.date,
          shiftTypeId,
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
        const { time: startTime } = fromIsoInTimezone(shift.starts_at, selectedLocation.timezone);
        const { time: endTime } = fromIsoInTimezone(shift.ends_at, selectedLocation.timezone);
        const { startsAt, endsAt } = computeShiftIsoRange(
          cell.date,
          startTime,
          endTime,
          selectedLocation.timezone,
        );
        void updateShift(shiftId, {
          staff_profile_id: cell.staffProfileId,
          starts_at: startsAt,
          ends_at: endsAt,
        })
          .then((updated) => setShifts((prev) => prev.map((s) => (s.id === updated.id ? updated : s))))
          .catch((err) => {
            reportError(err, { area: 'rota:drag-reassign' });
            showError('Could not move that shift. It has been left where it was.');
          });
      }
    },
    [selectedLocation, shiftTypes, shifts, placeShift, showError],
  );

  const handleModalSave = async (values: AssignShiftFormValues): Promise<void> => {
    if (!selectedLocation) return;
    const { startsAt, endsAt } = computeShiftIsoRange(
      values.date,
      values.startTime,
      values.endTime,
      selectedLocation.timezone,
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
        startTime: values.startTime,
        endTime: values.endTime,
        breakMinutes: Number(values.breakMinutes) || 0,
        notes: values.notes || null,
      });
    }
  };

  const handleModalDelete = async (shiftId: string): Promise<void> => {
    await deleteShift(shiftId);
    setShifts((prev) => prev.filter((s) => s.id !== shiftId));
  };

  const handlePublish = async (): Promise<void> => {
    if (!rota) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const updated = await publishRota(rota.id);
      setRota(updated);
      showSuccess('Rota published. Staff can now see this week.');
    } catch (err) {
      reportError(err, { area: 'rota:publish' });
      setPublishError('Could not publish this rota. Please try again.');
    } finally {
      setPublishing(false);
    }
  };

  const handleUnpublish = async (): Promise<void> => {
    if (!rota) return;
    setPublishing(true);
    setPublishError(null);
    try {
      const updated = await unpublishRota(rota.id);
      setRota(updated);
      showSuccess('Rota returned to draft. Re-publish when your changes are ready.');
    } catch (err) {
      reportError(err, { area: 'rota:unpublish' });
      // 23505 means a leftover empty draft from before the Phase 1.5 fix already
      // occupies this period; say so rather than offering a retry that can't work.
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
    if (!rota) return;
    void listShiftsForRota(rota.id)
      .then(setShifts)
      .catch((err) => {
        reportError(err, { area: 'rota:reload-shifts' });
        showError('Could not refresh the grid. Reload the page to see the latest shifts.');
      });
  };

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
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => setWeekStart((d) => getMonday(new Date(new Date(d).setDate(new Date(d).getDate() - 7))))}
              aria-label="Previous week"
              className="rounded-lg border border-surface-border p-1.5 text-content-muted hover:text-content dark:border-surface-border-dark dark:text-content-muted-dark"
            >
              <ChevronLeft size={16} />
            </button>
            <h1 className="font-display text-lg font-semibold text-content dark:text-content-dark">
              Week Commencing {formatWeekLabel(weekStart)}
            </h1>
            <button
              type="button"
              onClick={() => setWeekStart((d) => getMonday(new Date(new Date(d).setDate(new Date(d).getDate() + 7))))}
              aria-label="Next week"
              className="rounded-lg border border-surface-border p-1.5 text-content-muted hover:text-content dark:border-surface-border-dark dark:text-content-muted-dark"
            >
              <ChevronRight size={16} />
            </button>
            <Button size="sm" variant="ghost" onClick={() => setWeekStart(getMonday(new Date()))}>
              Today
            </Button>
            <span
              className={cn(
                'rounded-full px-2.5 py-0.5 text-xs font-medium',
                rota?.status === 'published'
                  ? 'bg-success/10 text-success'
                  : 'bg-warning/10 text-warning',
              )}
            >
              {rota?.status === 'published' ? 'Published' : 'Draft'}
            </span>
          </div>

          <div className="flex items-center gap-3">
            {locations.length > 1 && (
              <Select
                value={locationId ?? ''}
                onChange={(e) => setLocationId(e.target.value)}
                className="w-auto py-2"
              >
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            )}
            {rota?.status === 'published' ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => void handleUnpublish()}
                disabled={publishing}
              >
                {publishing ? 'Updating…' : 'Unpublish'}
              </Button>
            ) : (
              <Button
                size="sm"
                onClick={() => void handlePublish()}
                disabled={publishing || !rota || shifts.length === 0}
                title={shifts.length === 0 ? 'Add at least one shift before publishing' : undefined}
              >
                {publishing ? 'Publishing…' : 'Publish'}
              </Button>
            )}
          </div>
        </div>

        {publishError && (
          <p className="mb-4 text-sm text-danger" role="alert">
            {publishError}
          </p>
        )}

        <div className="mb-4 flex flex-wrap items-center gap-4 border-b border-surface-border pb-4 dark:border-surface-border-dark">
          <div className="flex gap-1">
            {STUB_TABS.map((tab) => (
              <span
                key={tab}
                aria-disabled={tab !== 'Grid'}
                className={cn(
                  'rounded-lg px-3 py-1.5 text-sm font-medium',
                  tab === 'Grid'
                    ? 'bg-surface text-primary dark:bg-surface-dark'
                    : 'cursor-not-allowed text-content-muted/60 dark:text-content-muted-dark/60',
                )}
              >
                {tab}
              </span>
            ))}
          </div>
          <div className="flex gap-3 text-sm text-content-muted/60 dark:text-content-muted-dark/60">
            {STUB_TOOLBAR.map((label) => (
              <span key={label} aria-disabled="true" className="cursor-not-allowed">
                {label}
              </span>
            ))}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setAutoFillOpen(true)}>
              <Sparkles size={14} aria-hidden="true" className="mr-1.5" />
              Auto Fill
            </Button>
            <Button
              size="sm"
              onClick={() =>
                setAssignModal({
                  open: true,
                  context: { staffProfileId: null, date: dates[0] ?? weekStart },
                  shift: null,
                })
              }
            >
              <Plus size={14} aria-hidden="true" className="mr-1.5" />
              Add Shift
            </Button>
          </div>
        </div>

        <div className="mb-4">
          <ShiftTypePalette shiftTypes={shiftTypes} onManage={() => setShiftTypeModalOpen(true)} />
        </div>

        <div className="mb-4 flex gap-6 text-sm text-content-muted dark:text-content-muted-dark">
          <span>
            <strong className="font-mono text-content dark:text-content-dark">
              {(totalScheduledMinutes(shifts) / 60).toFixed(1)}h
            </strong>{' '}
            scheduled
          </span>
          <span>
            <strong className="font-mono text-content dark:text-content-dark">
              {unfilledShiftCount(shifts)}
            </strong>{' '}
            unfilled
          </span>
        </div>

        {loading || !selectedLocation ? (
          <p className="text-content-muted dark:text-content-muted-dark">Loading…</p>
        ) : (
          <Card className="overflow-x-auto">
            <RotaGrid
              dates={dates}
              staff={staff}
              timezone={selectedLocation.timezone}
              shiftMap={shiftMap}
              shiftTypes={shiftTypes}
              previewMap={previewMap}
              onAddShift={(staffProfileId, date) =>
                setAssignModal({ open: true, context: { staffProfileId, date }, shift: null })
              }
              onEditShift={(shift) => setAssignModal({ open: true, context: null, shift })}
            />
          </Card>
        )}
      </div>

      <AssignShiftModal
        open={assignModal.open}
        onClose={() => setAssignModal({ open: false, context: null, shift: null })}
        staff={staff}
        shiftTypes={shiftTypes}
        dates={dates}
        timezone={selectedLocation?.timezone ?? 'Europe/London'}
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

      {orgId && selectedLocation && rota && (
        <AutoFillPanel
          open={autoFillOpen}
          onClose={() => setAutoFillOpen(false)}
          orgId={orgId}
          locationId={selectedLocation.id}
          rotaId={rota.id}
          weekStart={weekStart}
          weekEnd={weekEnd}
          timezone={selectedLocation.timezone}
          onPreview={setPreviewSuggestions}
          onApplied={reloadShifts}
        />
      )}
    </DndContext>
  );
}
