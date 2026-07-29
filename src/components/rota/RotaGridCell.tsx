import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { fromIsoInTimezone, shiftCellKey } from '@/lib/rotaGrid';
import { ShiftChip } from '@/components/rota/ShiftChip';
import { PreviewShiftChip } from '@/components/rota/PreviewShiftChip';
import type { AiShiftSuggestion } from '@/services/aiRotaService';
import type { Shift, ShiftType } from '@/types';

interface RotaGridCellProps {
  staffProfileId: string | null;
  date: string;
  timezone: string;
  shifts: Shift[];
  shiftTypes: ShiftType[];
  previewSuggestions: AiShiftSuggestion[];
  onAddShift: () => void;
  onEditShift: (shift: Shift) => void;
}

export function RotaGridCell({
  staffProfileId,
  date,
  timezone,
  shifts,
  shiftTypes,
  previewSuggestions,
  onAddShift,
  onEditShift,
}: RotaGridCellProps): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${shiftCellKey(staffProfileId, date)}`,
  });
  const isEmpty = shifts.length === 0 && previewSuggestions.length === 0;

  const containerClassName = cn(
    'min-h-[64px] rounded-lg border border-transparent p-1 transition-colors',
    isOver && 'border-primary bg-primary/5',
    isEmpty && 'cursor-pointer hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark',
  );

  if (isEmpty) {
    return (
      <button
        type="button"
        ref={setNodeRef}
        onClick={onAddShift}
        aria-label="Add shift"
        className={cn(containerClassName, 'block w-full text-left')}
      />
    );
  }

  return (
    <div ref={setNodeRef} className={containerClassName}>
      <div className="space-y-1">
        {shifts.map((shift) => {
          const shiftType = shiftTypes.find((t) => t.id === shift.shift_type_id);
          const { time: startTime } = fromIsoInTimezone(shift.starts_at, timezone);
          const { time: endTime } = fromIsoInTimezone(shift.ends_at, timezone);
          return (
            <ShiftChip
              key={shift.id}
              shift={shift}
              shiftType={shiftType}
              startTime={startTime}
              endTime={endTime}
              onClick={() => onEditShift(shift)}
            />
          );
        })}
        {previewSuggestions.map((s, i) => (
          <PreviewShiftChip
            key={`preview-${i}`}
            label={s.shiftTypeName ?? s.staffName}
            colourHex={shiftTypes.find((t) => t.id === s.shiftTypeId)?.colour}
            startTime={s.startTime}
            endTime={s.endTime}
          />
        ))}
      </div>
    </div>
  );
}
