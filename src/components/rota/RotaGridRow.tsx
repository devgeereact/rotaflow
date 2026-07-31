import { shiftCellKey } from '@/lib/rotaGrid';
import { RotaGridCell } from '@/components/rota/RotaGridCell';
import { StaffAvatar } from '@/components/ui/StaffAvatar';
import type { AiShiftSuggestion } from '@/services/aiRotaService';
import type { Shift, ShiftType, StaffProfile } from '@/types';

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
    <div className="grid grid-cols-[minmax(0,14rem)_repeat(7,1fr)] gap-2 border-b border-surface-border py-2 last:border-0 dark:border-surface-border-dark">
      <div className="flex items-center gap-2 px-2">
        {staff ? (
          <>
            <StaffAvatar
              firstName={staff.first_name}
              lastName={staff.last_name}
              photoUrl={staff.photo_url}
              size="sm"
            />
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-content dark:text-content-dark">
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
    </div>
  );
}
