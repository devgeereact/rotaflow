import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDayLabel, shiftCellKey, type DailyTotal } from '@/lib/rotaGrid';
import { todayIso } from '@/lib/schedulePeriod';
import { RotaGridRow, ROTA_GRID_COLS } from '@/components/rota/RotaGridRow';
import { ShiftPatternLegend } from '@/components/rota/ShiftPatternLegend';
import type { AiShiftSuggestion } from '@/services/aiRotaService';
import type { Location, Shift, ShiftType, StaffProfile } from '@/types';

export interface RotaGroup {
  location: Location;
  staff: StaffProfile[];
}

interface RotaGridProps {
  dates: string[];
  groups: RotaGroup[];
  /** One shift map per location, each built with that location's own timezone. */
  shiftMapByLocation: Map<string, Map<string, Shift[]>>;
  shiftTypes: ShiftType[];
  previewMap: Map<string, AiShiftSuggestion[]>;
  dailyTotals: DailyTotal[];
  selectedShiftId: string | null;
  /** Shift ids with a critical, shift-specific insight — rings the chip red. */
  conflictedShiftIds: Set<string>;
  shiftTypeFilter: string;
  onShiftTypeFilterChange: (shiftTypeId: string) => void;
  onAddShift: (staffProfileId: string | null, date: string, locationId: string) => void;
  onSelectShift: (shift: Shift) => void;
  /** Omitted where the viewer cannot edit, that is what hides the chip's ×. */
  onDeleteShift?: (shift: Shift) => void;
}

/** One row: a staff member (or the location's unfilled shifts) and where to look up their shifts. */
interface FlatRow {
  key: string;
  staff: StaffProfile | null;
  location: Location;
}

