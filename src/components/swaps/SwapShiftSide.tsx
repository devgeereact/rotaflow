import { cn } from '@/lib/utils';
import type { SwapShiftSide as SwapShiftSideModel } from '@/lib/swapRows';

interface SwapShiftSideProps {
  /** Which half of the exchange this is. Drives the chip wording and tint. */
  side: 'giving' | 'taking';
  shift: SwapShiftSideModel | null;
}

const CHIP: Record<SwapShiftSideProps['side'], string> = {
  giving: 'bg-danger/10 text-danger',
  taking: 'bg-success/10 text-success',
};

const CHIP_LABEL: Record<SwapShiftSideProps['side'], string> = {
  giving: 'Giving Away',
  taking: 'Taking',
};

/**
 * One half of a swap. The chip, then date, time and location stacked under it
 * (design/Swap-Request.png).
 *
 * The chip is never colour alone: it always carries the words "Giving Away" or
 * "Taking" (docs/DESIGN.md §5).
 */
export function SwapShiftSide({ side, shift }: SwapShiftSideProps): JSX.Element {
  if (!shift) {
    return (
      <p className="text-[0.72rem] text-content-muted dark:text-content-muted-dark">
        Not matched yet
      </p>
    );
  }

  return (
    <div className="min-w-0">
      <div className="mb-1.5 flex">
        <span
          className={cn(
            'rounded-md px-2 py-px text-[0.64rem] font-semibold leading-4',
            CHIP[side],
          )}
        >
          {CHIP_LABEL[side]}
        </span>
      </div>
      <p className="truncate text-[0.72rem] font-semibold leading-4 text-content dark:text-content-dark">
        {shift.dateLabel}
      </p>
      <p className="truncate font-mono text-[0.68rem] leading-4 text-content dark:text-content-dark">
        {shift.timeLabel}
      </p>
      {shift.locationName && (
        <p className="truncate text-[0.68rem] leading-4 text-content-muted dark:text-content-muted-dark">
          {shift.locationName}
        </p>
      )}
    </div>
  );
}
