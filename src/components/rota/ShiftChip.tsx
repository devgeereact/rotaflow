import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { paletteTintForColour } from '@/lib/shiftPalette';
import type { Shift, ShiftType } from '@/types';

interface ShiftChipProps {
  shift: Shift;
  shiftType?: ShiftType;
  startTime: string; // pre-formatted 'HH:MM' in the location's timezone
  endTime: string;
  selected?: boolean;
  onClick?: () => void;
}

/** A placed shift on the grid — draggable to reassign, click to select in the inspector. */
export function ShiftChip({
  shift,
  shiftType,
  startTime,
  endTime,
  selected,
  onClick,
}: ShiftChipProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `shift:${shift.id}`,
  });

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...listeners}
      {...attributes}
      className={cn(
        'w-full rounded-lg px-1 py-1.5 text-center ring-1 transition-opacity',
        paletteTintForColour(shiftType?.colour),
        selected &&
          'ring-2 ring-primary ring-offset-1 ring-offset-surface dark:ring-offset-surface-dark',
        isDragging && 'opacity-40',
      )}
    >
      <span className="block truncate text-[0.68rem] font-semibold leading-4 tracking-tight">
        {startTime} – {endTime}
      </span>
      <span className="block truncate text-[0.63rem] font-medium leading-4 opacity-80">
        {shiftType?.name ?? 'Shift'}
      </span>
    </button>
  );
}
