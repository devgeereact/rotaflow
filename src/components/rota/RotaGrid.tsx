import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatDayLabel, shiftCellKey, type DailyTotal } from '@/lib/rotaGrid';
import { todayIso } from '@/lib/schedulePeriod';
import {
  RotaGridRow,
  ROTA_GRID_COLS,
  ROTA_STICKY_STAFF_COL,
} from '@/components/rota/RotaGridRow';
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
  /**
   * Commits a keyboard move. Omitted for a viewer who cannot edit, which
   * removes the `M` shortcut from every chip.
   *
   * The same call the drag handler makes, so the two paths cannot diverge on
   * what a move means (clash checking, timezone, the shift keeping its times).
   */
  onMoveShift?: (
    shift: Shift,
    target: { staffProfileId: string | null; date: string; locationId: string },
  ) => void;
  /** Omitted where the viewer cannot edit, that is what hides the chip's ×. */
  onDeleteShift?: (shift: Shift) => void;
}

/** A keyboard move in progress: which shift, and where it would land. */
interface MoveState {
  shift: Shift;
  rowIndex: number;
  dateIndex: number;
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
  onMoveShift,
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

  // ---- Keyboard move -----------------------------------------------------
  //
  // Drag-and-drop is the fast path and it is pointer-only. dnd-kit's
  // `KeyboardSensor` is registered on the DndContext but is not a usable
  // alternative here: it translates by a fixed pixel step that addresses no
  // particular cell, and its Enter/Space activation collides with the chip's
  // own "open the editor" click. So the grid provides the keyboard path
  // itself, over the same row/date model the grid is already built from.
  //
  // M starts it, the arrows choose a cell, Enter commits, Escape cancels.
  const [move, setMove] = useState<MoveState | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Which chip to put focus back on after a committed move re-renders it into
  // a different cell. Without this the DOM node is unmounted and focus falls
  // to <body>, which is the classic way an accessible feature stops being one.
  const [refocusShiftId, setRefocusShiftId] = useState<string | null>(null);

  const startMove = useCallback(
    (shift: Shift, rowIndex: number, dateIndex: number): void => {
      setMove({ shift, rowIndex, dateIndex });
    },
    [],
  );

  useEffect(() => {
    // A move cannot outlive the rows it is addressing: changing the filter or
    // the week would leave `rowIndex` pointing at somebody else.
    setMove(null);
  }, [dates, groups]);

  useLayoutEffect(() => {
    if (!refocusShiftId) return;
    const el = containerRef.current?.querySelector<HTMLElement>(
      `[data-shift-id="${refocusShiftId}"]`,
    );
    el?.focus();
    setRefocusShiftId(null);
  }, [refocusShiftId, shiftMapByLocation]);

  /**
   * One key of a move in progress. Returns true when it consumed the key.
   *
   * Called by the moving chip, which is the focused element throughout — so
   * this needs no listener on a wrapper element and cannot be reached when
   * nothing is being moved.
   */
  const handleMoveKey = useCallback(
    (key: string): boolean => {
      if (!move) return false;
      const clamp = (value: number, max: number): number =>
        Math.max(0, Math.min(max, value));

      switch (key) {
        case 'ArrowLeft':
        case 'ArrowRight':
          setMove({
            ...move,
            dateIndex: clamp(
              move.dateIndex + (key === 'ArrowLeft' ? -1 : 1),
              dates.length - 1,
            ),
          });
          return true;
        case 'ArrowUp':
        case 'ArrowDown':
          setMove({
            ...move,
            rowIndex: clamp(
              move.rowIndex + (key === 'ArrowUp' ? -1 : 1),
              rows.length - 1,
            ),
          });
          return true;
        case 'Escape':
          setMove(null);
          return true;
        case 'Enter':
        case ' ': {
          const targetRow = rows[move.rowIndex];
          const targetDate = dates[move.dateIndex];
          setMove(null);
          // The chip is about to be unmounted and remounted in another cell,
          // which drops focus to <body>. Remember where to put it back.
          setRefocusShiftId(move.shift.id);
          if (!targetRow || !targetDate || !onMoveShift) return true;
          onMoveShift(move.shift, {
            staffProfileId: targetRow.staff?.id ?? null,
            date: targetDate,
            locationId: targetRow.location.id,
          });
          return true;
        }
        default:
          return false;
      }
    },
    [move, rows, dates, onMoveShift],
  );

