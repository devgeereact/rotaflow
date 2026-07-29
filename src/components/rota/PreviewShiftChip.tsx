import { cn } from '@/lib/utils';
import { paletteToken20ForColour } from '@/lib/shiftPalette';

interface PreviewShiftChipProps {
  label: string;
  colourHex?: string | null;
  startTime: string;
  endTime: string;
}

/** Dashed, non-interactive preview of an AI-suggested shift, overlaid on the grid before it's applied. */
export function PreviewShiftChip({
  label,
  colourHex,
  startTime,
  endTime,
}: PreviewShiftChipProps): JSX.Element {
  return (
    <div
      className={cn(
        'w-full rounded-lg border-2 border-dashed px-2 py-1 text-left text-xs font-medium text-content opacity-70 dark:text-content-dark',
        colourHex
          ? paletteToken20ForColour(colourHex)
          : 'bg-surface-subtle dark:bg-surface-subtle-dark',
      )}
    >
      <span className="block truncate">{label}</span>
      <span className="block font-mono text-[10px]">
        {startTime}–{endTime}
      </span>
    </div>
  );
}