export function RotaGrid({
  dates,
  groups,
  shiftMapByLocation,
  shiftTypes,
  previewMap,
  dailyTotals,
  selectedShiftId,
  conflictedShiftIds,
  shiftTypeFilter,
  onShiftTypeFilterChange,
  onAddShift,
  onSelectShift,
  onDeleteShift,
}: RotaGridProps): JSX.Element {
  // One clock for the whole grid. Every chip needs to know whether it is in
  // the past, and hundreds of cells each running their own timer would be
  // hundreds of timers, and they would disagree mid-render.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 60_000);
    return () => window.clearInterval(id);
  }, []);
  const today = todayIso();
  const totalByDate = new Map(dailyTotals.map((t) => [t.date, t]));

  // Flat, single table (docs/ORGANISATION_WORKSPACE.html's rota screen has no
  // location grouping — a real org's shifts still live at one location each,
  // so the per-location shiftMap/timezone lookup underneath is unchanged;
  // this just stops rendering location as a visual section.
  const rows: FlatRow[] = groups.flatMap((group) => {
    const locationShiftMap =
      shiftMapByLocation.get(group.location.id) ?? new Map<string, Shift[]>();
    const hasUnfilled = dates.some(
      (d) => (locationShiftMap.get(shiftCellKey(null, d)) ?? []).length > 0,
    );
    // Location-qualified: a person rostered at two sites this week appears
    // once per site (`groups`, one entry per location a person is actually
    // rostered at). Keying by person.id alone gave React two rows with the
    // identical key, which it can reconcile into each other.
    const staffRows: FlatRow[] = group.staff.map((person) => ({
      key: `${group.location.id}:${person.id}`,
      staff: person,
      location: group.location,
    }));
    return hasUnfilled
      ? [
          ...staffRows,
          { key: `unfilled:${group.location.id}`, staff: null, location: group.location },
        ]
      : staffRows;
  });

  const countsByType = new Map<string, number>();
  for (const locationShiftMap of shiftMapByLocation.values()) {
    for (const shifts of locationShiftMap.values()) {
      for (const shift of shifts) {
        if (!shift.shift_type_id) continue;
        countsByType.set(
          shift.shift_type_id,
          (countsByType.get(shift.shift_type_id) ?? 0) + 1,
        );
      }
    }
  }

  return (
    <div className="min-w-[860px]">
      {/* ---- Header: weekday/date columns ---- */}
      <div
        className={cn(
          ROTA_GRID_COLS,
          'border-b border-surface-border pb-3 dark:border-surface-border-dark',
        )}
      >
        <div className="px-2 text-xs font-semibold text-content-muted dark:text-content-muted-dark">
          Staff
        </div>
        {dates.map((date) => {
          const { weekday, day } = formatDayLabel(date);
          const isToday = date === today;
          return (
            <div
              key={date}
              className={cn(
                'rounded-lg px-1 py-1.5 text-center',
                isToday && 'bg-primary',
              )}
            >
              <p className="text-[0.8rem] leading-5">
                <span
                  className={cn(
                    'font-semibold',
                    isToday ? 'text-white' : 'text-content dark:text-content-dark',
                  )}
                >
                  {weekday}
                </span>{' '}
                <span
                  className={cn(
                    isToday
                      ? 'text-white'
                      : 'text-content-muted dark:text-content-muted-dark',
                  )}
                >
                  {day}
                </span>
              </p>
            </div>
          );
        })}
        <div className="text-right text-xs font-semibold text-content-muted dark:text-content-muted-dark">
          Week
        </div>
      </div>

      {/* ---- One flat staff list, no location grouping ---- */}
      {rows.map((row) => (
        <RotaGridRow
          key={row.key}
          staff={row.staff}
          dates={dates}
          locationId={row.location.id}
          timezone={row.location.timezone}
          shiftMap={shiftMapByLocation.get(row.location.id) ?? new Map<string, Shift[]>()}
          shiftTypes={shiftTypes}
          previewMap={previewMap}
          now={now}
          selectedShiftId={selectedShiftId}
          conflictedShiftIds={conflictedShiftIds}
          onAddShift={(staffProfileId, date) =>
            onAddShift(staffProfileId, date, row.location.id)
          }
          onSelectShift={onSelectShift}
          onDeleteShift={onDeleteShift}
        />
      ))}

      <Link
        to="/app/team"
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-2 text-sm font-medium text-primary dark:text-primary-ink-dark transition-colors hover:bg-surface-subtle dark:border-surface-border-dark dark:hover:bg-surface-subtle-dark"
      >
        <Plus size={14} aria-hidden="true" />
        Add staff
      </Link>

      {/* ---- Totals footer: on shift vs. the staffing minimum ---- */}
      <div
        className={cn(
          ROTA_GRID_COLS,
          'mt-4 border-t border-surface-border pt-3 dark:border-surface-border-dark',
        )}
      >
        <div className="px-2 text-xs font-medium text-content dark:text-content-dark">
          On shift · minimum
        </div>
        {dates.map((date) => {
          const total = totalByDate.get(date);
          if (!total) return <div key={date} />;
          const short = total.staffCount < total.required;
          return (
            <div key={date} className="text-center">
              <p
                className={cn(
                  'font-mono text-sm font-bold',
                  short
                    ? 'text-danger-ink dark:text-danger-ink-dark'
                    : 'text-success-ink dark:text-success-ink-dark',
                )}
              >
                {total.staffCount} / {total.required}
              </p>
            </div>
          );
        })}
        <div />
      </div>

      {/* ---- Legend ---- */}
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-surface-border pt-4 dark:border-surface-border-dark">
        <ShiftPatternLegend
          shiftTypes={shiftTypes}
          activeId={shiftTypeFilter}
          countsByType={countsByType}
          onSelect={onShiftTypeFilterChange}
        />
        <span className="ml-auto flex items-center gap-1.5 text-xs font-medium text-content-muted dark:text-content-muted-dark">
          <span
            aria-hidden="true"
            className="h-2.5 w-2.5 rounded-sm ring-2 ring-danger"
          />
          Conflict
        </span>
      </div>
    </div>
  );
}
