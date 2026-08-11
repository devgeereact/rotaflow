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

const STATUTORY_WEEKLY_MINUTES = 48 * 60;

const ROTA_ROW_GRID = `${ROTA_GRID_COLS} border-b border-surface-border py-1.5 last:border-0 dark:border-surface-border-dark`;

interface RotaGridRowProps {
  staff: StaffProfile | null;
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
  onAddShift: (staffProfileId: string | null, date: string) => void;
  onSelectShift: (shift: Shift) => void;
  /** Omitted where the viewer cannot edit, that is what hides the chip's ×. */
  onDeleteShift?: (shift: Shift) => void;
}

export function RotaGridRow({
  staff,
  dates,
  locationId,
  timezone,
  shiftMap,
  shiftTypes,
  previewMap,
  now,
  selectedShiftId,
  conflictedShiftIds,
  onAddShift,
  onSelectShift,
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
      <div className="flex items-center gap-2.5 px-2">
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
      {dates.map((date) => {
        const key = shiftCellKey(staffProfileId, date);
        return (
          <RotaGridCell
            key={key}
            staffProfileId={staffProfileId}
            date={date}
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
