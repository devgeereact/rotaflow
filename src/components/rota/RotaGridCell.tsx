import { useDroppable } from '@dnd-kit/core';
import { cn } from '@/lib/utils';
import { fromIsoInTimezone, shiftCellKey, shiftTimeState } from '@/lib/rotaGrid';
import { ShiftChip } from '@/components/rota/ShiftChip';
import { PreviewShiftChip } from '@/components/rota/PreviewShiftChip';
import type { AiShiftSuggestion } from '@/services/aiRotaService';
import type { Shift, ShiftType } from '@/types';

interface RotaGridCellProps {
  staffProfileId: string | null;
  date: string;
  locationId: string;
  timezone: string;
  shifts: Shift[];
  shiftTypes: ShiftType[];
  previewSuggestions: AiShiftSuggestion[];
  now: number;
  selectedShiftId: string | null;
  onAddShift: () => void;
  onSelectShift: (shift: Shift) => void;
  /** Omitted where the viewer cannot edit — that is what hides the chip's ×. */
  onDeleteShift?: (shift: Shift) => void;
}

export function RotaGridCell({
  staffProfileId,
  date,
  locationId,
  timezone,
  shifts,
  shiftTypes,
  previewSuggestions,
  now,
  selectedShiftId,
  onAddShift,
  onSelectShift,
  onDeleteShift,
}: RotaGridCellProps): JSX.Element {
  const { setNodeRef, isOver } = useDroppable({
    id: `cell:${shiftCellKey(staffProfileId, date)}`,
    data: { locationId, date, staffProfileId },
  });
  const isEmpty = shifts.length === 0 && previewSuggestions.length === 0;

  const containerClassName = cn(
    'min-h-[44px] rounded-lg border border-transparent p-0.5 transition-colors',
    isOver && 'border-primary bg-primary/5',
    isEmpty && 'cursor-pointer hover:bg-surface-subtle dark:hover:bg-surface-subtle-dark',
  );

  // An empty cell shows a muted en-dash rather than blank space, matching
  // design/Rota-Builder.png — it reads as "no shift" instead of "not loaded".
  if (isEmpty) {
    return (
      <button
        type="button"
        ref={setNodeRef}
        onClick={onAddShift}
        aria-label="Add shift"
        className={cn(
          containerClassName,
          'flex w-full items-center justify-center text-sm text-content-muted/50 dark:text-content-muted-dark/50',
        )}
      >
        <span aria-hidden="true">–</span>
      </button>
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
              timeState={shiftTimeState(shift.starts_at, shift.ends_at, now)}
              selected={shift.id === selectedShiftId}
              onClick={() => onSelectShift(shift)}
              onDelete={onDeleteShift ? () => onDeleteShift(shift) : undefined}
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
