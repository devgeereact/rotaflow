import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PAST_SHIFT_TINT, paletteTintForColour } from '@/lib/shiftPalette';
import type { ScheduleChip } from '@/lib/publishedSchedule';

interface PublishedScheduleChipProps {
  chip: ScheduleChip;
  selected: boolean;
  staffName: string;
  onSelect: () => void;
}

/**
 * A published shift in the schedule grid — pale wash, saturated ink, times on
 * top and the shift-type name beneath (design/published-schedule.png).
 *
 * Read-only by design: unlike the rota builder's chip this is not draggable,
 * because a published rota is not something staff can rearrange.
 */
export function PublishedScheduleChip({
  chip,
  selected,
  staffName,
  onSelect,
}: PublishedScheduleChipProps): JSX.Element {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={cn(
        'relative w-full rounded-lg px-1.5 py-1 text-center ring-1 transition-shadow',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
        chip.timeState === 'past' ? PAST_SHIFT_TINT : paletteTintForColour(chip.colour),
        chip.timeState === 'live' && 'ring-2 ring-success',
        selected && 'ring-2 ring-primary',
      )}
    >
      <span className="block truncate text-[0.75rem] font-semibold leading-[1.15rem] tabular-nums">
        {chip.startTime} – {chip.endTime}
      </span>
      <span className="block truncate text-[0.72rem] font-medium leading-[1.05rem] opacity-90">
        {chip.unfilled ? 'Unfilled' : chip.label}
      </span>
      {chip.confirmed && (
        <span className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-success text-white">
          <Check size={10} aria-hidden="true" />
        </span>
      )}
      <span className="sr-only">
        {chip.label} shift for {staffName}
        {chip.confirmed ? ', confirmed' : ''}
      </span>
    </button>
  );
}
