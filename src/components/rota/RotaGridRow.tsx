import { cn } from '@/lib/utils';
import { shiftCellKey } from '@/lib/rotaGrid';
import { shiftNetMinutes } from '@/lib/rotaInsights';
import { hoursLabel } from '@/components/dashboard/dashboardFormat';
import { RotaGridCell } from '@/components/rota/RotaGridCell';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import type { AiShiftSuggestion } from '@/services/aiRotaService';
import type { Shift, ShiftType, StaffProfile } from '@/types';

/**
 * The single column template every band of the grid shares. Staff column,
 * seven day columns, then a trailing "Week" hours-total column (matches
 * docs/ORGANISATION_WORKSPACE.html's rota table). The header and the
 * daily-totals footer reuse it so all three stay aligned; changing the shape
 * in one place without the others is what knocks the grid out of true.
 */
export const ROTA_GRID_COLS =
  'grid grid-cols-[minmax(0,11rem)_repeat(7,minmax(0,1fr))_3.5rem] gap-1.5';

/**
 * The staff-name column, pinned to the left edge of the scrolling viewport.
 *
 * The grid is `min-w-[860px]` and scrolls sideways on anything narrower than a
 * wide laptop. Without this, scrolling to Friday scrolls the names away too,
 * and the manager is reading a column of shifts belonging to nobody in
 * particular — which is the single most common complaint about a rota grid.
 *
 * The opaque background is load-bearing, not decoration: a transparent sticky
 * cell lets the chips slide visibly underneath it.
 *
 * `-mr-1.5 pr-1.5` is the other half of that. The grid's `gap-1.5` leaves a
 * 6px transparent channel to the right of this cell, and chips scrolled
 * through it. The negative margin widens the painted area to cover the gap;
 * the matching padding keeps the text where it was.
 *
 * The right border then lands in that channel and does real work: it is the
 * only thing telling a reader this column is pinned rather than that the grid
 * simply starts there.
 */
export const ROTA_STICKY_STAFF_COL =
  '-mr-1.5 sticky left-0 z-10 border-r border-surface-border bg-surface pr-1.5 dark:border-surface-border-dark dark:bg-surface-dark';

const STATUTORY_WEEKLY_MINUTES = 48 * 60;

const ROTA_ROW_GRID = `${ROTA_GRID_COLS} border-b border-surface-border py-1.5 last:border-0 dark:border-surface-border-dark`;

interface RotaGridRowProps {
  staff: StaffProfile | null;
  /** This row's index in the grid's flat row list. Used by the keyboard move. */
  rowIndex: number;
  dates: string[];
  locationId: string;
  timezone: string;
  shiftMap: Map<string, Shift[]>;
  shiftTypes: ShiftType[];
  previewMap: Map<string, AiShiftSuggestion[]>;
  /** Shared "now" from the grid, so every chip agrees which shifts are past. */
  now: number;
  selectedShiftId: string | null;
  conflictedShiftIds: Set<string>;
  /** The date index this row is currently the keyboard move target for, if any. */
  moveTargetDateIndex: number | null;
  /** The shift being moved by keyboard, so its chip can show as lifted. */
  movingShiftId: string | null;
  onAddShift: (staffProfileId: string | null, date: string) => void;
  onSelectShift: (shift: Shift) => void;
  /** Begins a keyboard move. Omitted where the viewer cannot edit. */
  onStartMove?: (shift: Shift, rowIndex: number, dateIndex: number) => void;
  onMoveKey?: (key: string) => boolean;
  onMoveCancel?: () => void;
  /** Omitted where the viewer cannot edit, that is what hides the chip's ×. */
  onDeleteShift?: (shift: Shift) => void;
}

export function RotaGridRow({
  staff,
  rowIndex,
  dates,
  locationId,
  timezone,
  shiftMap,
  shiftTypes,
  previewMap,
  now,
  selectedShiftId,
  conflictedShiftIds,
  moveTargetDateIndex,
  movingShiftId,
  onAddShift,
  onSelectShift,
  onStartMove,
  onMoveKey,
  onMoveCancel,
  onDeleteShift,
}: RotaGridRowProps): JSX.Element {
  const staffProfileId = staff?.id ?? null;
  const contractMinutes = (staff?.weekly_hours ?? 0) * 60;
  const weekMinutes = staffProfileId
    ? dates.reduce((total, date) => {
        const shiftsToday = shiftMap.get(shiftCellKey(staffProfileId, date)) ?? [];
        return total + shiftsToday.reduce((sum, s) => sum + shiftNetMinutes(s), 0);
      }, 0)
    : 0;

  return (
    <div className={ROTA_ROW_GRID}>
      <div className={cn('flex items-center gap-2.5 px-2', ROTA_STICKY_STAFF_COL)}>
        {staff ? (
          <>
            <StaffAvatar
              firstName={staff.first_name}
              lastName={staff.last_name}
              photoUrl={staff.photo_url}
              size="md"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-content dark:text-content-dark">
                {staff.first_name} {staff.last_name}
              </p>
              {staff.job_title && (
                <p className="truncate text-xs text-content-muted dark:text-content-muted-dark">
                  {staff.job_title}
                </p>
              )}
            </div>
          </>
        ) : (
          <p className="text-sm font-medium text-content-muted dark:text-content-muted-dark">
            Unfilled
          </p>
        )}
      </div>
      {dates.map((date, dateIndex) => {
        const key = shiftCellKey(staffProfileId, date);
        return (
          <RotaGridCell
            key={key}
            staffProfileId={staffProfileId}
            date={date}
            isMoveTarget={moveTargetDateIndex === dateIndex}
            movingShiftId={movingShiftId}
            onStartMove={
              onStartMove ? (shift) => onStartMove(shift, rowIndex, dateIndex) : undefined
            }
            onMoveKey={onMoveKey}
            onMoveCancel={onMoveCancel}
            locationId={locationId}
            timezone={timezone}
            shifts={shiftMap.get(key) ?? []}
            shiftTypes={shiftTypes}
            previewSuggestions={previewMap.get(key) ?? []}
            now={now}
            selectedShiftId={selectedShiftId}
            conflictedShiftIds={conflictedShiftIds}
            onAddShift={() => onAddShift(staffProfileId, date)}
            onSelectShift={onSelectShift}
            onDeleteShift={onDeleteShift}
          />
        );
      })}
      <div className="flex flex-col items-end justify-center px-1 text-right">
        {staff && (
          <>
            <span
              className={cn(
                'font-mono text-sm font-semibold',
                weekMinutes > STATUTORY_WEEKLY_MINUTES
                  ? 'text-danger'
                  : weekMinutes > contractMinutes + 12 * 60
                    ? 'text-warning'
                    : 'text-content dark:text-content-dark',
              )}
            >
              {hoursLabel(weekMinutes / 60)}
            </span>
            {staff.weekly_hours != null && (
              <span className="text-[0.65rem] text-content-muted dark:text-content-muted-dark">
                /{staff.weekly_hours}h
              </span>
            )}
          </>
        )}
      </div>
    </div>
  );
}
