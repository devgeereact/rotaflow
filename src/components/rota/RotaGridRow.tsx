import { Plus } from 'lucide-react';
import { shiftCellKey } from '@/lib/rotaGrid';
import { RotaGridCell } from '@/components/rota/RotaGridCell';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import type { AiShiftSuggestion } from '@/services/aiRotaService';
import type { Shift, ShiftType, StaffProfile } from '@/types';

/**
 * The single column template every band of the grid shares — staff column,
 * seven day columns, then the trailing per-row "+" column. The header totals
 * and the daily-totals footer reuse it so all three stay aligned; changing the
 * shape in one place without the others is what knocks the grid out of true.
 */
export const ROTA_GRID_COLS =
  'grid grid-cols-[minmax(0,11rem)_repeat(7,minmax(0,1fr))_2.25rem] gap-1.5';

const ROTA_ROW_GRID = `${ROTA_GRID_COLS} border-b border-surface-border py-1.5 last:border-0 dark:border-surface-border-dark`;

interface RotaGridRowProps {
  staff: StaffProfile | null;
  dates: string[];
  locationId: string;
  timezone: string;
  shiftMap: Map<string, Shift[]>;
  shiftTypes: ShiftType[];
  previewMap: Map<string, AiShiftSuggestion[]>;
  selectedShiftId: string | null;
  onAddShift: (staffProfileId: string | null, date: string) => void;
  onSelectShift: (shift: Shift) => void;
}

export function RotaGridRow({
  staff,
  dates,
  locationId,
  timezone,
  shiftMap,
  shiftTypes,
  previewMap,
  selectedShiftId,
  onAddShift,
  onSelectShift,
}: RotaGridRowProps): JSX.Element {
  const staffProfileId = staff?.id ?? null;

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
            selectedShiftId={selectedShiftId}
            onAddShift={() => onAddShift(staffProfileId, date)}
            onSelectShift={onSelectShift}
          />
        );
      })}
      <div className="flex items-center justify-center">
        <button
          type="button"
          onClick={() => onAddShift(staffProfileId, dates[0] ?? '')}
          aria-label={
            staff ? `Add shift for ${staff.first_name} ${staff.last_name}` : 'Add shift'
          }
          className="grid h-8 w-8 place-items-center rounded-lg border border-surface-border text-content-muted transition-colors hover:border-primary hover:text-primary dark:border-surface-border-dark dark:text-content-muted-dark"
        >
          <Plus size={16} aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
