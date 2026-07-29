import { cn } from '@/lib/utils';
import { paletteTokenForColour } from '@/lib/shiftPalette';
import { fromIsoInTimezone } from '@/lib/rotaGrid';
import type { Shift, ShiftType } from '@/types';

interface ScheduleShiftChipProps {
  shift: Shift;
  shiftType?: ShiftType;
  timezone: string;
  className?: string;
}

/**
 * Read-only counterpart to the rota builder's ShiftChip.
 *
 * Deliberately not the same component: that one is a dnd-kit draggable, and
 * making a published schedule draggable would suggest staff can move their own
 * shifts. Shares the palette so the two screens read as one system.
 */
export function ScheduleShiftChip({
  shift,
  shiftType,
  timezone,
  className,
}: ScheduleShiftChipProps): JSX.Element {
  const { time: start } = fromIsoInTimezone(shift.starts_at, timezone);
  const { time: end } = fromIsoInTimezone(shift.ends_at, timezone);

  return (
    <div
      className={cn(
        'rounded-lg px-2 py-1 text-xs font-medium text-white shadow-sm',
        paletteTokenForColour(shiftType?.colour),
        className,
      )}
    >
      <span className="block tabular-nums">
        {start} – {end}
      </span>
      {shiftType?.name && (
        <span className="block truncate opacity-90">{shiftType.name}</span>
      )}
      {shift.status === 'open' && (
        <span className="block text-[0.65rem] uppercase tracking-wide opacity-90">
          Unfilled
        </span>
      )}
    </div>
  );
}
