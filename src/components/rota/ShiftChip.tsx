import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { X } from 'lucide-react';
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
  /** A critical, shift-specific insight applies to this shift (double-booking, rest breach, understaffed day). */
  hasConflict?: boolean;
  onClick?: () => void;
  /**
   * Remove this shift. Omitted for viewers who cannot edit the rota, which is
   * what hides the control rather than any styling.
   */
  onDelete?: () => void;
}

/**
 * A placed shift on the grid. Draggable to reassign, click to select in the
 * inspector, and removable from the chip itself.
 *
 * ## Why the delete control lives here
 *
 * Removing a shift used to mean: click the chip, find the inspector panel on
 * the right, then find Delete inside it. Three steps and a panel that is off
 * screen on a laptop, for the single most common correction a manager makes
 * while building a rota. It now has a control on the thing it deletes.
 *
 * ## Why it is a sibling, not a child
 *
 * The chip is a `<button>` carrying dnd-kit's drag listeners, and a button
 * inside a button is invalid HTML that browsers silently reparent. So the two
 * are siblings inside a wrapper, and the delete button stops pointer events
 * propagating. Otherwise pressing it starts a drag instead of a click.
 *
 * ## Why it is not permanently visible
 *
 * A full grid is 50+ chips; an always-on × on each is exactly the visual noise
 * §3 rules out. It appears on hover and on keyboard focus, and is
 * *permanently* visible where there is no hover (`hover: none`, i.e. touch),
 * because on a tablet a hover-only affordance is an invisible one.
 */
export function ShiftChip({
  shift,
  shiftType,
  startTime,
  endTime,
  timeState,
  selected,
  hasConflict,
  onClick,
  onDelete,
}: ShiftChipProps): JSX.Element {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `shift:${shift.id}`,
  });
  const isPast = timeState === 'past';

  return (
    <div className="group relative">
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
          // Matches the grid legend's "Conflict" swatch: a double-booking,
          // rest breach or other critical, shift-specific insight.
          hasConflict &&
            !selected &&
            'ring-2 ring-danger ring-offset-1 ring-offset-surface dark:ring-offset-surface-dark',
          isDragging && 'opacity-40',
        )}
      >
        <span className="block truncate text-[0.68rem] font-semibold leading-4 tracking-tight tabular-nums">
          {startTime}, {endTime}
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

      {onDelete && (
        <button
          type="button"
          // dnd-kit listens on pointerdown; without this, pressing the × starts
          // dragging the chip and the click never lands.
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation();
            onDelete();
          }}
          aria-label={`Remove the ${startTime} to ${endTime} shift`}
          title="Remove shift"
          className={cn(
            'absolute -right-1.5 -top-1.5 z-10 grid h-5 w-5 place-items-center rounded-full',
            'border border-surface-border bg-surface text-content-muted shadow-sm',
            'hover:border-danger hover:bg-danger hover:text-white',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger',
            'dark:border-surface-border-dark dark:bg-surface-dark',
            // Hidden until hover or keyboard focus on pointer devices; always
            // shown where hovering is not possible.
            'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100',
            '[@media(hover:none)]:opacity-100',
          )}
        >
          <X size={11} strokeWidth={2.5} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
