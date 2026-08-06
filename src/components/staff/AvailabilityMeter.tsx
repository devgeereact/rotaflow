import { Fragment } from 'react';
import { cn } from '@/lib/utils';
import type { AvailabilityTone } from '@/lib/staffDirectory';

interface AvailabilityMeterProps {
  /** One tone per day, Monday-first. The reference shows six. */
  days: AvailabilityTone[];
  percent: number;
}

const DOT: Record<AvailabilityTone, string> = {
  available: 'bg-success',
  partial: 'bg-warning',
  unavailable: 'bg-danger',
  none: 'bg-secondary/30 dark:bg-secondary-dark/30',
};

const LINE: Record<AvailabilityTone, string> = {
  available: 'bg-success/50',
  partial: 'bg-warning/50',
  unavailable: 'bg-danger/50',
  none: 'bg-secondary/20 dark:bg-secondary-dark/20',
};

/**
 * Six connected dots plus a percentage. The Availability column in
 * design/staff.png. Each dot carries its own state, so the percentage is
 * rendered as text rather than being the only signal (docs/DESIGN.md §5).
 */
export function AvailabilityMeter({
  days,
  percent,
}: AvailabilityMeterProps): JSX.Element {
  return (
    <div className="flex items-center gap-3">
      <span
        className="flex items-center"
        role="img"
        aria-label={`Availability ${percent}%`}
      >
        {days.map((tone, index) => (
          <Fragment key={`${tone}-${index}`}>
            {index > 0 && <span className={cn('h-0.5 w-1.5', LINE[days[index - 1]!])} />}
            <span className={cn('h-1.5 w-1.5 rounded-full', DOT[tone])} />
          </Fragment>
        ))}
      </span>
      <span className="text-sm font-semibold text-content dark:text-content-dark">
        {percent}%
      </span>
    </div>
  );
}
