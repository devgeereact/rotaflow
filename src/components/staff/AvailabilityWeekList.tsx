import { cn } from '@/lib/utils';
import type { AvailabilityDay } from '@/lib/staffDirectory';

interface AvailabilityWeekListProps {
  days: AvailabilityDay[];
}

const WEEKDAY: Record<AvailabilityDay['tone'], string> = {
  default: 'text-content-muted dark:text-content-muted-dark',
  accent: 'text-primary',
  off: 'text-danger',
};

const DATE: Record<AvailabilityDay['tone'], string> = {
  default: 'text-content dark:text-content-dark',
  accent: 'text-primary',
  off: 'text-content dark:text-content-dark',
};

const DOT: Record<AvailabilityDay['tone'], string> = {
  default: 'bg-success',
  accent: 'bg-shift-violet',
  off: 'bg-transparent',
};

/**
 * "Availability This Week" — weekday, date, working window and a state dot.
 * Days off show the word "Unavailable" as well as the red treatment, never
 * colour alone (docs/DESIGN.md §5).
 */
export function AvailabilityWeekList({ days }: AvailabilityWeekListProps): JSX.Element {
  return (
    <ul className="space-y-2.5">
      {days.map((day) => (
        <li key={day.weekday} className="flex items-center gap-3 text-sm">
          <span className={cn('w-9 shrink-0 font-medium', WEEKDAY[day.tone])}>
            {day.weekday}
          </span>
          <span className={cn('w-16 shrink-0 font-semibold', DATE[day.tone])}>
            {day.date}
          </span>
          {day.timeLabel ? (
            <>
              <span
                className={cn(
                  'ml-auto font-mono text-xs',
                  day.tone === 'accent'
                    ? 'text-primary'
                    : 'text-content dark:text-content-dark',
                )}
              >
                {day.timeLabel}
              </span>
              <span
                aria-hidden="true"
                className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[day.tone])}
              />
            </>
          ) : (
            <>
              <span className="ml-auto text-xs font-medium text-danger">Unavailable</span>
              <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0" />
            </>
          )}
        </li>
      ))}
    </ul>
  );
}