  const cancelMove = useCallback((): void => setMove(null), []);

  const moveAnnouncement = ((): string => {
    if (!move) return '';
    const row = rows[move.rowIndex];
    const date = dates[move.dateIndex];
    if (!row || !date) return '';
    const { weekday, day } = formatDayLabel(date);
    const who = row.staff ? `${row.staff.first_name} ${row.staff.last_name}` : 'Unfilled';
    return `Moving shift to ${who}, ${weekday} ${day}. Arrow keys to change, Enter to confirm, Escape to cancel.`;
  })();

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
    <div ref={containerRef} className="min-w-[860px]">
      {/* Announced, not just drawn. The ring on the landing cell is the whole
          feedback a sighted user needs and none of it for anybody else. */}
      <p role="status" aria-live="polite" className="sr-only">
        {moveAnnouncement}
      </p>

      {/* ---- Header: weekday/date columns ---- */}
      <div
        className={cn(
          ROTA_GRID_COLS,
          // Pinned to the top of the grid's own viewport. Seven date columns
          // are unreadable once the names above them have scrolled away, and a
          // rota is 40 rows long in a real organisation.
          'sticky top-0 z-20 border-b border-surface-border bg-surface pb-3 pt-1',
          'dark:border-surface-border-dark dark:bg-surface-dark',
        )}
      >
        <div
          className={cn(
            'px-2 text-xs font-semibold text-content-muted dark:text-content-muted-dark',
            ROTA_STICKY_STAFF_COL,
            // Above both sticky axes: this cell is pinned left *and* top, so it
            // has to outrank the row it shares an edge with.
            'z-30',
          )}
        >
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
      {rows.map((row, rowIndex) => (
        <RotaGridRow
          key={row.key}
          staff={row.staff}
          rowIndex={rowIndex}
          dates={dates}
          locationId={row.location.id}
          timezone={row.location.timezone}
          shiftMap={shiftMapByLocation.get(row.location.id) ?? new Map<string, Shift[]>()}
          shiftTypes={shiftTypes}
          previewMap={previewMap}
          now={now}
          selectedShiftId={selectedShiftId}
          conflictedShiftIds={conflictedShiftIds}
          moveTargetDateIndex={move && move.rowIndex === rowIndex ? move.dateIndex : null}
          movingShiftId={move?.shift.id ?? null}
          onAddShift={(staffProfileId, date) =>
            onAddShift(staffProfileId, date, row.location.id)
          }
          onSelectShift={onSelectShift}
          onStartMove={onMoveShift ? startMove : undefined}
          onMoveKey={handleMoveKey}
          onMoveCancel={cancelMove}
          onDeleteShift={onDeleteShift}
        />
      ))}

      <Link
        to="/app/team"
        className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-surface-border px-3 py-2 text-sm font-medium text-primary-ink dark:text-primary-ink-dark transition-colors hover:bg-surface-subtle dark:border-surface-border-dark dark:hover:bg-surface-subtle-dark"
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
        <div
          className={cn(
            'px-2 text-xs font-medium text-content dark:text-content-dark',
            ROTA_STICKY_STAFF_COL,
          )}
        >
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

      {/* A keyboard shortcut nobody is told about is a keyboard shortcut
          nobody has. `aria-keyshortcuts` on the chip covers assistive tech;
          this covers everyone else. */}
      {onMoveShift && (
        <p className="mt-2 text-xs text-content-muted dark:text-content-muted-dark">
          Drag a shift to move it, or select one and press{' '}
          <kbd className="rounded border border-surface-border px-1 font-mono text-[0.7rem] dark:border-surface-border-dark">
            M
          </kbd>{' '}
          to move it with the arrow keys.
        </p>
      )}
    </div>
  );
}
