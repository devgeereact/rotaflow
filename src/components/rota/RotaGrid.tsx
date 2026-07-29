import { formatDayLabel } from '@/lib/rotaGrid';
import { RotaGridRow } from '@/components/rota/RotaGridRow';
import type { AiShiftSuggestion } from '@/services/aiRotaService';
import type { Shift, ShiftType, StaffProfile } from '@/types';

interface RotaGridProps {
  dates: string[];
  staff: StaffProfile[];
  timezone: string;
  shiftMap: Map<string, Shift[]>;
  shiftTypes: ShiftType[];
  previewMap: Map<string, AiShiftSuggestion[]>;
  onAddShift: (staffProfileId: string | null, date: string) => void;
  onEditShift: (shift: Shift) => void;
}

export function RotaGrid({
  dates,
  staff,
  timezone,
  shiftMap,
  shiftTypes,
  previewMap,
  onAddShift,
  onEditShift,
}: RotaGridProps): JSX.Element {
  return (
    <div className="min-w-[900px]">
      <div className="grid grid-cols-[160px_repeat(7,1fr)] gap-2 border-b border-surface-border pb-2 dark:border-surface-border-dark">
        <div />
        {dates.map((date) => {
          const { weekday, day } = formatDayLabel(date);
          return (
            <div key={date} className="text-center">
              <p className="text-xs font-semibold uppercase text-content-muted dark:text-content-muted-dark">
                {weekday}
              </p>
              <p className="text-sm font-medium text-content dark:text-content-dark">{day}</p>
            </div>
          );
        })}
      </div>

      {staff.map((person) => (
        <RotaGridRow
          key={person.id}
          staffProfileId={person.id}
          staffName={`${person.first_name} ${person.last_name}`}
          dates={dates}
          timezone={timezone}
          shiftMap={shiftMap}
          shiftTypes={shiftTypes}
          previewMap={previewMap}
          onAddShift={onAddShift}
          onEditShift={onEditShift}
        />
      ))}

      <RotaGridRow
        staffProfileId={null}
        staffName="Unfilled"
        dates={dates}
        timezone={timezone}
        shiftMap={shiftMap}
        shiftTypes={shiftTypes}
        previewMap={previewMap}
        onAddShift={onAddShift}
        onEditShift={onEditShift}
      />
    </div>
  );
}
