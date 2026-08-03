import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { cn } from '@/lib/utils';
import { PAST_SHIFT_TINT, paletteTintForColour } from '@/lib/shiftPalette';
import type { ShiftTimeState } from '@/lib/rotaGrid';
import type { Shift, ShiftType } from '@/types';

interface ShiftChipProps {
  shift: Shift;
  shiftType?: ShiftType;
  startTime: string; // pre-formatted 'HH:MM' in the location's timezone
  endTime: string;
  /** Past shifts drop their colour; current and upcoming ones keep it. */
  timeState: ShiftTimeState;
  selected?: boolean;
  onClick?: () => void;
}

/** A placed shift on the grid — draggable to reassign, click to select in the inspector. */
export function ShiftChip({
  shift,
  shiftType,
  startTime,
  endTime,
  timeState,
  selected,
  onClick,
}: ShiftChipProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `shift:${shift.id}`,
  });
  const isPast = timeState === 'past';

  return (
    <button
      ref={setNodeRef}
      type="button"
      onClick={onClick}
      style={{ transform: CSS.Translate.toString(transform) }}
      {...listeners}
      {...attributes}
      className={cn(
        'relative w-full rounded-lg px-1 py-1.5 text-center ring-1 transition-opacity',
        isPast ? PAST_SHIFT_TINT : paletteTintForColour(shiftType?.colour),
        // A shift running right now is the one thing on the grid that is
        // literally happening, so it gets a live edge rather than a colour.
        timeState === 'live' &&
          'ring-2 ring-success ring-offset-1 ring-offset-surface dark:ring-offset-surface-dark',
        selected &&
          'ring-2 ring-primary ring-offset-1 ring-offset-surface dark:ring-offset-surface-dark',
        isDragging && 'opacity-40',
      )}
    >
      <span className="block truncate text-[0.68rem] font-semibold leading-4 tracking-tight tabular-nums">
        {startTime} – {endTime}
      </span>
      <span className="block truncate text-[0.63rem] font-medium leading-4 opacity-80">
        {shiftType?.name ?? 'Shift'}
      </span>
      {timeState === 'live' && (
        <span className="absolute -right-0.5 -top-0.5 flex h-2 w-2">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-75" />
          <span className="relative inline-flex h-2 w-2 rounded-full bg-success" />
          <span className="sr-only">in progress now</span>
        </span>
      )}
    </button>
  );
}
