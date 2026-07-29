import { shiftCellKey } from '@/lib/rotaGrid';
import { RotaGridCell } from '@/components/rota/RotaGridCell';
import type { AiShiftSuggestion } from '@/services/aiRotaService';
import type { Shift, ShiftType } from '@/types';

interface RotaGridRowProps {
  staffProfileId: string | null;
  staffName: string;
  dates: string[];
  timezone: string;
  shiftMap: Map<string, Shift[]>;
  shiftTypes: ShiftType[];
  previewMap: Map<string, AiShiftSuggestion[]>;
  onAddShift: (staffProfileId: string | null, date: string) => void;
  onEditShift: (shift: Shift) => void;
}

export function RotaGridRow({
  staffProfileId,
  staffName,
  dates,
  timezone,
  shiftMap,
  shiftTypes,
  previewMap,
  onAddShift,
  onEditShift,
}: RotaGridRowProps): JSX.Element {
  return (
    <div className="grid grid-cols-[160px_repeat(7,1fr)] gap-2 border-b border-surface-border py-2 last:border-0 dark:border-surface-border-dark">
      <div className="flex items-center px-2 text-sm font-medium text-content dark:text-content-dark">
        {staffName}
      </div>
      {dates.map((date) => {
        const key = shiftCellKey(staffProfileId, date);
        return (
          <RotaGridCell
            key={key}
            staffProfileId={staffProfileId}
            date={date}
            timezone={timezone}
            shifts={shiftMap.get(key) ?? []}
            shiftTypes={shiftTypes}
            previewSuggestions={previewMap.get(key) ?? []}
            onAddShift={() => onAddShift(staffProfileId, date)}
            onEditShift={onEditShift}
          />
        );
      })}
    </div>
  );
}
